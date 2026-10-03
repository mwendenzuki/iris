import '@tensorflow/tfjs'
import * as cocoSsd from '@tensorflow-models/coco-ssd'
import type { Prediction } from './types'

export interface Detector {
  detect(video: HTMLVideoElement): Promise<Prediction[]>
}

/** Self-hosted weights (run `npm run fetch-model` once to create them). */
const LOCAL_MODEL_URL = '/models/coco-ssd/model.json'

let loading: Promise<Detector> | null = null

async function load(): Promise<cocoSsd.ObjectDetection> {
  // Prefer our own copy: works offline once cached and isn't blocked by ad/tracker blockers.
  // (check the content type: dev servers answer missing files with index.html)
  const local = await fetch(LOCAL_MODEL_URL, { method: 'HEAD' }).then(
    (r) => r.ok && (r.headers.get('content-type') ?? '').includes('json'),
    () => false,
  )
  if (local) {
    try {
      return await cocoSsd.load({ base: 'mobilenet_v2', modelUrl: LOCAL_MODEL_URL })
    } catch {
      /* fall through to Google's copy */
    }
  }
  try {
    return await cocoSsd.load({ base: 'mobilenet_v2' })
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    throw new Error(`Could not download the detection model (${why}). Check your connection or browser shields, or run "npm run fetch-model".`, { cause: e })
  }
}

/** Load COCO-SSD once and reuse it across runs. */
export function loadDetector(): Promise<Detector> {
  loading ??= load()
    .then((model) => ({
      detect: (video: HTMLVideoElement) => model.detect(video, 15, 0.4) as Promise<Prediction[]>,
    }))
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}
