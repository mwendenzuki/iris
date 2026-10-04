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

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

/** Pull the JSON object out of the model's text, tolerating ```json fences or stray prose. */
function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1))
    throw new Error('no JSON in reply')
  }
}

/** Give up on Google after this long, so the app gets a clear answer instead of hanging. */
const GOOGLE_TIMEOUT_MS = 15000

async function callGemini(apiKey: string, model: string, req: DescribeRequest): Promise<Response> {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: req.image } }, { text: prompt(req) }] }],
      generationConfig: {
        temperature: 0.2,
        // Newer Gemini models "think" before answering and that counts against this limit,
        // so leave plenty of room or the answer comes back empty/cut off.
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  })
}

/** Hosting dashboards make it easy to paste a key with quotes, spaces or a line break: clean that up. */
const cleanKey = (k: string | undefined): string => (k ?? '').trim().replace(/^['"]+|['"]+$/g, '').trim()

export async function describe(body: unknown, rawKey: string | undefined, model = DEFAULT_MODEL): Promise<Reply> {
  const apiKey = cleanKey(rawKey)
  if (!apiKey) return { status: 503, body: { error: 'no_key' } }
  if (!isRequest(body)) return { status: 400, body: { error: 'bad_request' } }

  const started = Date.now()
  const secs = () => ((Date.now() - started) / 1000).toFixed(1)

  let res: Response
  try {
    res = await callGemini(apiKey, model, body)
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    console.warn(`[Iris] Gemini ${timedOut ? 'timed out' : 'unreachable'} after ${secs()}s (model ${model}): ${String(e)}`)
    return { status: 504, body: { error: timedOut ? 'google_timeout' : 'google_unreachable', detail: String(e).slice(0, 200) } }
  }
  console.info(`[Iris] Gemini answered ${res.status} in ${secs()}s (${body.mode}, model ${model})`)

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // Google's own explanation, e.g. "API key not valid. Please pass a valid API key."
    let message = ''
    try {
      message = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? ''
    } catch {
      /* not JSON */
    }
    // Key length (never the key) helps compare the copy on the host with the one in .env
    const keyNote = /api key/i.test(message) ? ` (server key: ${apiKey.length} chars)` : ''
    console.warn(`[Iris] Gemini refused (${res.status}, model ${model}): ${message || detail.slice(0, 200)}${keyNote}`)
    return { status: 502, body: { error: 'gemini_error', status: res.status, message: message + keyNote, detail: detail.slice(0, 500) } }
  }
  const data = (await res.json()) as GeminiResponse
  const cand = data.candidates?.[0]
  const text = cand?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? ''
  if (!text) {
    const why = data.promptFeedback?.blockReason ?? cand?.finishReason ?? 'empty'
    return { status: 502, body: { error: 'empty_reply', reason: why } }
  }
  try {
    return { status: 200, body: parseJson(text) }
  } catch {
    return { status: 502, body: { error: 'bad_json', reason: cand?.finishReason ?? '', detail: text.slice(0, 300) } }
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
