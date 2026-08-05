// writes dist/serve-web.js, the web ui bundle `comfy-ts serve` ships — runs
// after tsdown in `bun run build` (architecture item 12, web ui)
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'
import { buildWebJsText } from 'src/cli/serve/webBundle.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const js = await buildWebJsText(repoRoot)
const out = join(repoRoot, 'dist', 'serve-web.js')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, js)
console.log(`serve-web.js → ${out} (${(js.length / 1024).toFixed(0)} kB)`)
