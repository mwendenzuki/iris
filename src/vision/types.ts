import { rad } from '../geo/geo'
import type { Risk } from '../i18n/strings'
import type { DistanceEstimate } from './distance'

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
  /** geometric (size + ground) distance estimate, metres; used to calibrate the depth model */
  ds: number
  /** box touches the top or bottom of the frame (object partly out of view) */
  trunc: boolean
  /** the individual distance estimates, for debugging / calibration */
  est?: DistanceEstimate
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

// ---------- camera focal length ----------
// Default assumes a ~60° vertical field of view (typical phone main camera in portrait).
// Each device can be calibrated once (see Guide.calibrate); the result is saved per browser.

const FOCAL_KEY = 'iris.focalScale'

function readScale(): number {
  try {
    const v = parseFloat(localStorage.getItem(FOCAL_KEY) ?? '')
    return v > 0.3 && v < 4 ? v : 1
  } catch {
    return 1
  }
}

let focalScale = readScale()

/** Focal length in pixels for a frame `H` pixels tall. */
export const focalPx = (H: number): number => (focalScale * H) / (2 * Math.tan(rad(30)))

export const getFocalScale = (): number => focalScale

export function setFocalScale(s: number): void {
  focalScale = s
  try {
    localStorage.setItem(FOCAL_KEY, String(s))
  } catch {
    /* storage unavailable: applies for this session only */
  }
}
