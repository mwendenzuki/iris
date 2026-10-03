import { listen } from '../audio/listen'
import { Speaker, type Priority } from '../audio/speaker'
import { watchHeading, watchPosition, type LatLng } from '../geo/geo'
import { objectName, stepsText, TX, type Lang, type Strings } from '../i18n/strings'
import { fetchRoute, RouteGuide } from '../nav/route'
import { DepthEstimator } from '../vision/depth'
import type { Detector } from '../vision/detector'
import { Perception } from '../vision/perception'
import type { Item } from '../vision/types'

export interface GuideSettings {
  lang: Lang
  heightCm: number
  destination: string
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
const TIER_COLOURS = ['#FF5A4E', '#FFD23F', '#3DDBC0', '#3DDBC0']

/**
 * The walking-guide runtime: camera -> detection + depth -> hazard ranking -> speech,
 * with route instructions filling the quiet gaps.
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
  private cleanups: (() => void)[] = []
  private lastHaz = 0
  private lastRoute = 0

  private speaker: Speaker
  private perception = new Perception()
  private depth = new DepthEstimator()
  private route = new RouteGuide()
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
      const { loadDetector } = await import('../vision/detector') // keeps TF.js out of the setup screen bundle
      this.detector = await loadDetector()
    } catch (e) {
      this.cb.onMessage('Camera or model failed: ' + (e instanceof Error ? e.message : String(e)))
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

  /** Describe the scene ("What's ahead?"). `auto` = periodic, not user-requested. */
  describe(auto = false): void {
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

  // ---------- internals ----------

  private loop = async (): Promise<void> => {
    if (!this.running || !this.detector || !this.video) return
    const t = now()
    const v = this.video
    try {
      const preds = await this.detector.detect(v)
      const items = this.perception.perceive(preds, t, v.videoWidth, v.videoHeight, this.depth)
      this.draw(items)
      this.decide(items, t)
      this.depth.tick(v, items, this.camH, () => this.running)
      const status =
        `${items.length} object(s) · stride ${(this.stride * 100) | 0} cm · depth ${this.depth.status}` +
        (this.heading == null ? ' · no compass' : '')
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
    for (const it of items) {
      x.strokeStyle = x.fillStyle = TIER_COLOURS[it.tier]
      x.strokeRect(...it.box)
      x.fillText(`${it.cls} ${it.d.toFixed(1)}m`, it.box[0] + 6, it.box[1] + 30)
    }
  }

  private name(i: Item): string {
    return objectName(i.cls, this.settings.lang)
  }

  private side(lat: number): string {
    return Math.abs(lat) < 0.7 ? this.T.ahead : lat < 0 ? this.T.left : this.T.right
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
