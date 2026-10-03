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
3. **Buttons:** "What's ahead?" describes the scene, "Voice" takes a command ("go to …", "repeat", "stop"), "Stop" ends the walk.

## Tech stack

- Vite + React + TypeScript
- TensorFlow.js + COCO-SSD (npm) for object detection
- Depth Anything V2 small via transformers.js (loaded from CDN at runtime) for depth
- OpenStreetMap Nominatim (place search) + OSRM foot routing — no API key needed
- Web Speech API (speech out and in), Web Audio for tones, Vibration API
- Geolocation, DeviceOrientation (compass), Screen Wake Lock
- PWA (manifest + service worker in `public/`)

## Project structure

```
src/
  App.tsx                  screen switch (setup ↔ run), initial location
  components/
    SetupScreen.tsx        form + voice setup flow
    RunScreen.tsx          camera view, message banner, buttons
  engine/
    guide.ts               the walking-guide runtime: detect → rank → decide what to say
  vision/
    detector.ts            COCO-SSD loader (lazy-loaded, cached)
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
public/
  manifest.json, sw.js, icon.svg
```

## Getting started

```bash
git clone <repo-url>
cd iris
npm install
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
