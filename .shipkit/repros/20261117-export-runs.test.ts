// why we think it is actually a bug, and not just meaning spec should change: toWorkflowJson promises the editor's own save shape, and the import of that export must give back the same prompt (architecture.md, round trip); a dynamic combo exported as a dead slot, or a linked widget that drops its widget value, breaks that round trip
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyTS } from 'src/state.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let v3: ComfyHost<'export-v3'>
let old: ComfyHost<'export-2024'>
beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-export-')) })
   v3 = comfy.host({ id: 'export-v3', host: '127.0.0.1', port: 65506 })
   v3.schema.update({
      spec: JSON.parse(readFileSync('tests/fixtures/object_info-v3-widgets.json', 'utf-8')),
      embeddings: [],
   })
   old = comfy.host({ id: 'export-2024', host: '127.0.0.1', port: 65507 })
   old.schema.update({ spec: JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8')), embeddings: [] })
})
afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

describe('repro: export round trip', () => {
   it('a dynamic combo survives export then import', async () => {
      const wf = v3.workflow({ id: 'combo-rt' })
      wf.builderBase.ResizeImageMaskNode({
         scale_method: 'area',
         resize_type: 'scale total pixels',
         'resize_type.megapixels': 2,
      })
      const back = v3.importWorkflowJson(await wf.toWorkflowJson(), { id: 'combo-rt-back' })
      expect(back.toApiJson('use_stringified_numbers_only')).toEqual(wf.toApiJson('use_stringified_numbers_only'))
   })

   it('a widget fed by a link keeps the following widgets aligned', async () => {
      const wf = old.workflow({ id: 'linked-rt' })
      const b = wf.builder
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      const latent = b.EmptyLatentImage({ width: 64, height: 64, batch_size: 1 })
      const seed = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip: ckpt, text: 'a' }),
         negative: b.CLIPTextEncode({ clip: ckpt, text: 'b' }),
         latent_image: latent,
         seed: Reflect.get(
            wf.builderBase,
            old.schema.nodesByNameInComfy['Integer place counter']?.nodeKey ?? '',
         )({ int_input: 5 }),
         sampler_name: 'euler',
         scheduler: 'normal',
         steps: 7,
         cfg: 3,
      })
      b.LatentUpscaleBy({ samples: seed, upscale_method: 'nearest-exact', scale_by: 2 })
      const back = old.importWorkflowJson(await wf.toWorkflowJson(), { id: 'linked-rt-back' })
      expect(back.toApiJson('use_stringified_numbers_only')).toEqual(wf.toApiJson('use_stringified_numbers_only'))
   })
})
