import { useEffect, useRef, useState } from "react";
import type { Priority } from "../audio/speaker";
import { Guide, type GuideSettings } from "../engine/guide";
import type { LatLng } from "../geo/geo";
import { MicIcon } from "./icons";

interface Props {
  settings: GuideSettings;
  position: LatLng | null;
  onEnd(): void;
}

export function RunScreen({ settings, position, onEnd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<Guide | null>(null);
  const [message, setMessage] = useState<{ text: string; p?: Priority }>({
    text: "Starting…",
  });
  const [status, setStatus] = useState("");

  useEffect(() => {
    const guide = new Guide(settings, position, {
      onMessage: (text, p) => setMessage({ text, p }),
      onStatus: setStatus,
      onStopRequested: onEnd,
    });
    guideRef.current = guide;
    guide.start(videoRef.current!, canvasRef.current!);
    return () => {
      guide.stop();
      guideRef.current = null;
    };
    // Start once per run; settings/position are fixed while walking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="run">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} />
      {/* No aria-live on purpose: IRIS already speaks every message, so a screen reader would read it twice. */}
      <div className={`msg${message.p !== undefined ? " t" + message.p : ""}`}>
        {message.text}
      </div>
      <div className="status">{status}</div>
      {settings.calibrate && (
        <div className="calibrate">
          <p>
            Stand a person in view, head and feet visible, at a measured
            distance from the phone.
          </p>
          <div className="row">
            <label>
              Distance (m)
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={calDistance}
                onChange={(e) => setCalDistance(e.target.value)}
              />
            </label>
            <label>
              Their height (cm)
              <input
                type="number"
                inputMode="numeric"
                value={calHeight}
                onChange={(e) => setCalHeight(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setCalResult(
                  guideRef.current?.calibrate(+calDistance, +calHeight) ?? "",
                )
              }
            >
              Calibrate
            </button>
          </div>
          {calResult && <p aria-live="polite">{calResult}</p>}
        </div>
      )}
      <div className="bar">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => guideRef.current?.describe(false)}
        >
          What's ahead?
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => guideRef.current?.command()}
        >
          <MicIcon />
          Voice
        </button>
        <button type="button" className="btn btn--stop" onClick={onEnd}>
          Stop
        </button>
      </div>
    </div>
  );
}
