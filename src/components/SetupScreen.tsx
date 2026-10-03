import { useState } from 'react'
import { canListen, listen, parseHeight } from '../audio/listen'
import { speakAndWait } from '../audio/speaker'
import type { GuideSettings } from '../engine/guide'
import { TX, type Lang } from '../i18n/strings'

export type LocationState = 'finding' | 'found' | 'unavailable'

interface Props {
  initial: GuideSettings
  location: LocationState
  onStart(settings: GuideSettings): void
}

const LOCATION_TEXT: Record<LocationState, string> = {
  finding: 'Finding your location…',
  found: 'Location found ✓',
  unavailable: 'Location unavailable. Obstacle guidance will still work.',
}

const SKIP = /^(none|no|skip|hapana|hakuna)/i

export function SetupScreen({ initial, location, onStart }: Props) {
  const [height, setHeight] = useState(String(initial.heightCm))
  const [lang, setLang] = useState<Lang>(initial.lang)
  const [destination, setDestination] = useState(initial.destination)
  const [voiceStatus, setVoiceStatus] = useState('')
  const [voiceBusy, setVoiceBusy] = useState(false)

  const settings = (h = height, l = lang, d = destination): GuideSettings => ({
    lang: l,
    heightCm: +h || 165,
    destination: d,
  })

  async function voiceSetup() {
    if (!canListen()) {
      setVoiceStatus(TX.en.nosr)
      speakAndWait(TX.en.nosr, 'en-US')
      return
    }
    setVoiceBusy(true)

    setVoiceStatus('Listening: language…')
    await speakAndWait('Say English, or say Kiswahili. Sema Kiingereza, au sema Kiswahili.', 'en-US')
    const l: Lang = /swahili|kiswa/i.test((await listen('en-US')) ?? '') ? 'sw' : 'en'
    const T = TX[l]
    setLang(l)

    let h: number | null = null
    for (let i = 0; i < 2 && !h; i++) {
      setVoiceStatus('Listening: height…')
      await speakAndWait(T.askH, T.lang)
      h = parseHeight(await listen(T.lang))
      if (!h) await speakAndWait(T.miss, T.lang)
    }
    const hStr = h ? String(h) : height
    setHeight(hStr)

    setVoiceStatus('Listening: destination…')
    await speakAndWait(T.askD, T.lang)
    const heard = ((await listen(T.lang)) ?? '').trim()
    const d = heard && !SKIP.test(heard) ? heard : ''
    setDestination(d)

    setVoiceStatus(`Height ${hStr} cm · ${d || 'no destination'}`)
    await speakAndWait(T.conf(hStr, d), T.lang)
    setVoiceBusy(false)
    onStart(settings(hStr, l, d))
  }

  return (
    <main className="setup">
      <h1>Iris</h1>
      <p className="sub-title">Your walking guide. Set up by voice or by typing, then point your phone ahead and walk.</p>

      <button
        type="button"
        className="alt"
        disabled={voiceBusy}
        onClick={voiceSetup}
        aria-label="Set up by voice. Iris will ask your language, height and destination."
      >
        Set up by voice
      </button>
      <p className="note" aria-live="polite">
        {voiceStatus}
      </p>

      <label htmlFor="h">Your height (cm)</label>
      <input id="h" type="number" inputMode="numeric" min={100} max={220} value={height} onChange={(e) => setHeight(e.target.value)} />

      <label htmlFor="l">Language</label>
      <select id="l" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        <option value="en">English</option>
        <option value="sw">Kiswahili</option>
      </select>

      <label htmlFor="d">Where to? (optional)</label>
      <input id="d" type="text" placeholder="e.g. Konza Technopolis Complex" value={destination} onChange={(e) => setDestination(e.target.value)} />

      <p className="note">{LOCATION_TEXT[location]}</p>

      <button type="button" onClick={() => onStart(settings())}>
        Start walking
      </button>
      <p className="note">
        Iris supports your cane or guide dog. It does not replace them. Hold the phone upright at chest height, camera facing forward.
      </p>
    </main>
  )
}
