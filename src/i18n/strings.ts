export type Lang = 'en' | 'sw'

export interface Strings {
  stop: string
  ahead: string
  left: string
  right: string
  step: string
  steps: string
  move: string
  then: string
  clear: string
  clearfor: string
  go: string
  turn: string
  slight: string
  around: string
  arrive: string
  load: string
  ready: string
  about: string
  tl: string
  tr: string
  st: string
  scene: string
  none: string
  askH: string
  askD: string
  conf: (heightCm: string | number, destination: string) => string
  rok: string
  rno: string
  miss: string
  nosr: string
  /** BCP-47 tag used for speech synthesis and recognition */
  lang: string

  // ---- obstacle guidance ----
  /** "3 steps away" */
  away: (steps: string) => string
  /** "Walk 2 steps forward, then step 2 steps to your right, then continue." (fwd null = no forward part) */
  avoid: (fwd: string | null, side: string, dir: string) => string

  // ---- trip / route ----
  /** "850 metres" / "2.1 kilometres" */
  distance: (metres: number) => string
  /** "850 metres, about 1200 steps, roughly 16 minutes" */
  trip: (distance: string, steps: number, minutes: number) => string
  routeTo: (place: string, summary: string) => string
  halfway: (left: string, minutes: number) => string
  almost: (steps: string) => string
  arrived: (place: string) => string
  walk: (steps: string) => string
  walkAbout: (steps: string) => string
  youArrive: string
  uturn: string
  keepLeft: string
  keepRight: string
  turnLeft: string
  turnRight: string
  straightOn: string

  // ---- voice conversation ----
  remainingMsg: (place: string, left: string, minutes: number) => string
  askDest: string
  searching: string
  found: (place: string, summary: string) => string
  keepRoute: string
  routeCleared: string
  noRoute: string
  noGps: string
  noWalkRoute: string
  noMic: string
  listening: string
  yesNo: string
  help: string
}

