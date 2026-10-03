/** 0 = hazard (interrupts everything), 1 = warning, 2 = info / route */
export type Priority = 0 | 1 | 2

let audioCtx: AudioContext | undefined

export function beep(freq = 880, ms = 160): void {
  try {
    audioCtx ??= new AudioContext()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.frequency.value = freq
    gain.gain.value = 0.25
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + ms / 1000)
  } catch {
    /* audio not available */
  }
}

export function vibrate(pattern: number | number[]): void {
  // Not available on iOS Safari
  navigator.vibrate?.(pattern)
}

// ---------- low-level speech helpers ----------

let lastCancel = 0

/** Cancel whatever is being said. */
function cancelSpeech(): void {
  speechSynthesis.cancel()
  lastCancel = performance.now()
}

/**
 * Speak an utterance. Chrome can silently drop an utterance queued right after
 * cancel(), so wait a moment if we just cancelled. Also un-pause the engine,
 * which Chrome sometimes leaves paused.
 */
function speakNow(u: SpeechSynthesisUtterance): void {
  const go = () => {
    speechSynthesis.resume()
    speechSynthesis.speak(u)
  }
  const since = performance.now() - lastCancel
  if (since < 120) setTimeout(go, 120 - since)
  else go()
}

/**
 * Resolve when `u` finishes, with a safety timeout in case the browser never fires
 * onend (dropped utterance), so a conversation can never hang waiting for it.
 */
function whenDone(u: SpeechSynthesisUtterance, text: string, then?: () => void): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      then?.()
      resolve()
    }
    const timer = setTimeout(finish, 2500 + text.length * 90)
    u.onend = u.onerror = finish
  })
}

/** Speak once and resolve when finished (setup prompts). */
export function speakAndWait(text: string, lang: string): Promise<void> {
  cancelSpeech()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  u.rate = 1.05
  const done = whenDone(u, text)
  speakNow(u)
  return done
}

/** Minimum seconds since the last utterance before a new one, per priority. */
const GAP: Record<Priority, number> = { 0: 0.6, 1: 2.5, 2: 6 }

/**
 * Priority arbiter for spoken output. Higher-priority messages interrupt
 * lower ones; repeats of the same message key are throttled.
 *
 * `announce()` speaks something the user must hear in full (trip briefing, a
 * question, an answer). While it plays, only a priority-0 "Stop" can cut in;
 * other alerts are held back and retried on the next frame.
 */
export class Speaker {
  lang = 'en-US'
  lastSpeak = 0
  lastText = ''
  private speaking = false
  private current = 9
  private protect = false
  private sid = 0
  private cool: Record<string, number> = {}
  private onShow: (text: string, p: Priority) => void

  constructor(onShow: (text: string, p: Priority) => void) {
    this.onShow = onShow
  }

  /** Returns true if the message was spoken. `t` is seconds (performance.now()/1000). */
  say(p: Priority, key: string, text: string, t: number, force = false): boolean {
    const keyCooldown = p === 0 ? 2 : 5
    if (!force && this.cool[key] && t - this.cool[key] < keyCooldown) return false
    if (this.speaking) {
      if (this.protect && p !== 0) return false // let the announcement finish
      if (this.current === 0 && p !== 0) return false
      if (!force && p >= this.current) return false
      cancelSpeech()
    } else if (!force && t - this.lastSpeak < GAP[p]) {
      return false
    }

    this.cool[key] = t
    this.lastSpeak = t
    this.lastText = text
    if (p === 0) {
      beep(1000, 150)
      vibrate([200, 80, 200])
    } else if (p === 1) {
      vibrate(100)
    }
    void this.utter(text, p, false)
    return true
  }

  /** Speak in full and resolve when done. Only a priority-0 alert can interrupt it. */
  announce(text: string): Promise<void> {
    if (this.speaking) cancelSpeech()
    this.lastSpeak = performance.now() / 1000
    this.lastText = text
    return this.utter(text, 1, true)
  }

  /** Resolve once nothing is being said (max `maxMs`), e.g. before listening. */
  async idle(maxMs = 6000): Promise<void> {
    const end = performance.now() + maxMs
    while (this.speaking && performance.now() < end) await new Promise((r) => setTimeout(r, 100))
  }

  /** Cut off whatever is being said (e.g. before listening). */
  interrupt(): void {
    cancelSpeech()
    this.speaking = false
    this.protect = false
    this.current = 9
  }

  private utter(text: string, p: Priority, protect: boolean): Promise<void> {
    const u = new SpeechSynthesisUtterance(text)
    const id = ++this.sid
    u.lang = this.lang
    u.rate = 1.1
    this.speaking = true
    this.current = p
    this.protect = protect
    const done = whenDone(u, text, () => {
      if (id === this.sid) {
        this.speaking = false
        this.protect = false
        this.current = 9
      }
    })
    speakNow(u)
    this.onShow(text, p)
    return done
  }
}
