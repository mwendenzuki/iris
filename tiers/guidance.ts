import { routeMsg } from "./geo";
import { objName } from "./i18n";
import type { Speaker } from "./speech";
import type { Ctx, Item } from "./types";

export class Guide {
  private lastHaz = 0;
  private lastRoute = 0;
  private sp: Speaker;
  private c: Ctx;

  constructor(sp: Speaker, c: Ctx) {
    this.sp = sp;
    this.c = c;
  }

  private side(lat: number) {
    const T = this.c.T;
    return Math.abs(lat) < 0.7 ? T.ahead : lat < 0 ? T.left : T.right;
  }
  private unit(n: number) {
    return n + " " + (n === 1 ? this.c.T.step : this.c.T.steps);
  }
  private nm(cls: string) {
    return objName(cls, this.c.L);
  }

  /** Which way round an obstacle is shorter, and how many steps to sidestep. */
  private avoid(it: Item) {
    const { stride, T } = this.c;
    const shiftLeft = it.ow / 2 + 0.7 - it.lat; // distance to clear its left edge
    const shiftRight = it.lat + it.ow / 2 + 0.7; // distance to clear its right edge
    const goLeft = shiftLeft < shiftRight;
    const k = Math.min(
      4,
      Math.max(
        1,
        Math.ceil(Math.max(0, goLeft ? shiftLeft : shiftRight) / stride),
      ),
    );
    return `${T.move} ${goLeft ? T.left : T.right} ${this.unit(k)}`;
  }

  /** "What's ahead": the three nearest things, and how long the path stays clear. */
  describe(items: Item[], t: number, auto: boolean) {
    const { T, stride } = this.c;
    const near = items.filter((i) => i.d < 15).sort((a, b) => a.d - b.d),
      top = near.slice(0, 3);
    if (!top.length) return this.sp.say(2, "scene", T.none, t, !auto);
    const list = top
      .map(
        (i) =>
          `${this.nm(i.cls)}, ${this.side(i.lat)}, ${this.unit(Math.max(1, Math.round(i.d / stride)))}`,
      )
      .join(". ");
    const ip = near.find((i) => i.inPath);
    const tail = ip
      ? `${T.clearfor} ${this.unit(Math.max(0, Math.round(ip.d / stride) - 1))}.`
      : T.clear;
    this.sp.say(2, "scene", `${T.scene}: ${list}. ${tail}`, t, !auto);
  }

  /** Called every frame. Hazards first, then route instructions, then an occasional scene summary. */
  decide(items: Item[], t: number) {
    const { T, stride } = this.c,
      top = items[0];
    if (top && top.tier === 0) {
      this.lastHaz = t;
      return this.sp.say(
        0,
        "0" + top.cls + this.side(top.lat),
        `${T.stop}. ${this.nm(top.cls)}, ${this.side(top.lat)}.`,
        t,
      );
    }
    if (top && top.tier === 1) {
      this.lastHaz = t;
      return this.sp.say(
        1,
        "1" + top.cls + this.side(top.lat),
        `${this.nm(top.cls)} ${this.side(top.lat)}, ${this.unit(Math.max(1, Math.round(top.d / stride)))}. ${this.avoid(top)}.`,
        t,
      );
    }
    if (t - this.lastHaz > 3 && t - this.lastRoute > 8) {
      const r = routeMsg(this.c);
      if (r) {
        this.lastRoute = t;
        return this.sp.say(2, "route", r, t);
      }
    }
    if (t - this.sp.lastSpeak > 20 && t - this.lastHaz > 5)
      this.describe(items, t, true);
  }
}
