import { listen } from '../audio/listen'
import { beep, Speaker, type Priority } from '../audio/speaker'
import { watchHeading, watchPitch, watchPosition, type LatLng } from '../geo/geo'
import { objectName, stepsText, TX, type Lang, type Strings } from '../i18n/strings'
import { fetchRoute, RouteGuide } from '../nav/route'
import { DepthEstimator } from '../vision/depth'
import type { Detector } from '../vision/detector'
import { GeminiEyes, type GeminiHazard } from '../vision/gemini'
import { Perception } from '../vision/perception'
import { focalPx, getFocalScale, setFocalScale, type Item } from '../vision/types'

export interface GuideSettings {
  lang: Lang
  heightCm: number
  destination: string
  /** show distance-calibration tools and per-estimate debug labels */
  calibrate?: boolean
}

export interface GuideCallbacks {
  /** Main on-screen message; `p` is set when it was spoken with a priority. */
  onMessage(text: string, p?: Priority): void
  /** Small status line (object count, stride, depth state). */
  onStatus(text: string): void
  /** Voice command asked to stop. */
  onStopRequested(): void
}

const now = () => performance.now() / 1000
/** Seconds between background Gemini hazard checks (keep within your API rate limit). */
const GEMINI_INTERVAL = 8
/** Only announce Gemini hazards closer than this (metres). */
const GEMINI_RANGE = 6
/** How long (s) a Gemini label can be used to name an unnamed depth obstacle. */
const GEMINI_LABEL_TTL = 6

type Side = 'left' | 'ahead' | 'right'
const TIER_COLOURS = ['#FF5A4E', '#FFD23F', '#3DDBC0', '#3DDBC0']

/**
 * The walking-guide runtime: camera -> detection + depth -> hazard ranking -> speech,
 * with route instructions filling the quiet gaps.
 *
 * Gemini (cloud) adds scene understanding on top: it answers "What's ahead?" and, every few
 * seconds, looks for hazards COCO can't name (potholes, drains, kerbs...). The on-device loop
 * stays in charge of urgent alerts, and everything works without Gemini.
 */
export class Guide {
  private T: Strings
  private stride: number
  private camH: number
  private running = false
  private stopped = false
  private stream: MediaStream | null = null
  private detector: Detector | null = null
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private pos: LatLng | null
  private heading: number | null = null
  /** camera tilt below horizontal, degrees (null = no sensor) */
  private pitch: number | null = null
  private cleanups: (() => void)[] = []
  private lastHaz = 0
  private lastRoute = 0
  private lastGemini = 0
  private lastIdentify = 0

  private speaker: Speaker
  private perception = new Perception()
  private depth = new DepthEstimator()
  private route = new RouteGuide()
  private gemini = new GeminiEyes()
  private settings: GuideSettings
  private cb: GuideCallbacks

  constructor(settings: GuideSettings, initialPos: LatLng | null, cb: GuideCallbacks) {
    this.settings = settings
    this.cb = cb
    this.pos = initialPos
    this.T = TX[settings.lang]
    this.stride = (0.415 * settings.heightCm) / 100 // stride ≈ 41.5% of height
    this.camH = (0.72 * settings.heightCm) / 100 // phone held at ~chest height
    this.speaker = new Speaker((text, p) => cb.onMessage(text, p))
    this.speaker.lang = this.T.lang
  }

  async start(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
    this.video = video
    this.canvas = canvas
    this.cb.onMessage(this.T.load)
    this.cleanups.push(watchHeading((h) => (this.heading = h)))
    this.cleanups.push(watchPitch((d) => (this.pitch = this.pitch == null ? d : 0.8 * this.pitch + 0.2 * d)))

    const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      if (this.stopped) return stream.getTracks().forEach((t) => t.stop())
      this.stream = stream
      video.srcObject = stream
      await video.play()
      navigator.wakeLock?.request('screen').catch(() => {})
    } catch (e) {
      this.cb.onMessage('Camera failed: ' + why(e))
      return
    }
    try {
      const { loadDetector } = await import('../vision/detector') // keeps TF.js out of the setup screen bundle
      this.detector = await loadDetector()
    } catch (e) {
      this.cb.onMessage('Model failed: ' + why(e))
      return
    }
    if (this.stopped) return

