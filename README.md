# Iris

A mobile-first web app that helps visually impaired people walk safely. Iris uses the phone camera to spot obstacles and GPS to give spoken, step-by-step directions, all hands-free.

## What it does

- **Obstacle detection:** the rear camera runs an on-device model and warns you about things in your path, with direction ("obstacle ahead, left").
- **Step-by-step navigation:** pick a start and end point and Iris reads out walking directions, converted into steps based on your stride length.
- **Voice first:** everything important is spoken, so you don't need to look at the screen.
- **Personal setup:** choose your language and enter your height once. Iris uses it to estimate your stride length (`height × 0.415`).

## How it works

1. **Onboarding:** choose a language, enter your height, tap OK.
2. **Main page:** enter a start point (or use your current location) and an end point.
3. **Start:** the camera turns on, navigation begins, and obstacle warnings take priority over directions.

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS, React Router
- TensorFlow.js (COCO-SSD) for obstacle detection
- Geolocation API for live position
- Mapbox Directions + Geocoding for routes and places
- Web Speech API for voice, Web Audio for alert tones
- Screen Wake Lock API to keep the screen on
- Deployed as a PWA on Vercel / Netlify

## Getting started

```bash
git clone <repo-url>
cd iris
npm install
```

Create a `.env` file:

```
VITE_MAPBOX_TOKEN=your_token_here
```

Run it:

```bash
npm run dev
```

Camera and GPS only work over HTTPS (localhost is fine for desktop). To test on your phone, use the deployed URL or a tunnel like ngrok.

## Known limitations

- The screen must stay on while navigating.
- iOS Safari has no vibration support, so Iris uses audio tones for alerts.
- Distance to obstacles is estimated from bounding box size, not real depth sensing.
- Available voices (especially Swahili) depend on the device.

## Roadmap

- Voice input for destinations
- More languages
- Background navigation in a native app
- Integration with wearable hardware

## Team

Abby, Ruth & Mary
