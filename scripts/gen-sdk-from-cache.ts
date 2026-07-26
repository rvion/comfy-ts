// regenerate .comfy-ts/hosts/<id>/sdk.d.ts from the cached object_info.json
// usage: bun scripts/gen-sdk-from-cache.ts [hostId...]   (default: every cached host)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'

const hostsDir = join(process.cwd(), '.comfy-ts', 'hosts')
if (!existsSync(hostsDir)) {
   console.error(`[gen-sdk] 🔴 no ${hostsDir} folder — connect to a host or run the CLI first`)
   process.exit(1)
}

const hostIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : readdirSync(hostsDir)

for (const hostId of hostIds) {
   const dir = join(hostsDir, hostId)
   const objectInfoPath = join(dir, 'object_info.json')
   if (!existsSync(objectInfoPath)) {
      console.error(`[gen-sdk] 🔴 ${objectInfoPath} not found, skipping "${hostId}"`)
      continue
   }
   const spec = JSON.parse(readFileSync(objectInfoPath, 'utf8'))
   const embeddingsPath = join(dir, 'embeddings.json')
   const embeddings: string[] = existsSync(embeddingsPath) ? JSON.parse(readFileSync(embeddingsPath, 'utf8')) : []

   const parsed = new ComfySchema({ spec, embeddings })
   const dts = parsed.codegenDTS({ hostId })
   const outPath = join(dir, 'sdk.d.ts')
   writeFileSync(outPath, dts, 'utf8')
   console.log(`[gen-sdk] 🟢 ${outPath} (${parsed.nodes.length} nodes, ${(dts.length / 1024).toFixed(0)}kB)`)
}
