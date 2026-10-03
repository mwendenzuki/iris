# Iris

A mobile-first web app that helps visually impaired people walk safely. Iris uses the phone camera to spot obstacles and GPS to give spoken, step-by-step directions, all hands-free.

## What it does

- **Obstacle detection:** the rear camera runs on-device models and warns you about things in your path, with direction ("Stop. Car, ahead." / "Person left, 3 steps. Move right 2 steps.").
- **Unnamed obstacles:** a depth model spots poles, walls and kerbs that the object detector can't name.
- **Step-by-step navigation:** say or type a destination and Iris reads out walking directions in steps, based on your stride length, corrected by the compass.
- **Voice first:** setup can be done entirely by voice, and everything important is spoken. Hazards also beep and vibrate.
- **English and Kiswahili.**
- **Personal setup:** your height sets stride length (`height × 0.415`) and camera height (`height × 0.72`).

## How it works

1. **Setup:** tap "Set up by voice" (Iris asks language → height → destination), or fill in the form and tap "Start walking".
2. **Walking:** the camera turns on and Iris speaks. Hazards always take priority over directions; when it's quiet, it gives the next route instruction or a short scene description.
3. **Buttons:** "What's ahead?" describes the scene, "Voice" takes a command (see below), "Stop" ends the walk.

## What Iris says

**Obstacles**: what, where, then what to do, as a sequence:
- "Chair ahead, 4 steps away. Walk 2 steps forward, then step 2 steps to your right, then continue."
- "Stop. Person ahead. Step 2 steps to your left, then continue."
- Vehicles only ever get "Stop. Car ahead." (never told to step sideways into traffic).

**Trip briefing**: when a route is set: "Route to KICC: 850 metres, about 1200 steps, roughly 16 minutes."
Then turn-by-turn ("Walk about 310 metres, then turn left" / "Walk 10 steps, then turn left"),
"You are halfway…", "Almost there…", "You have arrived at KICC." Time assumes ~0.9 m/s (cane walking pace).

**Voice commands** (tap Voice, then speak; English or Kiswahili):

| Say | Iris does |
|---|---|
| "change destination" / "badilisha mahali" | asks where, searches, reads back distance + time, waits for yes/no |
| "take me to KICC" / "nipeleke KICC" | same, without the question |
| "how far?" / "umbali gani?" | distance and minutes left |
| "cancel route" / "sitisha safari" | stops directions, keeps obstacle alerts |
| "repeat" / "rudia" | repeats the last message |
| "help" / "msaada" | lists the commands |
| "stop" / "simama" | ends the walk |
| anything else | describes what's ahead |

## Distance estimation

Each detected object gets up to four independent distance estimates, combined in `vision/distance.ts`:

| Estimate | How | Good when |
|---|---|---|
| size | apparent height vs. typical real height | whole object in frame |
| ground | where its base meets the ground, from camera height (≈ 0.72 × user height) and phone tilt | phone has a tilt sensor, base visible |
| width | apparent width (people only) | head or feet cut off |
| depth | Depth Anything model, calibrated against the above | after a few seconds of walking |

**Calibrate each demo device once** (camera lenses differ; laptop webcams read ~35% short without this):
1. On the setup screen tick **Distance calibration tools**, then Start walking.
2. Have someone stand a measured distance away (3 m works well), head and feet in view.
3. Enter the distance and their height, tap **Calibrate**. It's saved in that browser.

With the tools on, each box also shows `s g w d` (the four estimates) so you can see which one is off, and the status line shows the phone's tilt.

## Gemini (optional)

On-device models handle urgent alerts (fast, offline). Gemini adds understanding on top:

- **"What's ahead?"** sends one camera frame to Gemini and speaks its description in the user's language.
- **Background hazard check** every 8 s looks for things COCO can't name (potholes, open drains, kerbs, steps, poles, low branches) and speaks them as warnings, never as "Stop".
- If Gemini isn't configured, is slow (>6–7 s) or offline, Iris carries on exactly as before.

The API key never reaches the phone: the app posts frames to `/api/describe`, a Vercel function that calls Gemini.

Setup:
1. Get a key at https://aistudio.google.com/apikey
2. Locally: copy `.env.example` to `.env` and set `GEMINI_API_KEY`. `npm run dev` serves `/api/describe` itself.
3. On Vercel: add `GEMINI_API_KEY` under Project → Settings → Environment Variables, then redeploy.
4. Optional: `GEMINI_MODEL` to pin a model (default: `gemini-flash-latest`).

The status line on the walking screen shows `gemini on/off`. Camera frames are sent to Google while Gemini is on.

## Tech stack

- Vite + React + TypeScript
- TensorFlow.js + COCO-SSD (npm) for object detection
- Depth Anything V2 small via transformers.js (loaded from CDN at runtime) for depth
- OpenStreetMap Nominatim (place search) + OSRM foot routing — no API key needed
- Gemini (via a Vercel function in `api/`) for scene descriptions and extra hazards
- Web Speech API (speech out and in), Web Audio for tones, Vibration API
- Geolocation, DeviceOrientation (compass), Screen Wake Lock
- PWA (manifest + service worker in `public/`)

## Project structure

```
src/
  App.tsx                  routes (/ and /navigate) + shared settings and location
  pages/
    Onboarding.tsx         route "/"
    Navigate.tsx           route "/navigate"
  components/
    SetupScreen.tsx        form + voice setup flow
    RunScreen.tsx          camera view, message banner, buttons
  engine/
    guide.ts               the walking-guide runtime: detect → rank → decide what to say
  vision/
    detector.ts            COCO-SSD loader (self-hosted weights first, then Google's)
    distance.ts            size + ground-plane + width + depth distance fusion
    gemini.ts              sends frames to /api/describe
    depth.ts               depth model, metric calibration, unnamed-obstacle scan
    perception.ts          distance estimates, tracking, hazard tiers
    types.ts               shared vision types
  audio/
    speaker.ts             speech priority arbiter, beeps, vibration
    listen.ts              speech recognition, spoken-height parsing
  nav/
    route.ts               geocoding, routing, step-based instructions
  geo/
    geo.ts                 distance/bearing maths, GPS, compass
  i18n/
    strings.ts             English + Kiswahili phrases, object names and sizes
api/
  describe.ts              Vercel function: frame -> Gemini -> JSON (key stays server-side)
scripts/
  fetch-model.mjs          npm run fetch-model: downloads COCO-SSD weights into public/models
public/
  manifest.json, sw.js, icon.svg, models/
```

## Getting started

```bash
git clone <repo-url>
cd iris
npm install
npm run fetch-model   # once: saves the detection model into public/models
cp .env.example .env  # then add your GEMINI_API_KEY (optional)
npm run dev
```

Camera and GPS only work over HTTPS (localhost is fine on desktop). To test on your phone, use the deployed URL or a tunnel like ngrok. The service worker is only registered in production builds.

```bash
npm run build      # type-check + build to dist/
npm run preview    # serve the build locally
npm run lint
```

## Known limitations

- The screen must stay on while navigating.
- iOS Safari has no vibration support, so Iris uses audio tones for alerts.
- Distance comes from object size fused with monocular depth, not real depth sensing.
- Speech recognition and available voices (especially Kiswahili) depend on the browser and device.
- Nominatim and the public OSRM server are rate-limited; fine for a demo, not for production.

## Roadmap

- More languages
- Background navigation in a native app
- Integration with wearable hardware

## Team

Abby, Ruth & Mary
