import type { Lang } from '../i18n/strings'

export type GeminiMode = 'describe' | 'hazards'

export interface GeminiHazard {
  label: string
  side: 'left' | 'ahead' | 'right'
  distance_m: number
  urgent: boolean
}

export interface GeminiResult {
  summary: string
  hazards: GeminiHazard[]
}

const FRAME_WIDTH = 512

/**
 * Sends a camera frame to our /api/describe function (which calls Gemini) and returns
 * a spoken-style summary plus structured hazards. Never throws: returns null on any failure.
 * If the server has no API key (or there is no /api route), it switches itself off for the session.
 */
export class GeminiEyes {
  /** false once we learn Gemini isn't set up, so we stop trying */
  available = true
  /** a background (hazard) request is in flight */
  busy = false
  /** latest hazard list from Gemini, with the time (s) it arrived */
  recent: { hazards: GeminiHazard[]; t: number } | null = null
  private canvas = document.createElement('canvas')

  async ask(video: HTMLVideoElement, mode: GeminiMode, lang: Lang, stride: number, timeoutMs = 7000): Promise<GeminiResult | null> {
    if (!this.available || !video.videoWidth) return null
    const image = this.grab(video)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch('/api/describe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, mode, lang, stride }),
        signal: ctrl.signal,
      })
      // 404: no API route (static host); 503: no key configured; 405: wrong server
      if (res.status === 404 || res.status === 503 || res.status === 405) {
        this.available = false
        return null
      }
      if (!res.ok) return null
      const r = (await res.json()) as Partial<GeminiResult>
      const out: GeminiResult = {
        summary: typeof r.summary === 'string' ? r.summary : '',
        hazards: Array.isArray(r.hazards) ? r.hazards.filter((h) => h && typeof h.label === 'string') : [],
      }
      this.recent = { hazards: out.hazards, t: performance.now() / 1000 }
      return out
    } catch {
      return null // timeout or offline: the on-device pipeline carries on
    } finally {
      clearTimeout(timer)
    }
  }

  /** Current frame as base64 JPEG, downscaled to keep uploads small on mobile data. */
  private grab(video: HTMLVideoElement): string {
    const scale = FRAME_WIDTH / video.videoWidth
    this.canvas.width = FRAME_WIDTH
    this.canvas.height = Math.round(video.videoHeight * scale)
    this.canvas.getContext('2d')!.drawImage(video, 0, 0, this.canvas.width, this.canvas.height)
    return this.canvas.toDataURL('image/jpeg', 0.7).split(',')[1]
  }
}
