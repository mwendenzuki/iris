/* eslint-disable @typescript-eslint/no-explicit-any */
import { rad } from "./geo";
import type { Item } from "./types";

interface ScanHit {
  band: number;
  d: number;
}

/**
 * Depth Anything V2 (small) gives relative depth. We turn it into metres by fitting
 * disparity -> 1/distance against objects of known size (and the floor as a fallback anchor).
 */
export class Depth {
  dead = false;
  failed = false;
  obs: { list: ScanHit[]; t: number } = { list: [], t: 0 };
  private pipe: any = null;
  private RawImage: any = null;
  private map: { d: ArrayLike<number>; w: number; h: number } | null = null;
  private cal: { a: number; b: number } | null = null;
  private busy = false;
  private prevScan: ScanHit[] = [];
  private cv = document.createElement("canvas");

  constructor() {
    this.cv.width = 252;
    this.cv.height = 196;
  }

  get loaded() {
    return !!this.pipe;
  }
  get calibrated() {
    return !!this.cal;
  }

  async load() {
    try {
      const tf: any = await import("@huggingface/transformers");
      this.RawImage = tf.RawImage;
      const mk = (o: object) =>
        tf.pipeline(
          "depth-estimation",
          "onnx-community/depth-anything-v2-small",
          o,
        );
      try {
        this.pipe =
          "gpu" in navigator
            ? await mk({ device: "webgpu", dtype: "fp16" })
            : await mk({ dtype: "q8" });
      } catch {
        this.pipe = await mk({ dtype: "q8" });
      }
      try {
        this.pipe.processor.image_processor.size = { width: 252, height: 196 };
      } catch {
        /* keep default */
      }
    } catch {
      this.pipe = null;
      this.failed = true;
    }
  }

  private samp(nx: number, ny: number) {
    const { d, w, h } = this.map!;
    return d[
      Math.min(h - 1, Math.max(0, Math.round(ny * h))) * w +
        Math.min(w - 1, Math.max(0, Math.round(nx * w)))
    ];
  }

  /** Median disparity over a 5x5 grid inside a box (pixels of the video frame). */
  private disp(
    x: number,
    y: number,
    w: number,
    h: number,
    W: number,
    H: number,
  ) {
    const a: number[] = [];
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++)
        a.push(
          this.samp(
            (x + w * (0.2 + 0.15 * i)) / W,
            (y + h * (0.2 + 0.15 * j)) / H,
          ),
        );
    a.sort((p, q) => p - q);
    return a[12];
  }

  private toM(s: number) {
    const c = this.cal!;
    return Math.min(30, 1 / Math.max(c.a * s + c.b, 0.033));
  }

  /** Distance (m) to a box, or null until depth is loaded and calibrated. */
  at(
    x: number,
    y: number,
    w: number,
    h: number,
    W: number,
    H: number,
  ): number | null {
    return this.map && this.cal ? this.toM(this.disp(x, y, w, h, W, H)) : null;
  }

  private calibrate(items: Item[], W: number, H: number, camH: number) {
    const A: [number, number][] = [];
    for (const it of items) {
      if (it.cls === "obstacle" || it.trunc || it.ds > 12 || it.ds < 0.8)
        continue;
      const s = this.disp(...it.box, W, H);
      if (s > 0) A.push([s, 1 / it.ds]);
    }
    if (A.length < 2) {
      // ground anchor: floor ~2.5 m ahead when the phone is held level
      const s = this.disp(0.4 * W, 0.88 * H, 0.2 * W, 0.06 * H, W, H);
      if (s > 0) A.push([s, 1 / ((camH * 0.866) / 0.41)]);
    }
    if (!A.length) return;
    let a: number,
      b = 0;
    const n = A.length,
      mx = A.reduce((q, p) => q + p[0], 0) / n,
      my = A.reduce((q, p) => q + p[1], 0) / n;
    const vx = A.reduce((q, p) => q + (p[0] - mx) ** 2, 0) / n;
    if (n >= 3 && vx > (0.15 * mx) ** 2) {
      a = A.reduce((q, p) => q + (p[0] - mx) * (p[1] - my), 0) / n / vx;
      b = my - a * mx;
    } else {
      const r = A.map((p) => p[1] / p[0]).sort((p, q) => p - q);
      a = r[r.length >> 1];
    }
    if (!(a > 0)) return;
    this.cal = this.cal
      ? { a: 0.5 * this.cal.a + 0.5 * a, b: 0.5 * this.cal.b + 0.5 * b }
      : { a, b };
  }

  /** Unknown obstacles (poles, walls, kerbs): depth closer than the expected floor distance, in three bands ahead. */
  private scan(H: number, camH: number): ScanHit[] {
    const f = H / (2 * Math.tan(rad(30))),
      out: ScanHit[] = [];
    (
      [
        [0.2, 0.4],
        [0.4, 0.6],
        [0.6, 0.8],
      ] as const
    ).forEach((bd, i) => {
      let c = 0;
      const ds: number[] = [];
      for (let yy = 0.25; yy <= 0.9; yy += 0.05) {
        for (let xx = bd[0] + 0.02; xx < bd[1]; xx += 0.04) {
          c++;
          const d = this.toM(this.samp(xx, yy)),
            dy = (yy - 0.5) * H;
          const lim = dy > 0.05 * H ? (0.7 * camH * f) / dy : 3;
          if (d < lim && d < 8) ds.push(d);
        }
      }
      if (ds.length / c > 0.15) {
        ds.sort((p, q) => p - q);
        out.push({ band: i, d: ds[Math.floor(ds.length * 0.2)] });
      }
    });
    return out;
  }

  /** One depth pass. Cheap to call every frame: it skips while the previous pass is still running. */
  async tick(v: HTMLVideoElement, items: Item[], camH: number) {
    if (!this.pipe || this.busy || this.dead) return;
    this.busy = true;
    try {
      const W = v.videoWidth,
        H = v.videoHeight;
      this.cv.getContext("2d")!.drawImage(v, 0, 0, 252, 196);
      const o = await this.pipe(await this.RawImage.fromCanvas(this.cv));
      const p = o.predicted_depth,
        s: number[] = p.dims;
      this.map = { d: p.data, w: s[s.length - 1], h: s[s.length - 2] };
      this.calibrate(items, W, H, camH);
      if (this.cal) {
        const now = this.scan(H, camH);
        // only trust a band if it was also hit on the previous pass (kills one-frame ghosts)
        this.obs = {
          list: now.filter((n) => this.prevScan.some((q) => q.band === n.band)),
          t: performance.now() / 1000,
        };
        this.prevScan = now;
      }
    } catch {
      /* skip this pass */
    }
    this.busy = false;
  }
}
