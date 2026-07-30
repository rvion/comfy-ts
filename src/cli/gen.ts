// fetch a live host's schema and generate its typed sdk
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import type { ComfySchemaJSON } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'
import { ComfyTS } from 'src/state.ts'
import { readableStringify } from 'src/utils/stringifyReadable.ts'

export async function runGen(args: string[]): Promise<number> {
   const getFlag = (name: string): string | null => {
      const ix = args.indexOf(`--${name}`)
      return ix >= 0 ? (args[ix + 1] ?? null) : null
   }
   const hostUrl = getFlag('host') ?? 'http://127.0.0.1:8188'
   const id = getFlag('id')
   if (id == null) {
      console.error('[comfy-ts gen] 🔴 --id <host-id> is required (it names .comfy-ts/hosts/<id>/)')
      return 1
   }

   // the lib's own authed host.fetch does the /api-first probing + X-API-Key
   const comfy = ComfyTS.create()
   const apiKey = getFlag('api-key') ?? process.env.COMFY_CLOUD_API_KEY
   const host = comfy.host({ id, url: hostUrl, apiKey: apiKey ?? undefined })

   const fetchJSON = async <T>(route: string): Promise<T> => {
      console.log(`[comfy-ts gen] fetching ${hostUrl} ${route} …`)
      const res = await host.fetch(route)
      if (!res.ok) throw new Error(`GET ${route} failed on ${hostUrl}: ${res.status}`)
      if (!(res.headers.get('content-type') ?? '').includes('json'))
         throw new Error(`GET ${route} on ${hostUrl} did not answer json`)
      return (await res.json()) as T
   }

   const spec = await fetchJSON<ComfySchemaJSON>('/object_info')
   const embeddings = await fetchJSON<string[]>('/embeddings').catch(() => [] as string[])

   const dir = join(process.cwd(), '.comfy-ts', 'hosts', id)
   mkdirSync(dir, { recursive: true })
   writeFileSync(join(dir, 'object_info.json'), readableStringify(spec, 4), 'utf8')
   writeFileSync(join(dir, 'embeddings.json'), JSON.stringify(embeddings), 'utf8')

   const parsed = new ComfySchema({ spec, embeddings })
   const dts = parsed.codegenDTS({ hostId: id })
   const outPath = join(dir, 'sdk.d.ts')
   writeFileSync(outPath, dts, 'utf8')
   console.log(`[comfy-ts gen] 🟢 ${outPath} (${parsed.nodes.length} nodes, ${(dts.length / 1024).toFixed(0)}kB)`)
   console.log(`[comfy-ts gen] add ".comfy-ts/hosts/**/sdk.d.ts" to your tsconfig "include" to activate the types`)
   return 0
}