const enDistance = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} metres` : `${(m / 1000).toFixed(1)} kilometres`)
const swDistance = (m: number) => (m < 1000 ? `mita ${Math.max(10, Math.round(m / 10) * 10)}` : `kilomita ${(m / 1000).toFixed(1)}`)
/** 16 -> "16 minutes", 60 -> "1 hour", 85 -> "1 hour and 25 minutes" (over an hour, minutes round to 5) */
const enDuration = (total: number): string => {
  if (total < 60) return `${total} minute${total === 1 ? '' : 's'}`
  const rounded = Math.round(total / 5) * 5
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  const hours = `${h} hour${h === 1 ? '' : 's'}`
  return m ? `${hours} and ${m} minutes` : hours
}
/** 16 -> "dakika 16", 60 -> "saa 1", 85 -> "saa 1 na dakika 25" */
const swDuration = (total: number): string => {
  if (total < 60) return `dakika ${total}`
  const rounded = Math.round(total / 5) * 5
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  return m ? `saa ${h} na dakika ${m}` : `saa ${h}`
}

export const TX: Record<Lang, Strings> = {
  en: {
    stop: 'Stop', ahead: 'ahead', left: 'left', right: 'right', step: 'step', steps: 'steps',
    move: 'Move', then: 'then', clear: 'Path clear', clearfor: 'Clear for', go: 'Walk', turn: 'Turn',
    slight: 'slightly', around: 'Turn around', arrive: 'You have arrived', load: 'Loading. Please wait.',
    ready: 'Ready. Walk forward.', about: 'about', tl: 'left', tr: 'right', st: 'straight on',
    scene: 'In front of you', none: 'Nothing detected. Path clear.',
    askH: 'What is your height in centimetres?',
    askD: 'Where do you want to go? Say none to skip.',
    conf: (h, d) => `Height ${h} centimetres. ${d ? 'Going to ' + d : 'No destination'}. Starting.`,
    rok: 'Route set.', rno: 'Could not find that place.', miss: 'Sorry, I did not catch that.',
    nosr: 'Voice input is not supported on this browser. Please use the form.',
    lang: 'en-US',

    away: (s) => `${s} away`,
    avoid: (fwd, side, dir) =>
      fwd ? `Walk ${fwd} forward, then step ${side} to your ${dir}, then continue.` : `Step ${side} to your ${dir}, then continue.`,
    distance: enDistance,
    trip: (d, steps, m) => `${d}, about ${steps} steps, roughly ${enDuration(m)}`,
    routeTo: (p, sum) => `Route to ${p}: ${sum}.`,
    halfway: (left, m) => `You are halfway. ${left} to go, about ${enDuration(m)}.`,
    almost: (s) => `Almost there. About ${s} to go.`,
    arrived: (p) => `You have arrived at ${p}.`,
    walk: (s) => `Walk ${s}`,
    walkAbout: (s) => `Walk about ${s}`,
    youArrive: 'you will arrive',
    uturn: 'turn around',
    keepLeft: 'keep left',
    keepRight: 'keep right',
    turnLeft: 'turn left',
    turnRight: 'turn right',
    straightOn: 'continue straight',

    remainingMsg: (p, left, m) => `${left} to ${p}, about ${enDuration(m)}.`,
    askDest: 'Where would you like to go?',
    searching: 'Searching.',
    found: (p, sum) => `I found ${p}: ${sum}. Say yes to go there, or no to cancel.`,
    keepRoute: 'Okay, no change.',
    routeCleared: 'Navigation stopped. I will still warn you about obstacles.',
    noRoute: 'No destination set. Say change destination to set one.',
    noGps: 'I do not know where you are yet. Please wait a moment and try again.',
    noWalkRoute: 'I found the place, but no walking route to it.',
    listening: 'Listening…',
    yesNo: 'Please say yes or no.',
    noMic: 'I cannot use the microphone in this browser. Please use Chrome or Edge, and allow microphone access.',
    help: 'You can say: change destination, how far, repeat, what is ahead, cancel route, or stop.',
  },
  sw: {
    stop: 'Simama', ahead: 'mbele', left: 'kushoto', right: 'kulia', step: 'hatua', steps: 'hatua',
    move: 'Sogea', then: 'kisha', clear: 'Njia iko wazi', clearfor: 'Wazi kwa', go: 'Tembea', turn: 'Geuka',
    slight: 'kidogo', around: 'Geuka nyuma', arrive: 'Umefika', load: 'Inapakia. Tafadhali subiri.',
    ready: 'Tayari. Tembea mbele.', about: 'karibu', tl: 'kushoto', tr: 'kulia', st: 'moja kwa moja',
    scene: 'Mbele yako', none: 'Hakuna kitu. Njia iko wazi.',
    askH: 'Urefu wako ni sentimita ngapi?',
    askD: 'Unataka kwenda wapi? Sema hapana kama hakuna.',
    conf: (h, d) => `Urefu ${h} sentimita. ${d ? 'Unaenda ' + d : 'Hakuna mahali'}. Naanza.`,
    rok: 'Njia imewekwa.', rno: 'Sikupata mahali hapo.', miss: 'Samahani, sikusikia vizuri.',
    nosr: 'Kivinjari hiki hakisikii sauti. Tumia fomu.',
    lang: 'sw-KE',

    away: (s) => s,
    avoid: (fwd, side, dir) =>
      fwd ? `Tembea ${fwd} mbele, kisha sogea ${side} ${dir}, kisha endelea.` : `Sogea ${side} ${dir}, kisha endelea.`,
    distance: swDistance,
    trip: (d, steps, m) => `${d}, takriban hatua ${steps}, kama ${swDuration(m)}`,
    routeTo: (p, sum) => `Njia ya kwenda ${p}: ${sum}.`,
    halfway: (left, m) => `Umefika nusu ya safari. Zimebaki ${left}, kama ${swDuration(m)}.`,
    almost: (s) => `Umekaribia kufika. Zimebaki ${s}.`,
    arrived: (p) => `Umefika ${p}.`,
    walk: (s) => `Tembea ${s}`,
    walkAbout: (s) => `Tembea takriban ${s}`,
    youArrive: 'utafika',
    uturn: 'geuka nyuma',
    keepLeft: 'elekea kushoto kidogo',
    keepRight: 'elekea kulia kidogo',
    turnLeft: 'geuka kushoto',
    turnRight: 'geuka kulia',
    straightOn: 'endelea moja kwa moja',

    remainingMsg: (p, left, m) => `Zimebaki ${left} hadi ${p}, kama ${swDuration(m)}.`,
    askDest: 'Ungependa kwenda wapi?',
    searching: 'Natafuta.',
    found: (p, sum) => `Nimepata ${p}: ${sum}. Sema ndiyo kwenda huko, au hapana kughairi.`,
    keepRoute: 'Sawa, hakuna mabadiliko.',
    routeCleared: 'Uelekezaji umesimamishwa. Nitaendelea kukuonya kuhusu vizuizi.',
    noRoute: 'Hakuna mahali palipowekwa. Sema badilisha mahali ili kuweka.',
    noGps: 'Bado sijui uko wapi. Tafadhali subiri kidogo kisha ujaribu tena.',
    noWalkRoute: 'Nimepata mahali, lakini sikupata njia ya kutembea.',
    listening: 'Ninasikiliza…',
    yesNo: 'Tafadhali sema ndiyo au hapana.',
    noMic: 'Siwezi kutumia maikrofoni kwenye kivinjari hiki. Tafadhali tumia Chrome au Edge, na uruhusu maikrofoni.',
    help: 'Unaweza kusema: badilisha mahali, umbali gani, rudia, kuna nini mbele, sitisha safari, au simama.',
  },
}

/** 1 = ordinary obstacle, 2 = large / animal, 3 = vehicle */
export type Risk = 1 | 2 | 3

export interface ObjectInfo {
  /** typical real-world height in metres, used for size-based distance */
  height: number
  /** stands on the ground (bottom of its box = ground contact), so ground-plane distance works */
  ground: boolean
  risk: Risk
  en: string
  sw: string
}

const o = (height: number, risk: Risk, en: string, sw: string, ground = true): ObjectInfo => ({ height, ground, risk, en, sw })

/** COCO-SSD classes Iris cares about, plus 'obstacle' for depth-only hits. */
export const OBJECTS: Record<string, ObjectInfo> = {
  person: o(1.7, 1, 'Person', 'Mtu'),
  bicycle: o(1.0, 2, 'Bicycle', 'Baiskeli'),
  car: o(1.5, 3, 'Car', 'Gari'),
  motorcycle: o(1.3, 3, 'Motorbike', 'Pikipiki'),
  bus: o(3, 3, 'Bus', 'Basi'),
  truck: o(3, 3, 'Truck', 'Lori'),
  dog: o(0.5, 1, 'Dog', 'Mbwa'),
  cow: o(1.3, 2, 'Cow', "Ng'ombe"),
  horse: o(1.6, 2, 'Horse', 'Farasi'),
  sheep: o(0.8, 1, 'Sheep', 'Kondoo'),
  bench: o(0.8, 1, 'Bench', 'Benchi'),
  chair: o(0.9, 1, 'Chair', 'Kiti'),
  couch: o(0.9, 1, 'Sofa', 'Kochi'),
  'dining table': o(0.75, 1, 'Table', 'Meza'),
  suitcase: o(0.6, 1, 'Suitcase', 'Sanduku'),
  'fire hydrant': o(0.7, 1, 'Hydrant', 'Bomba la maji'),
  'potted plant': o(0.5, 1, 'Plant', 'Mmea'),
  train: o(3.5, 3, 'Train', 'Treni'),
  'traffic light': o(0.9, 1, 'Traffic light', 'Taa za barabarani', false),
  'stop sign': o(0.75, 1, 'Stop sign', 'Ishara ya kusimama', false),
  'parking meter': o(1.3, 1, 'Parking meter', 'Mita ya maegesho'),
  cat: o(0.3, 1, 'Cat', 'Paka'),
  bird: o(0.25, 1, 'Bird', 'Ndege', false),
  backpack: o(0.5, 1, 'Bag', 'Mkoba', false),
  handbag: o(0.3, 1, 'Handbag', 'Mkoba wa mkono', false),
  umbrella: o(1.0, 1, 'Umbrella', 'Mwavuli', false),
  skateboard: o(0.15, 1, 'Skateboard', 'Ubao wa kuteleza'),
  'sports ball': o(0.22, 1, 'Ball', 'Mpira'),
  bottle: o(0.25, 1, 'Bottle', 'Chupa'),
  refrigerator: o(1.7, 1, 'Fridge', 'Friji'),
  obstacle: o(0, 1, 'Obstacle', 'Kizuizi', false),
}

export const objectName = (cls: string, lang: Lang): string => OBJECTS[cls][lang]

/** "1 step" / "4 steps" in English, "hatua 4" in Kiswahili (noun first) */
export const stepsText = (n: number, T: Strings): string =>
  T.lang.startsWith('sw') ? `${T.steps} ${n}` : `${n} ${n === 1 ? T.step : T.steps}`
