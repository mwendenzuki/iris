import type { Depth } from "./depth";
import { rad } from "./geo";
import { OBJ } from "./i18n";
import type { Box, Item } from "./types";

export interface Pred {
  class: string;
  score: number;
  bbox: Box;
}

interface Track {
  id: number;
  cls: string;
  cx: number;
  cy: number;
  d: number;
  v: number;
  t: number;
  seen: number;
  hits: number;
}

/** Turns raw detections (+ depth) into tracked, risk-tiered items. */
export class Perceiver {
  items: Item[] = [];
  private tracks: Track[] = [];
  private nid = 0;

  perceive(
    preds: Pred[],
    W: number,
    H: number,
    t: number,
    depth: Depth,
  ): Item[] {
    const f = H / (2 * Math.tan(rad(30))); // focal length in px, assuming ~60 degree vertical FOV
    let items: Item[] = [];

    for (const p of preds) {
      const o = OBJ[p.class];
      if (!o || p.score < (o[1] === 3 || p.class === "person" ? 0.5 : 0.55))
        continue;
      const [x, y, w, h] = p.bbox;
      const trunc = y + h > H - 6;
      const ds = Math.min(
        30,
        Math.max(0.4, ((o[0] * f) / h) * (trunc ? 0.8 : 1)),
      );
      const dd = depth.at(x, y, w, h, W, H);
      const d = dd ? (trunc ? dd : 0.6 * dd + 0.4 * ds) : ds;
      items.push({
        cls: p.class,
        cx: x + w / 2,
        cy: y + h / 2,
        d,
        ds,
        trunc,
        s: p.score,
        risk: o[1],
        box: p.bbox,
        ow: (w / f) * d,
        lat: ((x + w / 2 - W / 2) / f) * d,
        ok: false,
        inPath: false,
        ttc: 99,
        tier: 3,
      });
    }

    // unknown obstacles from the depth scan (only fresh ones)
    if (t - depth.obs.t < 1.5) {
      for (const o of depth.obs.list) {
        const x = (0.2 + 0.2 * o.band) * W;
        items.push({
          cls: "obstacle",
          cx: x + 0.1 * W,
          cy: 0.5 * H,
          d: o.d,
          ds: o.d,
          trunc: false,
          s: 1,
          risk: 1,
          box: [x, 0.3 * H, 0.2 * W, 0.5 * H],
          ow: 0.8,
          lat: (((o.band - 1) * 0.2 * W) / f) * o.d,
          ok: false,
          inPath: false,
          ttc: 99,
          tier: 3,
        });
      }
    }

    // match to tracks: smooth distance, estimate closing speed, require 2 sightings
    const used = new Set<Track>();
    for (const it of items) {
      let b: Track | null = null,
        bd = 1e9;
      for (const tr of this.tracks) {
        if (tr.cls !== it.cls || used.has(tr)) continue;
        const dd = Math.hypot(tr.cx - it.cx, tr.cy - it.cy);
        if (dd < bd && dd < 0.2 * W) {
          bd = dd;
          b = tr;
        }
      }
      if (b) {
        const dt = t - b.t;
        it.d = 0.6 * b.d + 0.4 * it.d;
        if (dt > 0) b.v = b.v * 0.6 + ((b.d - it.d) / dt) * 0.4;
        Object.assign(b, { cx: it.cx, cy: it.cy, d: it.d, t, seen: t });
        b.hits++;
      } else {
        b = {
          id: ++this.nid,
          cls: it.cls,
          cx: it.cx,
          cy: it.cy,
          d: it.d,
          v: 0,
          t,
          seen: t,
          hits: 1,
        };
        this.tracks.push(b);
      }
      used.add(b);
      it.ok = it.cls === "obstacle" || b.hits >= 2 || it.s > 0.75;
      it.inPath = Math.abs(it.lat) - it.ow / 2 < 0.7;
      it.ttc = b.v > 1 ? it.d / b.v : 99;
      it.tier =
        (it.risk === 3 &&
          ((it.ttc < 3.5 && Math.abs(it.lat) < 2.5) ||
            (it.inPath && it.d < 3))) ||
        (it.inPath && it.d < 1.2)
          ? 0
          : it.inPath && it.d < 3.5
            ? 1
            : 3;
    }
    this.tracks = this.tracks.filter((x) => t - x.seen < 1);

    items = items
      .filter((i) => i.ok)
      .sort((a, b) => a.tier - b.tier || a.d - b.d);
    return (this.items = items);
  }
}
