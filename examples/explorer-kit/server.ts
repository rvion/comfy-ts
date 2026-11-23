// the server of an explorer page: the catalog with its live availability, the sample images, the
// uploaded source (by content hash, sent once by the page), and one ComfyUI prompt per run, so
// each card fills as its model finishes and one failure stays one card. The result never touches
// the host disk: the graph ends in SaveImageWebsocket.
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { ComfyTS, exampleImagePath, MediaImage, type BaseNode, type ComfyWorkflow } from 'comfy-ts'
import { basename, dirname, resolve } from 'pathe'
import { availability, entryPayload, type CatalogEntry } from './catalog.ts'

export type HostId = 'windows-1'
export type ExplorerWf = ComfyWorkflow<HostId>
export type ExplorerImg = Comfy.Windows1.Accepts['IMAGE']

export type ExplorerSpec<E extends CatalogEntry, P> = {
   /** the page title in the log line, and the workflow id prefix */
   name: string
   port: number
   page: Bun.HTMLBundle
   catalog: E[]
   /** what a card shows beyond the shared facts */
   card?: (m: E) => Record<string, unknown>
   /** the run's settings out of its json body (beside `image` and `model`): checked and clamped, or a throw */
   readParams: (raw: Record<string, unknown>) => P
   /** the graph up to its output image; the server adds the websocket save node */
   build: (wf: ExplorerWf, image: ExplorerImg, m: E, p: P) => ExplorerImg | BaseNode
}

const HOST_ID: HostId = 'windows-1'

const json = (data: unknown, status = 200): Response => Response.json(data, { status })

/** the bundled example images, plus every `--samples <dir>` of argv: name → file */
function samplesOf(argv: string[]): Map<string, string> {
   const out = new Map<string, string>()
   const dirs = [dirname(exampleImagePath('dog_512x512.jpg'))]
   for (let i = 2; i < argv.length; i++)
      if (argv[i] === '--samples' && argv[i + 1] != null) dirs.push(resolve(String(argv[++i])))
   for (const dir of dirs)
      for (const f of readdirSync(dir)) if (/\.(jpe?g|png|webp)$/i.test(f)) out.set(f, `${dir}/${f}`)
   return out
}

export async function serveExplorer<E extends CatalogEntry, P>(p: ExplorerSpec<E, P>): Promise<void> {
   const comfy = ComfyTS.create()
   // COMFY_URL: another road to the same box (the ssh tunnel on 127.0.0.1:8085 when the tailnet is down)
   const url = process.env.COMFY_URL
   const host = comfy.host(url != null ? { id: HOST_ID, url } : { id: HOST_ID })
   // a live schema: availability reads the loaders' file lists, and a weight downloaded since the
   // cache was written must show up as runnable
   await host.connect({ schema: 'refresh' })

   const images = new Map<string, Uint8Array>()
   const samplePaths = samplesOf(process.argv)
   const slug = p.name.replaceAll(' ', '-')

   const modelsPayload = (): unknown => {
      const info = host.schema.data.spec
      return { host: HOST_ID, models: p.catalog.map((m) => ({ ...entryPayload(info, m), ...p.card?.(m) })) }
   }

   const run = async (raw: unknown): Promise<Response> => {
      if (typeof raw !== 'object' || raw == null) return json({ error: 'body must be a json object' }, 400)
      const body = Object.fromEntries(Object.entries(raw))
      if (typeof body.image !== 'string' || typeof body.model !== 'string')
         return json({ error: 'body needs { image: string, model: string }' }, 400)
      const model = p.catalog.find((m) => m.id === body.model)
      if (model == null) return json({ error: `unknown model ${body.model}` }, 404)
      const avail = availability(host.schema.data.spec, model)
      if (!avail.ok) return json({ error: 'not on this host', ...avail }, 409)
      const bytes = images.get(body.image)
      if (bytes == null) return json({ error: 'unknown image, upload it again' }, 404)
      const params = p.readParams(body)

      const started = performance.now()
      const wf = host.workflow({ id: `${slug}-${model.id}` })
      const loaded = await new MediaImage({ buffer: bytes }).loadInWorkflow_viaLoadImageNode(wf)
      const out = p.build(wf, loaded, model, params)
      const save = wf.builderBase.SaveImageWebsocket
      if (save == null) throw new Error('this host has no SaveImageWebsocket node')
      save({ images: out })
      const execution = await wf.run({ scrubHistory: true })
      const ms = Math.round(performance.now() - started)
      const first = execution.images[0]
      if (execution.status !== 'Success' || first == null) {
         // ComfyUI's own reason (a missing weight, an oom) sits in the error message's data
         const err = execution.data.error
         const message =
            err != null && 'exception_message' in err.data
               ? `${err.data.node_type ?? 'a node'}: ${err.data.exception_message}`
               : `run ended ${execution.status}, no image`
         console.error(`🔴 ${model.id}: ${message}`)
         return json({ error: message, ms }, 500)
      }
      console.log(`🟢 ${model.id} ${ms} ms`)
      return new Response(first.buffer as Uint8Array<ArrayBuffer>, {
         headers: { 'content-type': `image/${first.metadata.type ?? 'png'}`, 'x-ms': String(ms) },
      })
   }

   const server = Bun.serve({
      port: Number(process.env.PORT ?? p.port),
      hostname: '127.0.0.1',
      development: true,
      idleTimeout: 255, // a cold model load on the GPU box takes minutes
      routes: {
         '/': p.page,
         '/api/models': () => json(modelsPayload()),
         '/api/samples': () => json([...samplePaths.keys()]),
         '/api/samples/:name': (req) => {
            const path = samplePaths.get(basename(req.params.name))
            if (path == null) return json({ error: 'no such sample' }, 404)
            return new Response(Bun.file(path))
         },
         '/api/image': {
            POST: async (req) => {
               const bytes = new Uint8Array(await req.arrayBuffer())
               if (bytes.length === 0) return json({ error: 'empty body' }, 400)
               const key = createHash('sha1').update(bytes).digest('hex').slice(0, 16)
               images.set(key, bytes)
               return json({ key })
            },
         },
         '/api/run': {
            POST: async (req) => {
               try {
                  return await run(await req.json())
               } catch (e) {
                  const message = e instanceof Error ? e.message : String(e)
                  console.error('🔴 run failed:', message)
                  return json({ error: message }, 500)
               }
            },
         },
      },
   })

   console.log(`${p.name} → http://127.0.0.1:${server.port}/  (host ${HOST_ID})`)
}
