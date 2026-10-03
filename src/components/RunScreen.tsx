import { useEffect, useRef, useState } from 'react'
import type { Priority } from '../audio/speaker'
import { Guide, type GuideSettings } from '../engine/guide'
import type { LatLng } from '../geo/geo'

interface Props {
  settings: GuideSettings
  position: LatLng | null
  onEnd(): void
}

export function RunScreen({ settings, position, onEnd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const guideRef = useRef<Guide | null>(null)
  const [message, setMessage] = useState<{ text: string; p?: Priority }>({ text: 'Starting…' })
  const [status, setStatus] = useState('')

  useEffect(() => {
    const guide = new Guide(settings, position, {
      onMessage: (text, p) => setMessage({ text, p }),
      onStatus: setStatus,
      onStopRequested: onEnd,
    })
    guideRef.current = guide
    guide.start(videoRef.current!, canvasRef.current!)
    return () => {
      guide.stop()
      guideRef.current = null
    }
    // Start once per run; settings/position are fixed while walking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="run">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} />
      <div className={`msg${message.p !== undefined ? ' t' + message.p : ''}`} role="status" aria-live="assertive">
        {message.text}
      </div>
      <div className="status">{status}</div>
      <div className="bar">
        <button type="button" className="alt" onClick={() => guideRef.current?.describe(false)}>
          What's ahead?
        </button>
        <button type="button" onClick={() => guideRef.current?.command()}>
          Voice
        </button>
        <button type="button" className="stop" onClick={onEnd}>
          Stop
        </button>
      </div>
    </div>
  )
}
