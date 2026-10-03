let ac: AudioContext | undefined;

export function beep(f = 880, ms = 160) {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ac ??= new Ctor();
    const o = ac.createOscillator(),
      g = ac.createGain();
    o.frequency.value = f;
    g.gain.value = 0.25;
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + ms / 1000);
  } catch {
    /* audio blocked until a tap */
  }
}

/**
 * One voice for everything. Priority 0 = stop now, 1 = avoid, 2 = route / scene info.
 * A lower number interrupts a higher one; a priority-0 message is never interrupted by anything else.
 */
export class Speaker {
  lang = "en-US";
  lastSpeak = 0;
  lastText = "";
  onText: (text: string, tier: number) => void = () => {};
  private speaking = false;
  private spP = 9;
  private sid = 0;
  private cool: Record<string, number> = {};

  say(p: number, key: string, text: string, t: number, force = false) {
    const gap = [0.6, 2.5, 6][p] ?? 6,
      kc = p === 0 ? 2 : 5;
    if (!force && this.cool[key] && t - this.cool[key] < kc) return; // same message repeating
    if (this.speaking) {
      if (this.spP === 0 && p !== 0) return;
      if (!force && p >= this.spP) return;
      speechSynthesis.cancel();
    } else if (!force && t - this.lastSpeak < gap) return;

    this.cool[key] = t;
    this.lastSpeak = t;
    this.spP = p;
    this.speaking = true;
    this.lastText = text;
    if (p === 0) {
      beep(1000, 150);
      navigator.vibrate?.([200, 80, 200]);
    } else if (p === 1) navigator.vibrate?.(100);

    const u = new SpeechSynthesisUtterance(text),
      id = ++this.sid;
    u.lang = this.lang;
    u.rate = 1.1;
    u.onend = u.onerror = () => {
      if (id === this.sid) {
        this.speaking = false;
        this.spP = 9;
      }
    };
    speechSynthesis.speak(u);
    this.onText(text, p);
  }

  interrupt() {
    speechSynthesis.cancel();
    this.speaking = false;
  }
}

/** Speak and wait until finished (setup prompts, loading message). */
export const speakOnce = (text: string, lang: string) =>
  new Promise<void>((res) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1.05;
    u.onend = u.onerror = () => res();
    speechSynthesis.speak(u);
  });

interface Rec {
  lang: string;
  interimResults: boolean;
  onresult:
    | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
}
const w = window as unknown as {
  SpeechRecognition?: new () => Rec;
  webkitSpeechRecognition?: new () => Rec;
};
const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
export const hasSR = !!SR;

/** Listen once. Resolves with the transcript, or null if nothing was heard. */
export function listen(lang: string) {
  return new Promise<string | null>((res) => {
    if (!SR) return res(null);
    const r = new SR();
    let done = false;
    r.lang = lang;
    r.interimResults = false;
    r.onresult = (e) => {
      done = true;
      res(e.results[0][0].transcript);
    };
    r.onerror = r.onend = () => {
      if (!done) res(null);
    };
    beep(660, 90);
    try {
      r.start();
    } catch {
      res(null);
    }
  });
}

/** "165", "1.65", "1,7", "5 foot 6", "5'6" -> cm, or null. */
export function parseH(s: string | null): number | null {
  if (!s) return null;
  s = s.toLowerCase();
  let m = s.match(/\b([12])[.,](\d{1,2})\b/);
  if (m) return Math.round(parseFloat(m[1] + "." + m[2]) * 100);
  m = s.match(/(\d)\s*(?:feet|foot|ft|')\s*(\d{1,2})?/);
  if (m) return Math.round(+m[1] * 30.48 + (+m[2] || 0) * 2.54);
  m = s.match(/\d+/);
  const n = m ? +m[0] : 0;
  return n >= 100 && n <= 220 ? n : null;
}
