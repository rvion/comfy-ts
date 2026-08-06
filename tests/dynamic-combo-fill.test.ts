// a dotted branch key is not a schema input, so serializeValue's default-fill never sees
// it: an absent one reaches the host as `400 required_input_missing` (probed on ComfyUI
// 0.27.0, TextGenerate.sampling_mode). ComfyNode fills the SELECTED branch instead.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyTS } from 'src/state.ts'

// the global registration is process-wide state (comfyts-singleton precedent):
// run on an OWN temp root, restore whatever another test file registered
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'combo-host'>

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-combo-')) })
   host = comfy.host({ id: 'combo-host', host: '127.0.0.1', port: 65501 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info-v3-widgets.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
})

afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) (globalThis as { comfyts?: ComfyTS }).comfyts = prior
})

/** the one dynamic-combo node of the v3 fixture: 3 branches keyed by `resize_type` */
const resizeInputs = (p: Record<string, unknown>): Record<string, unknown> => {
   const wf = host.workflow({ id: 'combo-test' })
   const node = wf.builderBase.ResizeImageMaskNode({ scale_method: 'area', ...p })
   return wf.toApiJson('use_stringified_numbers_only')[node.uid]?.inputs ?? {}
}

describe('dynamic combo serialization', () => {
   it('omitted key falls back to the schema default branch, fully filled', () => {
      const inputs = resizeInputs({})
      expect(inputs.resize_type).toBe('scale dimensions')
      expect(inputs['resize_type.width']).toBe(512)
      expect(inputs['resize_type.height']).toBe(512)
      expect(inputs['resize_type.crop']).toBe('center')
   })

   it('a selected branch fills its own defaults and emits no other branch key', () => {
      const inputs = resizeInputs({ resize_type: 'scale total pixels' })
      expect(inputs.resize_type).toBe('scale total pixels')
      expect(inputs['resize_type.megapixels']).toBe(1)
      expect(inputs).not.toHaveProperty('resize_type.width')
      expect(inputs).not.toHaveProperty('resize_type.height')
      expect(inputs).not.toHaveProperty('resize_type.crop')
   })

   it('a caller value beats the schema default', () => {
      const inputs = resizeInputs({ resize_type: 'scale dimensions', 'resize_type.width': 1024 })
      expect(inputs['resize_type.width']).toBe(1024)
      expect(inputs['resize_type.height']).toBe(512)
   })

   it('keys of a branch that is not selected are dropped, never passed through', () => {
      const inputs = resizeInputs({ resize_type: 'scale total pixels', 'resize_type.width': 1024 })
      expect(inputs).not.toHaveProperty('resize_type.width')
      expect(inputs['resize_type.megapixels']).toBe(1)
   })

   it('an unknown key records a problem instead of shipping a broken prompt', () => {
      const wf = host.workflow({ id: 'combo-bad' })
      const node = wf.builderBase.ResizeImageMaskNode({ scale_method: 'area', resize_type: 'no such branch' })
      const inputs = wf.toApiJson('use_stringified_numbers_only')[node.uid]?.inputs ?? {}
      expect(inputs).not.toHaveProperty('resize_type')
      expect(wf.problems.some((x) => x.title.includes('no such branch'))).toBe(true)
   })
})
