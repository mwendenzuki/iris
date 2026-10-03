import type { Ctx, LL, Route } from "./types";

export const rad = (x: number) => (x * Math.PI) / 180;
export const deg = (x: number) => (x * 180) / Math.PI;

export function dist(a: LL, b: LL) {
  const R = 6371e3,
    dl = rad(b[0] - a[0]),
    dn = rad(b[1] - a[1]);
  const x =
    Math.sin(dl / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function bearing(a: LL, b: LL) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Nominatim search, softly biased towards `near` (about 50 km box). */
export async function geocode(q: string, near?: LL): Promise<LL | null> {
  const vb = near
    ? `&viewbox=${near[1] - 0.5},${near[0] + 0.5},${near[1] + 0.5},${near[0] - 0.5}`
    : "";
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1${vb}&q=${encodeURIComponent(q)}`,
  );
  const g: { lat: string; lon: string }[] = await r.json();
  return g[0] ? [+g[0].lat, +g[0].lon] : null;
}

interface OsrmStep {
  maneuver: { location: [number, number]; modifier?: string };
}

/** Walking route from `from` to a place name. Step 0 is "depart", so guidance starts at step 1. */
export async function buildRoute(
  from: LL,
  toQuery: string,
): Promise<Route | null> {
  try {
    const to = await geocode(toQuery, from);
    if (!to) return null;
    const r = await (
      await fetch(
        `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from[1]},${from[0]};${to[1]},${to[0]}?overview=false&steps=true`,
      )
    ).json();
    const steps: OsrmStep[] = r.routes[0].legs[0].steps;
    return {
      steps: steps.map((s) => ({
        ll: [s.maneuver.location[1], s.maneuver.location[0]],
        mod: s.maneuver.modifier ?? "",
      })),
      i: 1,
    };
  } catch {
    return null;
  }
}

/** Next spoken route instruction, or null when there is no active route. Advances the route when a waypoint is reached. */
export function routeMsg(c: Ctx): string | null {
  const { route, pos, T, stride, heading } = c;
  if (!route || !pos || route.i >= route.steps.length) return null;
  let w = route.steps[route.i],
    d = dist(pos, w.ll);
  if (d < 8) {
    route.i++;
    if (route.i >= route.steps.length) return T.arrive;
    w = route.steps[route.i];
    d = dist(pos, w.ll);
  }
  const n = Math.max(1, Math.round(d / stride));
  const rel =
    heading == null ? 0 : ((bearing(pos, w.ll) - heading + 540) % 360) - 180;
  if (Math.abs(rel) > 135) return T.around;
  if (Math.abs(rel) > 30)
    return `${T.turn} ${Math.abs(rel) < 60 ? T.slight + " " : ""}${rel < 0 ? T.left : T.right}`;
  const nx = /left/.test(w.mod) ? T.tl : /right/.test(w.mod) ? T.tr : T.st;
  return `${T.go} ${n > 5 ? T.about + " " : ""}${n > 8 ? Math.round(n / 5) * 5 : n} ${T.steps}, ${T.then} ${nx}`;
}
