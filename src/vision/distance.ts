import { rad } from '../geo/geo'
import type { ObjectInfo } from '../i18n/strings'
import { focalPx, type Box } from './types'

/** Where the camera is: height above ground and downward tilt (null = unknown, e.g. laptop). */
export interface CameraPose {
  heightM: number
  pitchDeg: number | null
}

/** Each estimate in metres (undefined = not usable for this box), plus the fused result. */
export interface DistanceEstimate {
  /** from apparent height vs. typical real height */
  size?: number
  /** from where the object touches the ground, using camera height and tilt */
  ground?: number
  /** from apparent width (people only, used when the height is cut off) */
  width?: number
  /** from the calibrated depth model */
  depth?: number
  /** combined estimate */
  fused: number
  /** combined estimate without the depth model (used to calibrate the depth model) */
  geometric: number
  /** box touches the top / bottom edge of the frame */
  cutTop: boolean
  cutBottom: boolean
}

const MIN_D = 0.4
const MAX_D = 30
/** Typical shoulder-to-shoulder box width of a person, metres. */
const PERSON_WIDTH = 0.5
const EDGE_PX = 4

const clamp = (d: number) => Math.min(MAX_D, Math.max(MIN_D, d))

/**
 * Ground-plane distance: a point on the ground that appears `y` pixels down the frame
 * is seen at angle (tilt + angle below the optical axis); distance = cameraHeight / tan(angle).
 */
export function groundDistance(yBottom: number, H: number, f: number, pose: CameraPose): number | undefined {
  const angle = rad(pose.pitchDeg ?? 0) + Math.atan((yBottom - H / 2) / f)
  if (angle < rad(1.5)) return undefined // at or above the horizon: unusable
  return pose.heightM / Math.tan(angle)
}

/**
 * Weighted geometric mean of the available estimates. Distance errors are roughly
 * proportional (10% off at 2 m and at 10 m), so averaging in log space is the right fit.
 */
function fuse(parts: [number | undefined, number][]): number | undefined {
  let sw = 0
  let sl = 0
  for (const [d, w] of parts) {
    if (d === undefined || !(d > 0) || w <= 0) continue
    sw += w
    sl += w * Math.log(d)
  }
  return sw > 0 ? Math.exp(sl / sw) : undefined
}

export function estimateDistance(
  cls: string,
  info: ObjectInfo,
  box: Box,
  W: number,
  H: number,
  pose: CameraPose,
  depthM: number | null,
): DistanceEstimate {
  void W
  const f = focalPx(H)
  const [, y, w, h] = box
  const cutTop = y < EDGE_PX
  const cutBottom = y + h > H - EDGE_PX

  const e: DistanceEstimate = { fused: 0, geometric: 0, cutTop, cutBottom }

  // 1. Size: only trustworthy when the whole object is in frame
  if (!cutTop && !cutBottom && info.height > 0) e.size = clamp((info.height * f) / h)

  // 2. Ground contact: needs the object's base in frame and an object that stands on the ground
  if (info.ground && !cutBottom) {
    const g = groundDistance(y + h, H, f, pose)
    if (g !== undefined) e.ground = clamp(g)
  }

  // 3. Width: fallback for people whose head or feet are out of frame
  if (cls === 'person' && (cutTop || cutBottom)) e.width = clamp((PERSON_WIDTH * f) / w)

  if (depthM != null && depthM > 0) e.depth = clamp(depthM)

  // Ground-plane is the most reliable when we know the tilt; without a tilt sensor
  // (laptop) the "level camera" guess is rough, so it counts for much less.
  const groundW = pose.pitchDeg == null ? 0.4 : 2
  const geometric = fuse([
    [e.size, 1],
    [e.ground, groundW],
    [e.width, 0.5],
  ])
  // Nothing geometric usable (object cut off on both ends, or floating): old behaviour
  e.geometric = geometric ?? clamp(((info.height || 1) * f) / h * (cutBottom ? 0.8 : 1))
  e.fused = clamp(fuse([[e.geometric, geometric ? 1.5 : 0.5], [e.depth, 1]]) ?? e.geometric)
  return e
}
