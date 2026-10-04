// Netlify version of POST /api/describe (same logic as the Vercel function in api/describe.ts).
// public/_redirects sends /api/describe here. Set GEMINI_API_KEY (and optionally GEMINI_MODEL)
// in Netlify: Site configuration -> Environment variables, then redeploy.
import { describe } from '../../api/describe.ts'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
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
