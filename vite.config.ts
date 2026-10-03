import react from '@vitejs/plugin-react'
import type { IncomingMessage } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { describe } from './api/describe.ts'

/** Serves POST /api/describe during `npm run dev` (Vercel serves it in production). */
function geminiDevApi(env: Record<string, string>): Plugin {
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let data = ''
      req.on('data', (c) => (data += c))
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })

  return {
    name: 'gemini-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/describe', async (req, res) => {
        let status: number
        let body: unknown
        try {
          if (req.method !== 'POST') {
            status = 405
            body = { error: 'method_not_allowed' }
          } else {
            let parsed: unknown = null
            try {
              parsed = JSON.parse(await readBody(req))
            } catch {
              /* bad_request */
            }
            const r = await describe(parsed, env.GEMINI_API_KEY, env.GEMINI_MODEL || undefined)
            status = r.status
            body = r.body
          }
        } catch (e) {
          status = 500
          body = { error: 'server_error', detail: String(e) }
        }
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(body))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' prefix = also read non-VITE_ vars, so GEMINI_API_KEY stays server-side
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), geminiDevApi(env)],
  }
})
