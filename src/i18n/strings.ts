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
  },
}

/** 1 = ordinary obstacle, 2 = large / animal, 3 = vehicle */
export type Risk = 1 | 2 | 3

export interface ObjectInfo {
  /** typical real-world height in metres, used for size-based distance */
  height: number
  risk: Risk
  en: string
  sw: string
}

const o = (height: number, risk: Risk, en: string, sw: string): ObjectInfo => ({ height, risk, en, sw })

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
  obstacle: o(0, 1, 'Obstacle', 'Kizuizi'),
}

export const objectName = (cls: string, lang: Lang): string => OBJECTS[cls][lang]

/** "1 step" / "4 steps" in the current language */
export const stepsText = (n: number, T: Strings): string => `${n} ${n === 1 ? T.step : T.steps}`
