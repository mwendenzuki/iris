import '@tensorflow/tfjs'
import * as cocoSsd from '@tensorflow-models/coco-ssd'
import type { Prediction } from './types'

export interface Detector {
  detect(video: HTMLVideoElement): Promise<Prediction[]>
}

let loading: Promise<Detector> | null = null

/** Load COCO-SSD once and reuse it across runs. */
export function loadDetector(): Promise<Detector> {
  loading ??= cocoSsd
    .load({ base: 'mobilenet_v2' })
    .then((model) => ({
      detect: (video: HTMLVideoElement) => model.detect(video, 15, 0.4) as Promise<Prediction[]>,
    }))
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}
