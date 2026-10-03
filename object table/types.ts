import type { Lang, Strings } from "./i18n";

export type LL = [number, number];
export type Box = [number, number, number, number];
export interface Step {
  ll: LL;
  mod: string;
}
export interface Route {
  steps: Step[];
  i: number;
}

export interface Item {
  cls: string;
  cx: number;
  cy: number;
  d: number; // fused distance (m)
  ds: number; // size-based distance (m), used to calibrate depth
  trunc: boolean; // box touches bottom of frame
  s: number;
  risk: number;
  box: Box;
  ow: number; // object width (m)
  lat: number; // lateral offset from walking line (m), negative = left
  ok: boolean;
  inPath: boolean;
  ttc: number;
  tier: number; // 0 stop, 1 avoid, 3 ignore
}

/** Mutable state shared by the engine, guidance and routing. */
export interface Ctx {
  L: Lang;
  T: Strings;
  stride: number;
  camH: number;
  pos: LL | null;
  heading: number | null;
  route: Route | null;
}
