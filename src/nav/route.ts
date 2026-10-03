import { bearing, dist, type LatLng } from '../geo/geo'
import type { Strings } from '../i18n/strings'

export interface RouteStep {
  ll: LatLng
  /** OSRM maneuver modifier, e.g. "left", "slight right" */
  mod: string
}

interface NominatimHit {
  lat: string
  lon: string
}
interface OsrmResponse {
  routes: { legs: { steps: { maneuver: { location: [number, number]; modifier?: string } }[] }[] }[]
}

/** Geocode `query` (OpenStreetMap Nominatim) and get a walking route from `from` (OSRM foot). */
export async function fetchRoute(from: LatLng, query: string): Promise<RouteStep[] | null> {
  try {
    const hits: NominatimHit[] = await (
      await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query))
    ).json()
    if (!hits[0]) return null
    const r: OsrmResponse = await (
      await fetch(
        `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from[1]},${from[0]};${hits[0].lon},${hits[0].lat}?overview=false&steps=true`,
      )
    ).json()
    return r.routes[0].legs[0].steps.map((s) => ({
      ll: [s.maneuver.location[1], s.maneuver.location[0]],
      mod: s.maneuver.modifier ?? '',
    }))
  } catch {
    return null
  }
}

/** Tracks progress along a route and turns it into spoken step-based instructions. */
export class RouteGuide {
  private steps: RouteStep[] | null = null
  private i = 0

  set(steps: RouteStep[] | null): void {
    this.steps = steps
    this.i = 1
  }

  /** Next instruction, or null if there's no route / position. `heading` in degrees or null. */
  message(pos: LatLng | null, heading: number | null, stride: number, T: Strings): string | null {
    const steps = this.steps
    if (!steps || !pos || this.i >= steps.length) return null
    let w = steps[this.i]
    let d = dist(pos, w.ll)
    if (d < 8) {
      this.i++
      if (this.i >= steps.length) return T.arrive
      w = steps[this.i]
      d = dist(pos, w.ll)
    }
    const n = Math.max(1, Math.round(d / stride))
    const rel = heading == null ? 0 : ((bearing(pos, w.ll) - heading + 540) % 360) - 180
    if (Math.abs(rel) > 135) return T.around
    if (Math.abs(rel) > 30) return `${T.turn} ${Math.abs(rel) < 60 ? T.slight + ' ' : ''}${rel < 0 ? T.left : T.right}`
    const next = /left/.test(w.mod) ? T.tl : /right/.test(w.mod) ? T.tr : T.st
    return `${T.go} ${n > 5 ? T.about + ' ' : ''}${n > 8 ? Math.round(n / 5) * 5 : n} ${T.steps}, ${T.then} ${next}`
  }
}
