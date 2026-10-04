import { listen, micUnavailable } from '../audio/listen'
import { beep, Speaker, type Priority } from '../audio/speaker'
import { watchHeading, watchPitch, watchPosition, type LatLng } from '../geo/geo'
import { objectName, stepsText, TX, type Lang, type Strings } from '../i18n/strings'
import { fetchRoute, findPlace, RouteGuide, tripSummary, walkMinutes, type Route } from '../nav/route'
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
/** Seconds between repeated route instructions. */
const ROUTE_INTERVAL = 10
/** Stop this far (metres) short of an obstacle before side-stepping. */
const STOP_SHORT = 1.0

const YES = /\b(yes|yeah|yep|ok|okay|sure|go|correct)\b|ndiyo|ndio|sawa|naam/
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
  /** a voice conversation is in progress: hold back route/scene chatter */
  private dialog = false

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

    // Trip briefing: "Ready. Walk forward. Route to X: 850 metres, about 1200 steps, roughly 16 minutes."
    const T = this.T
    let intro = T.ready
    const dest = this.settings.destination.trim()
    if (dest) {
      const r = this.pos ? await this.plan(dest) : T.noGps
      if (typeof r === 'string') intro += ' ' + r
      else {
        this.route.set(r)
        intro += ' ' + T.routeTo(r.place.name, tripSummary(r.distance, this.stride, T))
      }
    }
    if (this.stopped) return
    this.cleanups.push(watchPosition((p) => (this.pos = p)))

    this.running = true
    this.speaker.lastSpeak = 0
    // Protected: obstacle warnings wait until the briefing is finished (a real "Stop" still cuts in)
    void this.speaker.announce(intro).then(() => (this.lastRoute = now() - ROUTE_INTERVAL + 2))
    this.lastRoute = now() + 60 // no turn instruction until the briefing is done
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

  /**
   * Voice commands (English or Kiswahili):
   *   "change destination" -> asks where -> searches -> confirms distance/time -> yes/no
   *   "go to <place>"      -> same, skipping the question
   *   "how far" / "how long", "cancel route", "repeat", "help", "stop", anything else = describe
   */
  async command(): Promise<void> {
    const T = this.T
    this.speaker.interrupt()
    this.dialog = true
    try {
      const s = await this.hear()
      if (!s) return this.reply(micUnavailable() ? T.noMic : T.miss)
      if (/cancel|stop (the )?(navigation|route|directions)|sitisha|ghairi/.test(s)) {
        this.route.set(null)
        return this.reply(T.routeCleared)
      }
      if (/\b(stop|quit|end|exit)\b|simamisha|simama|maliza/.test(s)) return this.cb.onStopRequested()
      if (/repeat|again|rudia/.test(s)) return this.reply(this.speaker.lastText)
      if (/help|what can i say|msaada|nisaidie/.test(s)) return this.reply(T.help)
      if (/how far|how long|distance|time left|remaining|umbali|muda|zimebaki/.test(s)) return this.reply(this.remainingText())

      const direct = s.match(/(?:go to|take me to|navigate to|directions to|nipeleke|nenda|niongoze hadi)\s+(.+)/)
      if (direct) return await this.changeDestination(direct[1])
      if (/destination|change|new place|somewhere else|another place|badilisha|mahali|safari mpya|sehemu nyingine/.test(s)) {
        const q = await this.askFor(T.askDest)
        if (!q) return this.reply(micUnavailable() ? T.noMic : T.miss)
        return await this.changeDestination(q)
      }
    } finally {
      this.dialog = false
    }
    this.describe(false)
  }

  /** Search -> read back distance and time -> set the route only if the user says yes. */
  private async changeDestination(query: string): Promise<void> {
    const T = this.T
    if (!this.pos) return this.reply(T.noGps)
    // Say "Searching" while the lookup runs, so there's no silent gap
    const [, r] = await Promise.all([this.speaker.announce(T.searching), this.plan(query)])
    if (typeof r === 'string') return this.reply(r)
    const summary = tripSummary(r.distance, this.stride, T)
    const answer = await this.askFor(T.found(r.place.name, summary), T.yesNo)
    if (!YES.test(answer)) return this.reply(T.keepRoute)
    this.route.set(r)
    this.lastRoute = now()
    this.reply(T.routeTo(r.place.name, summary))
  }

  /** Find a place and a walking route to it; returns an error message to speak on failure. */
  private async plan(query: string): Promise<Route | string> {
    const pos = this.pos
    if (!pos) return this.T.noGps
    const place = await findPlace(query, pos)
    if (!place) return this.T.rno
    return (await fetchRoute(pos, place)) ?? this.T.noWalkRoute
  }

  private remainingText(): string {
    const left = this.route.remaining(this.pos)
    const r = this.route.route
    if (left == null || !r) return this.T.noRoute
    return this.T.remainingMsg(r.place.name, this.T.distance(left), walkMinutes(left))
  }

  /** Spoken answer to a voice command; protected so an obstacle warning doesn't cut it off. */
  private reply(text: string): void {
    void this.speaker.announce(text)
  }

  /**
   * Ask a question and listen for the answer. If nothing was heard (the user needed a
   * moment), apologise and ask once more, using the shorter `retry` prompt if given.
   */
  private async askFor(question: string, retry = question): Promise<string> {
    await this.speaker.announce(question)
    let answer = await this.hear()
    if (!answer && !micUnavailable()) {
      await this.speaker.announce(`${this.T.miss} ${retry}`)
      answer = await this.hear()
    }
    return answer
  }

  /** Wait for Iris to stop talking (so the mic doesn't hear her), then listen once. */
  private async hear(): Promise<string> {
    await this.speaker.idle()
    this.cb.onMessage(this.T.listening)
    return ((await listen(this.T.lang)) ?? '').toLowerCase().trim()
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
        ` · gemini ${this.gemini.status}`
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
    // While Iris is asking or listening, stay quiet so the mic hears the user, not Iris.
    // Only a real "Stop" (something very close, or a vehicle) may interrupt.
    if (this.dialog && top?.tier !== 0) return
    if (top && top.cls === 'obstacle' && top.tier <= 1) this.identifyObstacle(top, t)
    if (top?.tier === 0) {
      this.lastHaz = t
      // Vehicles: just stop. Never tell someone to step sideways into traffic.
      const what = `${T.stop}. ${this.name(top)} ${this.side(top.lat)}.`
      this.speaker.say(0, '0' + top.cls + this.side(top.lat), top.risk === 3 ? what : `${what} ${this.avoid(top, true)}`, t)
      return
    }
    if (top?.tier === 1) {
      this.lastHaz = t
      // "Chair ahead, 3 steps away. Walk 2 steps forward, then step 2 steps to your right, then continue."
      const what = `${this.name(top)} ${this.side(top.lat)}, ${T.away(this.steps(top.d))}.`
      this.speaker.say(1, '1' + top.cls + this.side(top.lat), top.risk === 3 ? what : `${what} ${this.avoid(top)}`, t)
      return
    }
    if (t - this.lastHaz > 3 && t - this.lastRoute > ROUTE_INTERVAL) {
      const r = this.route.progress(this.pos, this.stride, T) ?? this.route.message(this.pos, this.heading, this.stride, T)
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
    if (this.dialog || !g.available || g.busy || !this.video) return
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
    g.ask(this.video!, 'hazards', this.settings.lang, this.stride, 18000)
      .then((r) => {
        if (r && this.running && !this.dialog) onResult(r.hazards)
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
    return `${h.label} ${side}, ${T.away(this.steps(h.distance_m))}.`
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
  /**
   * Avoidance as a sequence: walk forward until about 1 m short, then side-step to
   * whichever side needs fewer steps, then carry on. `now` = skip the forward part.
   */
  private avoid(it: Item, now = false): string {
    const T = this.T
    const toLeft = it.lat + it.ow / 2 + 0.7
    const toRight = it.ow / 2 + 0.7 - it.lat
    const goLeft = toLeft <= toRight
    const side = Math.min(4, Math.max(1, Math.ceil(Math.max(0, goLeft ? toLeft : toRight) / this.stride)))
    const fwd = now ? 0 : Math.round((it.d - STOP_SHORT) / this.stride)
    return T.avoid(fwd > 0 ? stepsText(fwd, T) : null, stepsText(side, T), goLeft ? T.left : T.right)
  }
}
