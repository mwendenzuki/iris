import { focalPx, type Box, type Item } from './types'

/**
 * Monocular depth (Depth Anything V2 small via transformers.js) with metric calibration.
 * The model gives relative disparity; we fit disparity -> 1/metres using detected objects
 * of known size (and a floor anchor) so depth can be read in metres anywhere in the frame.
 * It also scans three bands ahead for unnamed obstacles (poles, walls, kerbs).
 *
 * transformers.js is loaded from the CDN at runtime (it's large and pulls in onnxruntime-web).
 */
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1'
const MODEL = 'onnx-community/depth-anything-v2-small'
const IN_W = 252
const IN_H = 196

interface DepthTensor {
  data: ArrayLike<number>
  dims: number[]
}
type DepthPipeline = ((img: unknown) => Promise<{ predicted_depth: DepthTensor }>) & {
  processor?: { image_processor?: { size?: unknown } }
}
interface TransformersModule {
  RawImage: { fromCanvas(c: HTMLCanvasElement): Promise<unknown> }
  pipeline(task: string, model: string, opts: Record<string, unknown>): Promise<DepthPipeline>
}

interface DepthMap {
  d: ArrayLike<number>
  w: number
  h: number
}
interface Calibration {
  a: number
  b: number
}
export interface ScanHit {
  /** 0 = left, 1 = centre, 2 = right */
  band: number
  /** metres */
  d: number
}

export class DepthEstimator {
  failed = false
  /** Depth-only obstacles confirmed over two scans, with the time (s) they were found */
  obstacles: { list: ScanHit[]; t: number } = { list: [], t: 0 }

  private pipe: DepthPipeline | null = null
  private tf: TransformersModule | null = null
  private map: DepthMap | null = null
  private cal: Calibration | null = null
  private busy = false
  private prevScan: ScanHit[] = []
  private canvas: HTMLCanvasElement

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = IN_W
    this.canvas.height = IN_H
  }

  get status(): 'calibrated' | 'warming up' | 'off' {
    return this.cal ? 'calibrated' : this.pipe ? 'warming up' : 'off'
  }

  async load(): Promise<void> {
    try {
      const tf = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as TransformersModule
      this.tf = tf
      const make = (opts: Record<string, unknown>) => tf.pipeline('depth-estimation', MODEL, opts)
      try {
        this.pipe = 'gpu' in navigator ? await make({ device: 'webgpu', dtype: 'fp16' }) : await make({ dtype: 'q8' })
      } catch {
        this.pipe = await make({ dtype: 'q8' })
      }
      try {
        if (this.pipe.processor?.image_processor) this.pipe.processor.image_processor.size = { width: IN_W, height: IN_H }
      } catch {
        /* keep default size */
      }
    } catch {
      this.pipe = null
      this.failed = true
    }
  }

  /** Depth in metres for a box, or null if not calibrated yet. */
  depthAt(box: Box, W: number, H: number): number | null {
    return this.map && this.cal ? this.toMetres(this.dispAt(box, W, H)) : null
  }

  /** Run one depth pass on the current frame (skips if the previous one is still running). */
  async tick(video: HTMLVideoElement, items: Item[], camH: number, isRunning: () => boolean): Promise<void> {
    if (!this.pipe || !this.tf || this.busy || !isRunning()) return
    this.busy = true
    try {
      const W = video.videoWidth
      const H = video.videoHeight
      this.canvas.getContext('2d')!.drawImage(video, 0, 0, IN_W, IN_H)
      const out = await this.pipe(await this.tf.RawImage.fromCanvas(this.canvas))
      const p = out.predicted_depth
      const s = p.dims
      this.map = { d: p.data, w: s[s.length - 1], h: s[s.length - 2] }
      this.calibrate(items, W, H, camH)
      if (this.cal) {
        const now = this.scan(H, camH)
        // only keep hits that also appeared in the previous scan
        this.obstacles = {
          list: now.filter((n) => this.prevScan.some((q) => q.band === n.band)),
          t: performance.now() / 1000,
        }
        this.prevScan = now
      }
    } catch {
      /* skip this frame */
    }
    this.busy = false
  }

  private sample(nx: number, ny: number): number {
    const { d, w, h } = this.map!
    const y = Math.min(h - 1, Math.max(0, Math.round(ny * h)))
    const x = Math.min(w - 1, Math.max(0, Math.round(nx * w)))
    return d[y * w + x]
  }

  /** Median disparity over a 5x5 grid inside the box. */
  private dispAt([x, y, w, h]: Box, W: number, H: number): number {
    const a: number[] = []
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) a.push(this.sample((x + w * (0.2 + 0.15 * i)) / W, (y + h * (0.2 + 0.15 * j)) / H))
    a.sort((p, q) => p - q)
    return a[12]
  }

  private toMetres(s: number): number {
    const c = this.cal!
    return Math.min(30, 1 / Math.max(c.a * s + c.b, 0.033))
  }

  private calibrate(items: Item[], W: number, H: number, camH: number): void {
    const A: [number, number][] = []
    for (const it of items) {
      if (it.cls === 'obstacle' || it.trunc || it.ds > 12 || it.ds < 0.8) continue
      const s = this.dispAt(it.box, W, H)
      if (s > 0) A.push([s, 1 / it.ds])
    }
    if (A.length < 2) {
      // ground anchor: floor ~2.5 m ahead when the phone is held level
      const s = this.dispAt([0.4 * W, 0.88 * H, 0.2 * W, 0.06 * H], W, H)
      if (s > 0) A.push([s, 1 / ((camH * 0.866) / 0.41)])
    }
    if (!A.length) return

    let a: number
    let b = 0
    const n = A.length
    const mx = A.reduce((q, p) => q + p[0], 0) / n
    const my = A.reduce((q, p) => q + p[1], 0) / n
    const vx = A.reduce((q, p) => q + (p[0] - mx) ** 2, 0) / n
    if (n >= 3 && vx > (0.15 * mx) ** 2) {
      a = A.reduce((q, p) => q + (p[0] - mx) * (p[1] - my), 0) / n / vx
      b = my - a * mx
    } else {
      const r = A.map((p) => p[1] / p[0]).sort((p, q) => p - q)
      a = r[r.length >> 1]
    }
    if (!(a > 0)) return
    this.cal = this.cal ? { a: 0.5 * this.cal.a + 0.5 * a, b: 0.5 * this.cal.b + 0.5 * b } : { a, b }
  }

  /** Look for things closer than the floor should be, in left / centre / right bands. */
  private scan(H: number, camH: number): ScanHit[] {
    const f = focalPx(H)
    const out: ScanHit[] = []
    const bands: [number, number][] = [
      [0.2, 0.4],
      [0.4, 0.6],
      [0.6, 0.8],
    ]
    bands.forEach((bd, i) => {
      let c = 0
      const ds: number[] = []
      for (let yy = 0.25; yy <= 0.9; yy += 0.05)
        for (let xx = bd[0] + 0.02; xx < bd[1]; xx += 0.04) {
          c++
          const d = this.toMetres(this.sample(xx, yy))
          const dy = (yy - 0.5) * H
          const lim = dy > 0.05 * H ? (0.7 * camH * f) / dy : 3
          if (d < lim && d < 8) ds.push(d)
        }
      if (ds.length / c > 0.15) {
        ds.sort((p, q) => p - q)
        out.push({ band: i, d: ds[Math.floor(ds.length * 0.2)] })
      }
    })
    return out
  }
}
