import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ComfyTS } from 'src/state.ts'
import { createMemoryStorage } from 'src/storage/ComfyStorage.ts'
import { v } from 'src/vars/ComfyVars.ts'

// the browser runtime story headless: EVERYTHING on an in-memory storage —
// no fs call may leak from create → host → schema → defineWorkflow → build.
// (the fixture read below is test harness, not library code.)
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   comfy = new ComfyTS({ rootPath: '/virtual', storage: createMemoryStorage() })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

describe('web runtime smoke (memory storage end to end)', () => {
   it('host + schema + defineWorkflow + build produce prompt json without touching disk', async () => {
      expect(comfy.storage.kind).toBe('memory')
      const host = comfy.host({ id: 'web-host', url: 'http://127.0.0.1:65499' })
      const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
      host.schema.update({ spec, embeddings: [] })

      const dw = host.defineWorkflow({
         id: 'web-smoke',
         vars: { prompt: v.text('a lighthouse'), seed: v.seed(7), steps: v.int(4) },
         build: (b, vars) => {
            const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
            const latent = b.EmptyLatentImage({ width: 64, height: 64, batch_size: 1 })
            const sampled = b.KSampler({
               model: ckpt,
               positive: b.CLIPTextEncode({ clip: ckpt, text: vars.prompt }),
               negative: b.CLIPTextEncode({ clip: ckpt, text: '' }),
               latent_image: latent,
               sampler_name: 'euler',
               scheduler: 'normal',
               seed: vars.seed,
               steps: vars.steps,
               cfg: 7,
               denoise: 1,
            })
            b.PreviewImage({ images: b.VAEDecode({ samples: sampled, vae: ckpt }) })
         },
      })
      const wf = await dw.build()
      expect(wf.size).toBe(7)
      const prompt = wf.toApiJson()
      expect(Object.values(prompt).find((n) => n.class_type === 'KSampler')?.inputs.seed).toBe(7)
      // the schema cache write landed in the MEMORY backend, not on disk
      expect(comfy.storage.exists(host.cacheFolder)).toBe(true)
   })

   it('an sdk write goes to memory storage, readable back through the seam', () => {
      const host = comfy.hosts.get('web-host')
      if (host == null) throw new Error('host missing')
      comfy.storage.writeText(host.sdkDTSPath, '// generated')
      expect(comfy.storage.readText(host.sdkDTSPath)).toBe('// generated')
   })
})
