import { beep } from './speaker'

// The Web Speech recognition API isn't in TypeScript's DOM lib, so describe the bits we use.
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}
interface Recognition {
  lang: string
  interimResults: boolean
  onresult: ((e: RecognitionResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
}
type RecognitionCtor = new () => Recognition

const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
const SR: RecognitionCtor | undefined = w.SpeechRecognition ?? w.webkitSpeechRecognition

export const canListen = (): boolean => !!SR

/** Listen for one phrase. Resolves with the transcript, or null on silence/error/unsupported. */
export function listen(lang: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!SR) return resolve(null)
    const r = new SR()
    let done = false
    r.lang = lang
    r.interimResults = false
    r.onresult = (e) => {
      done = true
      resolve(e.results[0][0].transcript)
    }
    r.onerror = r.onend = () => {
      if (!done) resolve(null)
    }
    beep(660, 90)
    try {
      r.start()
    } catch {
      resolve(null)
    }
  })
}

/** Parse a spoken height: "1.65", "5 foot 6", "165". Returns centimetres or null. */
export function parseHeight(s: string | null): number | null {
  if (!s) return null
  s = s.toLowerCase()
  let m = s.match(/\b([12])[.,](\d{1,2})\b/)
  if (m) return Math.round(parseFloat(m[1] + '.' + m[2]) * 100)
  m = s.match(/(\d)\s*(?:feet|foot|ft|')\s*(\d{1,2})?/)
  if (m) return Math.round(+m[1] * 30.48 + (+m[2] || 0) * 2.54)
  m = s.match(/\d+/)
  const n = m ? +m[0] : 0
  return n >= 100 && n <= 220 ? n : null
}
