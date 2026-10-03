/** [latitude, longitude] in degrees */
export type LatLng = [number, number]

export const rad = (x: number): number => (x * Math.PI) / 180
export const deg = (x: number): number => (x * 180) / Math.PI

/** Great-circle distance in metres. */
export function dist(a: LatLng, b: LatLng): number {
  const R = 6371e3
  const dLat = rad(b[0] - a[0])
  const dLon = rad(b[1] - a[1])
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]))
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

const toLatLng = (p: GeolocationPosition): LatLng => [p.coords.latitude, p.coords.longitude]

export function getCurrentPosition(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toLatLng(p)),
      () => resolve(null),
      { enableHighAccuracy: true },
    )
  })
}

/** Start watching position; returns a function that stops watching. */
export function watchPosition(onPos: (p: LatLng) => void): () => void {
  if (!navigator.geolocation) return () => {}
  const id = navigator.geolocation.watchPosition((p) => onPos(toLatLng(p)), () => {}, { enableHighAccuracy: true })
  return () => navigator.geolocation.clearWatch(id)
}

// --- compass ---

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number }
type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }

/** iOS needs explicit permission for compass; call from a tap handler. */
export async function requestCompassPermission(): Promise<void> {
  try {
    const ctor = window.DeviceOrientationEvent as OrientationCtor | undefined
    if (ctor?.requestPermission) await ctor.requestPermission()
  } catch {
    /* denied or unsupported */
  }
}

/** Watch compass heading (degrees from north). Returns a function that stops watching. */
export function watchHeading(onHeading: (h: number) => void): () => void {
  const handler = (ev: Event) => {
    const e = ev as OrientationEvt
    if (e.webkitCompassHeading != null) onHeading(e.webkitCompassHeading)
    else if (e.absolute && e.alpha != null) onHeading((360 - e.alpha) % 360)
  }
  addEventListener('deviceorientationabsolute', handler, true)
  addEventListener('deviceorientation', handler, true)
  return () => {
    removeEventListener('deviceorientationabsolute', handler, true)
    removeEventListener('deviceorientation', handler, true)
  }
}

/**
 * Watch how far the phone's camera is tilted down from horizontal, in degrees
 * (0 = level, positive = pointing at the ground). Portrait use only; never fires
 * on devices without an orientation sensor (e.g. laptops).
 */
export function watchPitch(onPitch: (deg: number) => void): () => void {
  const handler = (ev: Event) => {
    const e = ev as DeviceOrientationEvent
    if (e.beta == null) return
    // beta = 90 when the phone is upright; less when the top tilts away (camera looks down)
    onPitch(Math.max(-30, Math.min(70, 90 - e.beta)))
  }
  addEventListener('deviceorientation', handler, true)
  return () => removeEventListener('deviceorientation', handler, true)
}
