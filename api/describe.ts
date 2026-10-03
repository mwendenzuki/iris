// POST /api/describe — Vercel serverless function, also mounted by the Vite dev server (vite.config.ts).
// Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in .env locally and in Vercel's Environment Variables.
// The API key only ever lives on the server; the phone sends a camera frame and gets back JSON.

export type Mode = 'describe' | 'hazards'

export interface DescribeRequest {
  /** base64 JPEG, no data: prefix */
  image: string
  mode: Mode
  lang: 'en' | 'sw'
  /** user's stride in metres, so Gemini can talk in steps */
  stride: number
}

export interface Reply {
  status: number
  body: unknown
}

/** Default to Google's rolling "latest Flash" alias; override with GEMINI_MODEL. */
export const DEFAULT_MODEL = 'gemini-flash-latest'

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    hazards: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          side: { type: 'STRING', enum: ['left', 'ahead', 'right'] },
          distance_m: { type: 'NUMBER' },
          urgent: { type: 'BOOLEAN' },
        },
        required: ['label', 'side', 'distance_m', 'urgent'],
      },
    },
  },
  required: ['summary', 'hazards'],
}

function prompt({ mode, lang, stride }: DescribeRequest): string {
  const language = lang === 'sw' ? 'Kiswahili' : 'English'
  const task =
    mode === 'describe'
      ? `"summary": one or two short sentences to be spoken aloud: what is directly ahead, the main hazards with their side (left, ahead, right) and distance in steps, and whether the path is clear. No filler such as "the image shows".`
      : `Focus ONLY on hazards in or next to the walking path within about 6 metres that a standard object detector would miss: potholes, open drains or ditches, kerbs, steps, broken or uneven pavement, poles, low branches, construction, water or mud, motorbikes or stalls blocking the path. "summary" may be an empty string.`
  return [
    'You are the eyes of a blind pedestrian in Kenya. The photo is from a phone held at chest height, pointing where they are walking.',
    `Write every text field in ${language}.`,
    `One walking step is about ${stride.toFixed(2)} metres.`,
    task,
    '"hazards": each item has "label" (2-4 words naming exactly what it is, e.g. "open drain", "electric pole", "parked motorbike", "concrete step", "low tree branch"; never a vague word like "obstacle" or "object"), "side" (left/ahead/right), "distance_m" (your best estimate in metres) and "urgent" (true if within 2 metres and in the path).',
    'Only report things you can actually see. If unsure, leave it out. Use an empty list if there are none.',
  ].join('\n')
}

function isRequest(b: unknown): b is DescribeRequest {
  const r = b as DescribeRequest
  return (
    !!r &&
    typeof r.image === 'string' &&
    r.image.length > 100 &&
    r.image.length < 3_000_000 &&
    (r.mode === 'describe' || r.mode === 'hazards') &&
    (r.lang === 'en' || r.lang === 'sw') &&
    typeof r.stride === 'number'
  )
}

export async function describe(body: unknown, apiKey: string | undefined, model = DEFAULT_MODEL): Promise<Reply> {
  if (!apiKey) return { status: 503, body: { error: 'no_key' } }
  if (!isRequest(body)) return { status: 400, body: { error: 'bad_request' } }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ inline_data: { mime_type: 'image/jpeg', data: body.image } }, { text: prompt(body) }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { status: 502, body: { error: 'gemini_error', status: res.status, detail: detail.slice(0, 500) } }
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  try {
    return { status: 200, body: JSON.parse(text) }
  } catch {
    return { status: 502, body: { error: 'bad_json', detail: text.slice(0, 500) } }
  }
}

/** Vercel entry point */
export async function POST(request: Request): Promise<Response> {
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    /* handled as bad_request */
  }
  try {
    const r = await describe(body, process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || undefined)
    return Response.json(r.body, { status: r.status })
  } catch (e) {
    return Response.json({ error: 'server_error', detail: String(e) }, { status: 500 })
  }
}
