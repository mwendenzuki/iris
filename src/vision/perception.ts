import { OBJECTS } from '../i18n/strings'
import type { DepthEstimator } from './depth'
import { focalPx, type Item, type Prediction } from './types'

interface Track {
  id: number
  cls: string
  cx: number
  cy: number
  d: number
  /** closing speed, m/s (positive = approaching) */
  v: number
  t: number
  seen: number
  hits: number
}

/** Half-width of the walking corridor in metres. */
const PATH_HALF_WIDTH = 0.7

/**
 * Turns raw detections (+ depth) into ranked, tracked hazards.
 */
export class Perception {
  /** latest confirmed items, most urgent first */
  last: Item[] = []
  private tracks: Track[] = []
  private nid = 0

  perceive(preds: Prediction[], t: number, W: number, H: number, depth: DepthEstimator): Item[] {
    const f = focalPx(H)
    let items: Item[] = []

    for (const p of preds) {
      const o = OBJECTS[p.class]
      if (!o || p.score < (o.risk === 3 || p.class === 'person' ? 0.5 : 0.55)) continue
      const [x, y, w, h] = p.bbox
      const trunc = y + h > H - 6
      const ds = Math.min(30, Math.max(0.4, ((o.height * f) / h) * (trunc ? 0.8 : 1)))
      const dd = depth.depthAt(p.bbox, W, H)
      const d = dd ? (trunc ? dd : 0.6 * dd + 0.4 * ds) : ds
      items.push(this.item(p.class, x + w / 2, y + h / 2, d, ds, trunc, p.score, o.risk, p.bbox, (w / f) * d, ((x + w / 2 - W / 2) / f) * d))
    }

    // unnamed obstacles from the depth scan (fresh within 1.5 s)
    if (t - depth.obstacles.t < 1.5) {
      for (const o of depth.obstacles.list) {
        const x = (0.2 + 0.2 * o.band) * W
        items.push(
          this.item('obstacle', x + 0.1 * W, 0.5 * H, o.d, o.d, false, 1, 1, [x, 0.3 * H, 0.2 * W, 0.5 * H], 0.8, (((o.band - 1) * 0.2 * W) / f) * o.d),
        )
      }
    }

    // match to tracks, smooth distance, estimate closing speed
    const used = new Set<Track>()
    for (const it of items) {
      let best: Track | null = null
      let bestD = 1e9
      for (const tr of this.tracks) {
        if (tr.cls !== it.cls || used.has(tr)) continue
        const dd = Math.hypot(tr.cx - it.cx, tr.cy - it.cy)
        if (dd < bestD && dd < 0.2 * W) {
          bestD = dd
          best = tr
        }
      }
      if (best) {
        const dt = t - best.t
        it.d = 0.6 * best.d + 0.4 * it.d
        if (dt > 0) best.v = best.v * 0.6 + ((best.d - it.d) / dt) * 0.4
        Object.assign(best, { cx: it.cx, cy: it.cy, d: it.d, t, seen: t })
        best.hits++
      } else {
        best = { id: ++this.nid, cls: it.cls, cx: it.cx, cy: it.cy, d: it.d, v: 0, t, seen: t, hits: 1 }
        this.tracks.push(best)
      }
      used.add(best)

      it.ok = it.cls === 'obstacle' || best.hits >= 2 || it.score > 0.75 // confirm over 2 frames unless very confident
      it.inPath = Math.abs(it.lat) - it.ow / 2 < PATH_HALF_WIDTH
      it.ttc = best.v > 1 ? it.d / best.v : 99
      const vehicleDanger = it.risk === 3 && ((it.ttc < 3.5 && Math.abs(it.lat) < 2.5) || (it.inPath && it.d < 3))
      it.tier = vehicleDanger || (it.inPath && it.d < 1.2) ? 0 : it.inPath && it.d < 3.5 ? 1 : 3
    }

    this.tracks = this.tracks.filter((x) => t - x.seen < 1)
    items = items.filter((i) => i.ok).sort((a, b) => a.tier - b.tier || a.d - b.d)
    this.last = items
    return items
  }

  private item(
    cls: string, cx: number, cy: number, d: number, ds: number, trunc: boolean,
    score: number, risk: Item['risk'], box: Item['box'], ow: number, lat: number,
  ): Item {
    return { cls, cx, cy, d, ds, trunc, score, risk, box, ow, lat, ok: false, inPath: false, ttc: 99, tier: 3 }
  }
}
