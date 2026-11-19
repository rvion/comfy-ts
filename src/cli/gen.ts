// fetch a live host's schema and generate its typed sdk
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'pathe'
import { flagReader } from 'src/cli/flags.ts'
import { writeHostFile } from 'src/host/hostFile.ts'
import { renderHttpBase } from 'src/host/hostUrl.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import type { ComfySchemaJSON } from 'src/sdk-generator/ComfyUIObjectInfoTypes.ts'
import { ComfyTS } from 'src/state.ts'
import { readableStringify } from 'src/utils/stringifyReadable.ts'

export async function runGen(args: string[]): Promise<number> {
   const getFlag = flagReader(args)
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

   const dir = host.cacheFolder
   mkdirSync(dir, { recursive: true })
   writeFileSync(join(dir, 'object_info.json'), readableStringify(spec, 4), 'utf8')
   writeFileSync(join(dir, 'embeddings.json'), JSON.stringify(embeddings), 'utf8')
   // the address, so code names this host by id alone: comfy.host({ id })
   const hostFile = writeHostFile(comfy.storage, dir, { url: renderHttpBase(host.base) })
   console.log(`[comfy-ts gen] 🟢 ${hostFile}: comfy.host({ id: '${id}' }) now finds this host`)

   const parsed = new ComfySchema({ spec, embeddings })
   const dts = parsed.codegenDTS({ hostId: id })
   // --out: explicit sdk home (the committed cloud catalog) — the json dumps
   // above still cache under .comfy-ts/hosts/<id>/, but the sdk must exist at
   // ONE tsconfig-visible path only, so it skips the hosts dir entirely
   const out = getFlag('out')
   const outPath = out != null ? resolve(process.cwd(), out) : join(dir, 'sdk.d.ts')
   if (out != null) mkdirSync(dirname(outPath), { recursive: true })
   writeFileSync(outPath, dts, 'utf8')
   console.log(`[comfy-ts gen] 🟢 ${outPath} (${parsed.nodes.length} nodes, ${(dts.length / 1024).toFixed(0)}kB)`)
   if (out == null)
      console.log(`[comfy-ts gen] add ".comfy-ts/hosts/**/sdk.d.ts" to your tsconfig "include" to activate the types`)
   return 0
}
