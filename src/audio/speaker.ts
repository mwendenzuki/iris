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

/** Speak once and resolve when finished (used for setup prompts). */
export function speakAndWait(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = 1.05
    u.onend = u.onerror = () => resolve()
    speechSynthesis.speak(u)
  })
}

/** Minimum seconds since the last utterance before a new one, per priority. */
const GAP: Record<Priority, number> = { 0: 0.6, 1: 2.5, 2: 6 }

/**
 * Priority arbiter for spoken output. Higher-priority messages interrupt
 * lower ones; repeats of the same message key are throttled.
 */
export class Speaker {
  lang = 'en-US'
  lastSpeak = 0
  lastText = ''
  private speaking = false
  private current = 9
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
      if (this.current === 0 && p !== 0) return false
      if (!force && p >= this.current) return false
      speechSynthesis.cancel()
    } else if (!force && t - this.lastSpeak < GAP[p]) {
      return false
    }

    this.cool[key] = t
    this.lastSpeak = t
    this.current = p
    this.speaking = true
    this.lastText = text

    if (p === 0) {
      beep(1000, 150)
      vibrate([200, 80, 200])
    } else if (p === 1) {
      vibrate(100)
    }

    const u = new SpeechSynthesisUtterance(text)
    const id = ++this.sid
    u.lang = this.lang
    u.rate = 1.1
    u.onend = u.onerror = () => {
      if (id === this.sid) {
        this.speaking = false
        this.current = 9
      }
    }
    speechSynthesis.speak(u)
    this.onShow(text, p)
    return true
  }

  /** Cut off whatever is being said (e.g. before listening). */
  interrupt(): void {
    speechSynthesis.cancel()
    this.speaking = false
    this.current = 9
  }
}
