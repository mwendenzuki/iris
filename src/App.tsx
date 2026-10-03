import { useEffect, useState } from 'react'
import { speakAndWait } from './audio/speaker'
import { RunScreen } from './components/RunScreen'
import { SetupScreen, type LocationState } from './components/SetupScreen'
import type { GuideSettings } from './engine/guide'
import { getCurrentPosition, requestCompassPermission, type LatLng } from './geo/geo'
import { TX } from './i18n/strings'

export default function App() {
  const [screen, setScreen] = useState<'setup' | 'run'>('setup')
  const [settings, setSettings] = useState<GuideSettings>({ lang: 'en', heightCm: 165, destination: '' })
  const [position, setPosition] = useState<LatLng | null>(null)
  const [location, setLocation] = useState<LocationState>('finding')

  useEffect(() => {
    getCurrentPosition().then((p) => {
      setPosition(p)
      setLocation(p ? 'found' : 'unavailable')
    })
  }, [])

  async function start(s: GuideSettings) {
    requestCompassPermission() // iOS: must be triggered from the tap
    setSettings(s)
    document.documentElement.lang = s.lang
    await speakAndWait(TX[s.lang].load, TX[s.lang].lang)
    setScreen('run')
  }

  return screen === 'setup' ? (
    <SetupScreen initial={settings} location={location} onStart={start} />
  ) : (
    <RunScreen settings={settings} position={position} onEnd={() => setScreen('setup')} />
  )
}