    const dest = this.settings.destination.trim()
    if (dest && this.pos) this.route.set(await fetchRoute(this.pos, dest))
    this.cleanups.push(watchPosition((p) => (this.pos = p)))

    this.running = true
    this.speaker.lastSpeak = 0
    this.speaker.say(2, 'ready', this.T.ready, now(), true)
    this.loop()
    this.depth.load()
  }

  stop(): void {
    this.stopped = true
    this.running = false
    speechSynthesis.cancel()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }

  /**
   * Describe the scene ("What's ahead?"). `auto` = periodic, not user-requested.
   * User requests go to Gemini when it's available, falling back to the on-device summary.
   */
  describe(auto = false): void {
    if (!auto && this.gemini.available && this.video) {
      void this.describeWithGemini()
      return
    }
    this.describeLocal(auto)
  }

  private async describeWithGemini(): Promise<void> {
    beep(520, 60) // "looking..." cue
    const r = await this.gemini.ask(this.video!, 'describe', this.settings.lang, this.stride)
    if (this.stopped) return
    if (r?.summary) this.speaker.say(2, 'scene', r.summary, now(), true)
    else this.describeLocal(false)
  }

  private describeLocal(auto: boolean): void {
    const t = now()
    const T = this.T
    const near = this.perception.last.filter((i) => i.d < 15).sort((a, b) => a.d - b.d)
    const top = near.slice(0, 3)
    if (!top.length) {
      this.speaker.say(2, 'scene', T.none, t, !auto)
      return
    }
    const list = top.map((i) => `${this.name(i)}, ${this.side(i.lat)}, ${this.steps(i.d)}`).join('. ')
    const inPath = near.find((i) => i.inPath)
    const tail = inPath ? `${T.clearfor} ${stepsText(Math.max(0, Math.round(inPath.d / this.stride) - 1), T)}.` : T.clear
    this.speaker.say(2, 'scene', `${T.scene}: ${list}. ${tail}`, t, !auto)
  }

  /** Listen for a voice command: "go to …", "stop", "repeat", anything else = describe. */
  async command(): Promise<void> {
    const T = this.T
    this.speaker.interrupt()
    const s = ((await listen(T.lang)) ?? '').toLowerCase()
    if (!s) {
      this.speaker.say(1, 'cmd', T.miss, now(), true)
      return
    }
    const m = s.match(/(?:go to|take me to|navigate to|nipeleke|nenda)\s+(.+)/)
    if (m) {
      let ok = false
      if (this.pos) {
        const steps = await fetchRoute(this.pos, m[1])
        if (steps) {
          this.route.set(steps)
          ok = true
        }
      }
      this.speaker.say(1, 'cmd', ok ? T.rok : T.rno, now(), true)
      return
    }
    if (/stop|quit|end|simamisha|maliza/.test(s)) return this.cb.onStopRequested()
    if (/repeat|again|rudia/.test(s)) {
      this.speaker.say(1, 'cmd', this.speaker.lastText, now(), true)
      return
    }
    this.describe(false)
  }

  /**
   * One-time per-device distance calibration (done by a sighted helper):
   * stand a person a measured distance away, fully in frame, and call this.
   * Fixes the camera's focal length so every distance estimate scales correctly.
   */
  calibrate(distanceM: number, personHeightCm: number): string {
    const v = this.video
    if (!v || !(distanceM > 0) || !(personHeightCm > 0)) return 'Enter the distance and the person\'s height.'
    const H = v.videoHeight
    const people = this.perception.last.filter((i) => i.cls === 'person' && !i.trunc)
    if (!people.length) return 'No person fully in frame (head and feet visible). Try again.'
    const p = people.sort((a, b) => b.box[3] - a.box[3])[0] // biggest = nearest
    // focal = pixel height × distance / real height
    const focal = (p.box[3] * distanceM) / (personHeightCm / 100)
    const scale = (focal / focalPx(H)) * getFocalScale()
    if (!(scale > 0.3 && scale < 4)) return `That gives an unlikely lens (${scale.toFixed(2)}×). Check the numbers and try again.`
    setFocalScale(scale)
    return `Calibrated: lens factor ${scale.toFixed(2)} (saved on this device). That person now reads ${distanceM.toFixed(1)} m.`
  }

  // ---------- internals ----------

  private loop = async (): Promise<void> => {
    if (!this.running || !this.detector || !this.video) return
    const t = now()
    const v = this.video
    try {
      const preds = await this.detector.detect(v)
      const pose = { heightM: this.camH, pitchDeg: this.pitch }
      const items = this.perception.perceive(preds, t, v.videoWidth, v.videoHeight, this.depth, pose)
      this.draw(items)
      this.decide(items, t)
      this.checkGemini(t)
      this.depth.tick(v, items, this.camH, () => this.running)
      const status =
        `${items.length} object(s) · stride ${(this.stride * 100) | 0} cm · depth ${this.depth.status}` +
        (this.heading == null ? ' · no compass' : '') +
        (this.pitch == null ? ' · no tilt' : ` · tilt ${Math.round(this.pitch)}°`) +
        ` · gemini ${this.gemini.available ? 'on' : 'off'}`
      this.cb.onStatus(this.depth.failed ? 'Depth model unavailable: using size-based distance · ' + status : status)
    } catch {
      /* skip frame */
    }
    setTimeout(this.loop, 100)
  }

  /** Pick at most one thing to say this frame: hazard > warning > route > periodic scene. */
  private decide(items: Item[], t: number): void {
    const T = this.T
    const top = items[0]
    if (top && top.cls === 'obstacle' && top.tier <= 1) this.identifyObstacle(top, t)
    if (top?.tier === 0) {
      this.lastHaz = t
      this.speaker.say(0, '0' + top.cls + this.side(top.lat), `${T.stop}. ${this.name(top)}, ${this.side(top.lat)}.`, t)
      return
    }
    if (top?.tier === 1) {
      this.lastHaz = t
      this.speaker.say(1, '1' + top.cls + this.side(top.lat), `${this.name(top)} ${this.side(top.lat)}, ${this.steps(top.d)}. ${this.avoid(top)}.`, t)
      return
    }
    if (t - this.lastHaz > 3 && t - this.lastRoute > 8) {
      const r = this.route.message(this.pos, this.heading, this.stride, T)
      if (r) {
        this.lastRoute = t
        this.speaker.say(2, 'route', r, t)
        return
      }
    }
    if (t - this.speaker.lastSpeak > 20 && t - this.lastHaz > 5) this.describe(true)
  }

  /** Background Gemini check for hazards the detector can't name. Never blocks the loop. */
  private checkGemini(t: number): void {
    const g = this.gemini
    if (!g.available || g.busy || !this.video) return
    if (t - this.lastGemini < GEMINI_INTERVAL || t - this.lastHaz < 2) return
    this.lastGemini = t
    this.askHazards((hazards) => {
      const h = hazards.filter((x) => x.distance_m > 0 && x.distance_m <= GEMINI_RANGE).sort((a, b) => a.distance_m - b.distance_m)[0]
      if (!h) return
      const tt = now()
      if (tt - this.lastHaz < 1.5) return // an on-device alert just spoke; don't pile on
      // Warning level, never "Stop": Gemini answers are ~1-3 s old and can be wrong.
      if (this.speaker.say(1, 'g' + h.label.toLowerCase() + h.side, this.geminiText(h), tt)) this.lastHaz = tt
    })
  }

  /**
   * The depth model found something in the way that COCO can't name. Ask Gemini right away
   * what it is, then say its real name ("Electric pole, ahead, 3 steps").
   */
  private identifyObstacle(it: Item, t: number): void {
    const g = this.gemini
    if (!g.available || g.busy || !this.video || t - this.lastIdentify < 3) return
    if (this.labelFor(this.sideKey(it.lat))) return // already named recently
    this.lastIdentify = t
    this.lastGemini = t // counts as this cycle's background check
    const side = this.sideKey(it.lat)
    this.askHazards((hazards) => {
      const h = this.match(hazards, side)
      if (!h) return
      // Forced: this clarifies an alert the user just heard ("Obstacle ahead" -> what it is)
      this.speaker.say(1, 'id' + h.label.toLowerCase() + h.side, this.geminiText(h), now(), true)
    })
  }

  private askHazards(onResult: (hazards: GeminiHazard[]) => void): void {
    const g = this.gemini
    g.busy = true
    g.ask(this.video!, 'hazards', this.settings.lang, this.stride, 6000)
      .then((r) => {
        if (r && this.running) onResult(r.hazards)
      })
      .finally(() => (g.busy = false))
  }

  /** Closest Gemini hazard (within 10 m) on the given side. */
  private match(hazards: GeminiHazard[], side: Side): GeminiHazard | undefined {
    return hazards.filter((h) => h.side === side && h.distance_m <= 10).sort((a, b) => a.distance_m - b.distance_m)[0]
  }

  /** A recent Gemini name for whatever is on this side, if any. */
  private labelFor(side: Side): string | null {
    const r = this.gemini.recent
    if (!r || now() - r.t > GEMINI_LABEL_TTL) return null
    return this.match(r.hazards, side)?.label ?? null
  }

  private geminiText(h: GeminiHazard): string {
    const T = this.T
    const side = h.side === 'left' ? T.left : h.side === 'right' ? T.right : T.ahead
    return `${h.label}, ${side}, ${this.steps(h.distance_m)}.`
  }

  private draw(items: Item[]): void {
    const v = this.video!
    const c = this.canvas!
    if (c.width !== v.videoWidth) {
      c.width = v.videoWidth
      c.height = v.videoHeight
    }
    const x = c.getContext('2d')!
    x.clearRect(0, 0, c.width, c.height)
    x.lineWidth = 6
    x.font = 'bold 28px sans-serif'
    const m = (d?: number) => (d === undefined ? '-' : d.toFixed(1))
    for (const it of items) {
      x.strokeStyle = x.fillStyle = TIER_COLOURS[it.tier]
      x.strokeRect(...it.box)
      x.fillText(`${it.cls} ${it.d.toFixed(1)}m`, it.box[0] + 6, it.box[1] + 30)
      if (this.settings.calibrate && it.est) {
        // per-estimate breakdown: size / ground / width / depth
        x.font = 'bold 20px sans-serif'
        x.fillText(`s${m(it.est.size)} g${m(it.est.ground)} w${m(it.est.width)} d${m(it.est.depth)}`, it.box[0] + 6, it.box[1] + 56)
        x.font = 'bold 28px sans-serif'
      }
    }
  }

  private name(i: Item): string {
    // Depth-only obstacles get Gemini's name for them when we have one
    if (i.cls === 'obstacle') return this.labelFor(this.sideKey(i.lat)) ?? objectName(i.cls, this.settings.lang)
    return objectName(i.cls, this.settings.lang)
  }

  private sideKey(lat: number): Side {
    return Math.abs(lat) < 0.7 ? 'ahead' : lat < 0 ? 'left' : 'right'
  }

  private side(lat: number): string {
    const k = this.sideKey(lat)
    return k === 'ahead' ? this.T.ahead : k === 'left' ? this.T.left : this.T.right
  }

  private steps(metres: number): string {
    return stepsText(Math.max(1, Math.round(metres / this.stride)), this.T)
  }

  /** "Move left 2 steps" — sidestep toward whichever side needs fewer steps. */
  private avoid(it: Item): string {
    const toLeft = it.lat + it.ow / 2 + 0.7
    const toRight = it.ow / 2 + 0.7 - it.lat
    const goLeft = toLeft <= toRight
    const k = Math.min(4, Math.max(1, Math.ceil(Math.max(0, goLeft ? toLeft : toRight) / this.stride)))
    return `${this.T.move} ${goLeft ? this.T.left : this.T.right} ${stepsText(k, this.T)}`
  }
}
