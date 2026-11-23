// ComfyUI's native 3D savers (SaveGLB, Save3DAdvanced, SaveGaussianSplat, SavePointCloud) publish
// `3d: [{ filename, subfolder, type }]` in their ui payload (UI.Saved3DModels), the same triple as
// `images`. The file comes back through /view like an audio file, raw
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import type { ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'
import type { PromptID } from 'src/runner/ComfyWsApi.ts'
import type { ComfyNodeId } from 'src/graph/ComfyNodeID.ts'
import { ComfyTS } from 'src/state.ts'

const PROMPT_ID = 'prompt-3d' as PromptID
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]) // "glTF" v2

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'model3d-host'>
const fetched: string[] = []

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-3d-')) })
   host = comfy.host({ id: 'model3d-host', host: '127.0.0.1', port: 65504 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
   host.fetchFile = async (route: string): Promise<Response> => {
      fetched.push(route)
      return new Response(GLB)
   }
})

afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) (globalThis as { comfyts?: ComfyTS }).comfyts = prior
})

const executionOver = (wf: ComfyWorkflow, save: boolean): ComfyExecution =>
   new ComfyExecution(wf, { id: PROMPT_ID, executed: false, graphID: wf.id }, { save })

const msg = (m: unknown): Parameters<ComfyExecution['onPromptRelatedMessage']>[0] => m as never

const finish = async (execution: ComfyExecution, node: ComfyNodeId, output: unknown): Promise<void> => {
   execution.onPromptRelatedMessage(msg({ type: 'executed', data: { node, output, prompt_id: PROMPT_ID } }))
   execution.onPromptRelatedMessage(msg({ type: 'execution_success', data: { prompt_id: PROMPT_ID, timestamp: 0 } }))
   await execution.done
}

describe('3D outputs', () => {
   // why we think it is actually a bug, and not just meaning spec should change: SaveGLB on the box
   // wrote its mesh and the run reported nothing; the ui payload names the file under `3d`, the same
   // triple audio and video already download, and a library that drops a run's only output is wrong
   it('a glb listed under `3d` lands in execution.models3d, in memory when saving is off', async () => {
      const wf = host.workflow({ id: 'model3d-mem' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, false)

      await finish(execution, node.uid, { '3d': [{ filename: 'a.glb', subfolder: '3d', type: 'output' }] })

      expect(fetched.at(-1)).toBe('/view?filename=a.glb&subfolder=3d&type=output')
      expect(execution.models3d.length).toBe(1)
      const m = execution.models3d[0]
      expect(m?.filename).toBe('a.glb')
      expect(m?.format).toBe('glb')
      expect(m?.mime).toBe('model/gltf-binary')
      expect(m?.absPath).toBe(null)
      expect(m?.nodeId).toBe(node.uid)
      expect(m?.bytes).toEqual(GLB)
      expect(execution.images).toEqual([])
      expect(execution.models3dErrors).toEqual([])
   })

   it('a splat ply is written raw under the local naming when saving is on', async () => {
      const wf = host.workflow({ id: 'model3d-saved' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, true)

      await finish(execution, node.uid, {
         '3d': [{ filename: 'splat_00001_.PLY', subfolder: '', type: 'output' }],
         camera_info: [null],
      })

      const m = execution.models3d[0]
      expect(m?.format).toBe('ply')
      expect(m?.absPath?.endsWith('.PLY')).toBe(true)
      expect(existsSync(m?.absPath ?? '')).toBe(true)
      expect(new Uint8Array(readFileSync(m?.absPath ?? ''))).toEqual(GLB)
   })

   // control: a loader echoing the file it READ is never an output
   it('a `type: input` record is skipped', async () => {
      const wf = host.workflow({ id: 'model3d-input-echo' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, false)
      const before = fetched.length

      await finish(execution, node.uid, { '3d': [{ filename: 'scan.glb', subfolder: '', type: 'input' }] })

      expect(execution.models3d).toEqual([])
      expect(fetched.length).toBe(before)
   })

   // control: a failed download is reported, and `done` still resolves
   it('a failed download lands in models3dErrors', async () => {
      const wf = host.workflow({ id: 'model3d-fail' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, false)
      const ok = host.fetchFile
      host.fetchFile = async (): Promise<Response> => {
         throw new Error('box went away')
      }
      try {
         await finish(execution, node.uid, { '3d': [{ filename: 'b.glb', subfolder: '', type: 'output' }] })
      } finally {
         host.fetchFile = ok
      }

      expect(execution.models3d).toEqual([])
      expect(execution.models3dErrors.map((e) => e.model3d.filename)).toEqual(['b.glb'])
   })
})
