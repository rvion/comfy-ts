// v.model: a choice over the host's LIVE file list for one loader input. A downloaded model is
// picked in the draft and never written into a .cflow.ts; serve's refresh-schema rebinds the list
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { applyVarPayload } from 'src/cli/serve/applyVarPayload.ts'
import { describeVar } from 'src/cli/serve/describeVar.ts'
import { ServeApp } from 'src/cli/serve/ServeApp.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'model-host'>
let spec: Record<string, { input: { required: Record<string, unknown[]> } }>
const root = mkdtempSync(join(tmpdir(), 'comfy-ts-model-var-'))

function withUnets(names: string[]): typeof spec {
   const copy = structuredClone(spec)
   const unet = copy.UNETLoader!.input.required
   unet.unet_name = [names, {}]
   return copy
}

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: root })
   spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host = comfy.host({ id: 'model-host', host: '127.0.0.1', port: 65530 })
   host.schema.update({
      spec: withUnets(['alpha_base.safetensors', 'alpha_turbo.safetensors', 'beta.safetensors']),
      embeddings: [],
   })
})

afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

const define = (id: string) =>
   host.defineWorkflow({
      id,
      vars: (vv) => ({
         checkpoint: vv.model('UNETLoader.unet_name', { filter: /alpha/i, default: 'alpha_turbo.safetensors' }),
         override: vv.model('UNETLoader.unet_name', { default: null }),
      }),
      build: () => {},
   })

describe('v.model', () => {
   it('lists the host files of that slot, narrowed by the filter', () => {
      const wf = define('model-list')
      expect(wf.vars.checkpoint.choices).toEqual(['alpha_base.safetensors', 'alpha_turbo.safetensors'])
      expect(wf.vars.checkpoint.value).toBe('alpha_turbo.safetensors')
      expect(wf.vars.override.choices).toHaveLength(3)
      // null = the workflow decides
      expect(wf.vars.override.value).toBe(null)
   })

   it('is a choice to serve: described with its host list, a payload must name a listed file', () => {
      const wf = define('model-serve')
      const d = describeVar(wf.vars.checkpoint)
      expect(d.kind).toBe('choice')
      expect(d.choices).toEqual(['alpha_base.safetensors', 'alpha_turbo.safetensors'])
      expect(applyVarPayload(wf.vars.checkpoint, 'beta.safetensors', {})).toContain('expects one of')
      expect(applyVarPayload(wf.vars.checkpoint, 'alpha_base.safetensors', {})).toBe(null)
      expect(wf.vars.checkpoint.value).toBe('alpha_base.safetensors')
   })

   it('outside defineWorkflow it throws, naming the slot', () => {
      const loose = v.model('UNETLoader.unet_name', { default: 'x.safetensors' })
      expect(() => loose.choices).toThrow("v.model('UNETLoader.unet_name') is host-bound")
   })

   it('refresh-schema lists a file the box just got; a picked file the box lost stays picked and is named', async () => {
      const wf = define('model-refresh')
      wf.vars.checkpoint.set('alpha_base.safetensors')
      const app = new ServeApp([{ key: 'model-refresh', file: '/fake/model-refresh.cflow.ts', dw: wf }], {
         outputRoot: join(root, 'out'),
      })
      host.fetchAndUpdateSchema = async () => {
         host.schema.update({ spec: withUnets(['alpha_turbo.safetensors', 'alpha_new.safetensors']), embeddings: [] })
      }
      const reply = await app.handle({ method: 'POST', url: '/hosts/model-host/refresh-schema' })
      const body = JSON.parse(String(reply.body)) as { stale: string[]; note: string }
      expect(wf.vars.checkpoint.choices).toEqual(['alpha_new.safetensors', 'alpha_turbo.safetensors'])
      expect(wf.vars.checkpoint.value).toBe('alpha_base.safetensors')
      expect(body.stale).toEqual(['model-refresh/checkpoint: alpha_base.safetensors'])
   })
})
