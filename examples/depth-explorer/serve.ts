// depth explorer: drop any image, run every depth / normal estimator the host has, compare them
// side by side, as a 3D relief or relit by the normals.
//    bun examples/depth-explorer/serve.ts [--samples <dir>]   →  http://127.0.0.1:8292
// one ComfyUI prompt per model, so each card fills as its model finishes and one failure stays one card.
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { ComfyTS, exampleImagePath, MediaImage } from 'comfy-ts'
import { basename, dirname, resolve } from 'pathe'
import { availability, MODELS, type HostId } from './models.ts'
import page from './web/index.html'

const HOST_ID: HostId = 'windows-1'
const PORT = Number(process.env.PORT ?? 8292)

const comfy = ComfyTS.create()
const host = comfy.host({ id: HOST_ID })
// a live schema: availability reads the loaders' file lists, and a weight downloaded since the
// cache was written must show up as runnable
await host.connect({ schema: 'refresh' })

/** uploaded source images, by content hash (the page sends each one once) */
const images = new Map<string, Uint8Array>()

/** the bundled example images, plus every `--samples <dir>` given: name → file */
const samplePaths = new Map<string, string>()
const sampleDirs = [dirname(exampleImagePath('dog_512x512.jpg'))]
for (let i = 2; i < process.argv.length; i++)
   if (process.argv[i] === '--samples' && process.argv[i + 1] != null)
      sampleDirs.push(resolve(String(process.argv[++i])))
for (const dir of sampleDirs)
   for (const f of readdirSync(dir)) if (/\.(jpe?g|png|webp)$/i.test(f)) samplePaths.set(f, `${dir}/${f}`)
const samples = [...samplePaths.keys()]

const json = (data: unknown, status = 200): Response => Response.json(data, { status })

function modelsPayload(): unknown {
   const info = host.schema.data.spec
   return {
      host: HOST_ID,
      models: MODELS.map((m) => ({
         id: m.id,
         label: m.label,
         family: m.family,
         year: m.year,
         kind: m.kind,
         tier: m.tier,
         blurb: m.blurb,
         date: m.date,
         size: m.size,
         quality: m.quality,
         speed: m.speed,
         autoDownload: m.autoDownload === true,
         ...availability(info, m),
      })),
   }
}

type RunBody = { image: string; model: string; detail: number }

function readRunBody(raw: unknown): RunBody {
   const r = raw as Partial<RunBody> | null
   if (r == null || typeof r.image !== 'string' || typeof r.model !== 'string' || typeof r.detail !== 'number')
      throw new Error('body must be { image: string, model: string, detail: number }')
   return { image: r.image, model: r.model, detail: Math.min(2048, Math.max(256, Math.round(r.detail))) }
}

async function run(body: RunBody): Promise<Response> {
   const model = MODELS.find((m) => m.id === body.model)
   if (model == null) return json({ error: `unknown model ${body.model}` }, 404)
   const avail = availability(host.schema.data.spec, model)
   if (!avail.ok) return json({ error: 'not on this host', ...avail }, 409)
   const bytes = images.get(body.image)
   if (bytes == null) return json({ error: 'unknown image, upload it again' }, 404)

   const started = performance.now()
   const wf = host.workflow({ id: `depth-explorer-${model.id}` })
   const loaded = await new MediaImage({ buffer: bytes }).loadInWorkflow_viaLoadImageNode(wf)
   const out = model.build(wf.builder, loaded, { detail: body.detail, wf })
   const save = wf.builderBase.SaveImageWebsocket
   if (save == null) throw new Error('this host has no SaveImageWebsocket node')
   save({ images: out })
   // SaveImageWebsocket: the result never touches the server disk; the source image is uploaded
   // once (hash named) and reused by every model
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
   port: PORT,
   hostname: '127.0.0.1',
   development: true,
   idleTimeout: 255, // a cold model load on the GPU box takes minutes
   routes: {
      '/': page,
      '/api/models': () => json(modelsPayload()),
      '/api/samples': () => json(samples),
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
               return await run(readRunBody(await req.json()))
            } catch (e) {
               const message = e instanceof Error ? e.message : String(e)
               console.error('🔴 run failed:', message)
               return json({ error: message }, 500)
            }
         },
      },
   },
})

console.log(`depth explorer → http://127.0.0.1:${server.port}/  (host ${HOST_ID})`)
