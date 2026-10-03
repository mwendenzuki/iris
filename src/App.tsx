import { useEffect, useState } from 'react'
import { Navigate as Redirect, Route, Routes, useNavigate } from 'react-router-dom'
import { speakAndWait } from './audio/speaker'
import type { LocationState } from './components/SetupScreen'
import type { GuideSettings } from './engine/guide'
import { getCurrentPosition, requestCompassPermission, type LatLng } from './geo/geo'
import { TX } from './i18n/strings'
import Navigate from './pages/Navigate'
import Onboarding from './pages/Onboarding'

/**
 * Holds the state shared by both pages (settings + location) and the routes:
 *   /          Onboarding — language, height, destination
 *   /navigate  Navigate   — camera, obstacle alerts, directions
 */
export default function App() {
  const go = useNavigate()
  const [settings, setSettings] = useState<GuideSettings>({ lang: 'en', heightCm: 165, destination: '' })
  const [position, setPosition] = useState<LatLng | null>(null)
  const [location, setLocation] = useState<LocationState>('finding')
  const [started, setStarted] = useState(false)

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
    setStarted(true)
    go('/navigate')
  }

  function end() {
    setStarted(false)
    go('/')
  }

  return (
    <Routes>
      <Route path="/" element={<Onboarding initial={settings} location={location} onStart={start} />} />
      <Route
        path="/navigate"
        element={
          // Opening /navigate directly (e.g. after a refresh) goes back to setup first
          started ? <Navigate settings={settings} position={position} onEnd={end} /> : <Redirect to="/" replace />
        }
      />
      <Route path="*" element={<Redirect to="/" replace />} />
    </Routes>
  )
}
