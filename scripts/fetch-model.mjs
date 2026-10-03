// Downloads the COCO-SSD (MobileNet v2) weights into public/models/coco-ssd/
// so Iris can load them from its own server instead of Google's at runtime.
// Run once:  npm run fetch-model
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssd_mobilenet_v2/'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'coco-ssd')

async function get(name) {
  const res = await fetch(BASE + name)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

await mkdir(OUT, { recursive: true })
const modelJson = await get('model.json')
await writeFile(join(OUT, 'model.json'), modelJson)

const manifest = JSON.parse(modelJson.toString()).weightsManifest
const files = manifest.flatMap((group) => group.paths)
for (const [i, f] of files.entries()) {
  process.stdout.write(`(${i + 1}/${files.length}) ${f}\n`)
  await writeFile(join(OUT, f), await get(f))
}
console.log(`Done. Saved model.json + ${files.length} weight file(s) to public/models/coco-ssd/`)
