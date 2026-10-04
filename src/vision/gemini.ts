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
  /** why it was switched off (shown in the status line) */
  offReason = ''
  /** last failure while still on, e.g. "403" or "timeout" (cleared on success) */
  lastError = ''
  /** a background (hazard) request is in flight */
  busy = false
  /** latest hazard list from Gemini, with the time (s) it arrived */
  recent: { hazards: GeminiHazard[]; t: number } | null = null
  private canvas = document.createElement('canvas')

  async ask(video: HTMLVideoElement, mode: GeminiMode, lang: Lang, stride: number, timeoutMs = 18000): Promise<GeminiResult | null> {
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
      // 404/405: this server has no /api/describe (e.g. `npm run preview`); 503: no key configured
      if (res.status === 404 || res.status === 405) return this.off('no API on this server')
      if (res.status === 503) return this.off('no API key on the server')
      if (!res.ok) {
        // Gemini itself refused (bad key, quota, model name...): stay on, report it
        const body = (await res.json().catch(() => ({}))) as { status?: number; error?: string; reason?: string; message?: string }
        // e.g. "400: API key not valid…" (Google refused), "empty_reply MAX_TOKENS", "bad_json", or the raw HTTP code
        this.lastError = body.status
          ? `${body.status}${body.message ? ': ' + body.message.slice(0, 70) : ''}`
          : [body.error, body.reason].filter(Boolean).join(' ') || String(res.status)
        console.warn('[Iris] Gemini error', res.status, body)
        return null
      }
      this.lastError = ''
      const r = (await res.json()) as Partial<GeminiResult>
      const out: GeminiResult = {
        summary: typeof r.summary === 'string' ? r.summary : '',
        hazards: Array.isArray(r.hazards) ? r.hazards.filter((h) => h && typeof h.label === 'string') : [],
      }
      this.recent = { hazards: out.hazards, t: performance.now() / 1000 }
      return out
    } catch (e) {
      // AbortError = our timer fired (server too slow); anything else = no connection to the server
      this.lastError = e instanceof DOMException && e.name === 'AbortError' ? `timeout (no answer in ${timeoutMs / 1000}s)` : 'offline'
      console.warn('[Iris] Gemini request failed:', this.lastError, e)
      return null // the on-device pipeline carries on
    } finally {
      clearTimeout(timer)
    }
  }

  /** Short status for the screen: "on", "error 403", "off: no API key on the server". */
  get status(): string {
    if (!this.available) return `off: ${this.offReason}`
    return this.lastError ? `error ${this.lastError}` : 'on'
  }

  private off(reason: string): null {
    this.available = false
    this.offReason = reason
    console.warn('[Iris] Gemini switched off:', reason)
    return null
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
