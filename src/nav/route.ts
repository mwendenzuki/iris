import { bearing, dist, type LatLng } from '../geo/geo'
import { stepsText, type Strings } from '../i18n/strings'

/** Typical walking speed for a blind or low-vision pedestrian with a cane, m/s. */
export const WALK_SPEED = 0.9

export interface Place {
  /** short, speakable name ("Konza Technopolis Complex") */
  name: string
  ll: LatLng
}

export interface RouteStep {
  /** where this manoeuvre happens */
  ll: LatLng
  /** OSRM maneuver type: "depart", "turn", "arrive", ... */
  type: string
  /** OSRM maneuver modifier: "left", "slight right", "straight", ... */
  mod: string
  /** metres from this manoeuvre to the next one */
  dist: number
}

export interface Route {
  place: Place
  steps: RouteStep[]
  /** total walking distance, metres */
  distance: number
}

interface NominatimHit {
  lat: string
  lon: string
  name?: string
  display_name: string
}
interface OsrmResponse {
  routes: {
    distance: number
    legs: { steps: { distance: number; maneuver: { location: [number, number]; type: string; modifier?: string } }[] }[]
  }[]
}

/** Find a place by name with OpenStreetMap, preferring results near the user. */
export async function findPlace(query: string, near: LatLng | null): Promise<Place | null> {
  try {
    let url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query)
    if (near) {
      // bias (not restrict) to roughly 50 km around the user
      const [lat, lon] = near
      url += `&viewbox=${lon - 0.5},${lat + 0.5},${lon + 0.5},${lat - 0.5}&bounded=0`
    }
    const hits: NominatimHit[] = await (await fetch(url)).json()
    const h = hits[0]
    if (!h) return null
    const name = h.name || h.display_name.split(',')[0] || query
    return { name, ll: [+h.lat, +h.lon] }
  } catch {
    return null
  }
}

/** Walking route (OSRM foot profile) from `from` to `place`. */
export async function fetchRoute(from: LatLng, place: Place): Promise<Route | null> {
  try {
    const r: OsrmResponse = await (
      await fetch(
        `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from[1]},${from[0]};${place.ll[1]},${place.ll[0]}?overview=false&steps=true`,
      )
    ).json()
    const route = r.routes[0]
    return {
      place,
      distance: route.distance,
      steps: route.legs[0].steps.map((s) => ({
        ll: [s.maneuver.location[1], s.maneuver.location[0]],
        type: s.maneuver.type,
        mod: s.maneuver.modifier ?? '',
        dist: s.distance,
      })),
    }
  } catch {
    return null
  }
}

export const walkMinutes = (metres: number): number => Math.max(1, Math.round(metres / WALK_SPEED / 60))

/** "850 metres, about 1,200 steps, roughly 16 minutes" */
export function tripSummary(metres: number, stride: number, T: Strings): string {
  const steps = Math.round(metres / stride / 50) * 50 || Math.round(metres / stride)
  return T.trip(T.distance(metres), steps, walkMinutes(metres))
}

/** Tracks progress along a route and turns it into spoken step-based instructions. */
export class RouteGuide {
  route: Route | null = null
  private i = 0
  private saidHalfway = false
  private saidAlmost = false

  set(route: Route | null): void {
    this.route = route
    this.i = 1 // step 0 is the departure point
    this.saidHalfway = false
    this.saidAlmost = false
  }

  get active(): boolean {
    return !!this.route && this.i < this.route.steps.length
  }

  /** Metres left to walk from `pos`, or null with no route/position. */
  remaining(pos: LatLng | null): number | null {
    const r = this.route
    if (!r || !pos || this.i >= r.steps.length) return null
    let m = dist(pos, r.steps[this.i].ll)
    for (let j = this.i; j < r.steps.length; j++) m += r.steps[j].dist
    return m
  }

  /** One-off milestone announcements: halfway, almost there. */
  progress(pos: LatLng | null, stride: number, T: Strings): string | null {
    const r = this.route
    const left = this.remaining(pos)
    if (!r || left == null) return null
    if (!this.saidAlmost && left < 40) {
      this.saidAlmost = this.saidHalfway = true
      return T.almost(stepsText(Math.max(1, Math.round(left / stride)), T))
    }
    if (!this.saidHalfway && r.distance > 150 && left < r.distance / 2) {
      this.saidHalfway = true
      return T.halfway(T.distance(left), walkMinutes(left))
    }
    return null
  }

  /** Next instruction, or null if there's no route / position. `heading` in degrees or null. */
  message(pos: LatLng | null, heading: number | null, stride: number, T: Strings): string | null {
    const r = this.route
    if (!r || !pos || this.i >= r.steps.length) return null
    let w = r.steps[this.i]
    let d = dist(pos, w.ll)
    if (d < 8) {
      this.i++
      if (this.i >= r.steps.length) return T.arrived(r.place.name)
      w = r.steps[this.i]
      d = dist(pos, w.ll)
    }

    // Facing the wrong way? Fix that first (needs a compass).
    const rel = heading == null ? 0 : ((bearing(pos, w.ll) - heading + 540) % 360) - 180
    if (Math.abs(rel) > 135) return T.around
    if (Math.abs(rel) > 30) return `${T.turn} ${Math.abs(rel) < 60 ? T.slight + ' ' : ''}${rel < 0 ? T.left : T.right}`

    // Steps are useful up close; for long stretches, metres are easier to picture.
    const n = Math.max(1, Math.round(d / stride))
    const walk =
      n > 60 ? T.walkAbout(T.distance(d)) : n > 8 ? T.walkAbout(stepsText(Math.round(n / 5) * 5, T)) : T.walk(stepsText(n, T))
    return `${walk}, ${T.then} ${this.manoeuvre(w, T)}.`
  }

  private manoeuvre(w: RouteStep, T: Strings): string {
    if (w.type === 'arrive') return T.youArrive
    const m = w.mod
    if (/uturn/.test(m)) return T.uturn
    if (/slight left/.test(m)) return T.keepLeft
    if (/slight right/.test(m)) return T.keepRight
    if (/left/.test(m)) return T.turnLeft
    if (/right/.test(m)) return T.turnRight
    return T.straightOn
  }
}
