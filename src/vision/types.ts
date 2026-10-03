import { rad } from '../geo/geo'
import type { Risk } from '../i18n/strings'

/** [x, y, width, height] in video pixels */
export type Box = [number, number, number, number]

/** 0 = stop now, 1 = warn, 3 = just informational */
export type Tier = 0 | 1 | 3

export interface Prediction {
  class: string
  score: number
  bbox: Box
}

export interface Item {
  cls: string
  cx: number
  cy: number
  /** fused distance estimate, metres */
  d: number
  /** size-based distance estimate, metres */
  ds: number
  /** box touches the bottom of the frame (object partly out of view) */
  trunc: boolean
  score: number
  risk: Risk
  box: Box
  /** approx. object width in metres */
  ow: number
  /** lateral offset from camera axis in metres (negative = left) */
  lat: number
  /** confirmed (seen in 2+ frames, or very confident) */
  ok: boolean
  inPath: boolean
  /** time to collision, seconds (99 = not approaching) */
  ttc: number
  tier: Tier
}

/** Focal length in pixels, assuming ~60° vertical field of view. */
export const focalPx = (H: number): number => H / (2 * Math.tan(rad(30)))
