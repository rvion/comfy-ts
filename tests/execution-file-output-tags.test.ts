// an output node's `{ tag }` / `{ tags }` metadata names what it saved: a video, a sound or a 3D file
// carries those tags like an image does, so a workflow with two SaveVideo nodes tells them apart
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import type { ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'
import type { PromptID } from 'src/runner/ComfyWsApi.ts'
import type { ComfyNodeId } from 'src/graph/ComfyNodeID.ts'
import { ComfyTS } from 'src/state.ts'

const PROMPT_ID = 'prompt-tags' as PromptID

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'tags-host'>

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-tags-')) })
   host = comfy.host({ id: 'tags-host', host: '127.0.0.1', port: 65504 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
   host.fetchFile = async (): Promise<Response> => new Response(new Uint8Array([1, 2, 3]))
})

afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

const msg = (m: unknown): Parameters<ComfyExecution['onPromptRelatedMessage']>[0] => m as never

const run = async (wf: ComfyWorkflow, outputs: [ComfyNodeId, unknown][]): Promise<ComfyExecution> => {
   const execution = new ComfyExecution(wf, { id: PROMPT_ID, executed: false, graphID: wf.id }, { save: false })
   for (const [node, output] of outputs)
      execution.onPromptRelatedMessage(msg({ type: 'executed', data: { node, output, prompt_id: PROMPT_ID } }))
   execution.onPromptRelatedMessage(msg({ type: 'execution_success', data: { prompt_id: PROMPT_ID, timestamp: 0 } }))
   await execution.done
   return execution
}

describe('file outputs carry their node tags', () => {
   it('two videos, each with the tag of its node', async () => {
      const wf = host.workflow({ id: 'tags-video' })
      const guide = wf.builderBase.EmptyLatentImage({}, { tag: 'guide' })
      const clip = wf.builderBase.EmptyLatentImage({}, { tags: ['clip', 'final'] })
      const execution = await run(wf, [
         [guide.uid, { images: [{ filename: 'guide_00001_.mp4', subfolder: '', type: 'output' }] }],
         [clip.uid, { images: [{ filename: 'clip_00001_.mp4', subfolder: '', type: 'output' }] }],
      ])
      const byName = Object.fromEntries(execution.videos.map((v) => [v.filename, v.tags]))
      expect(byName).toEqual({ 'guide_00001_.mp4': ['guide'], 'clip_00001_.mp4': ['clip', 'final'] })
   })

   it('a sound and a 3D file get their tags too', async () => {
      const wf = host.workflow({ id: 'tags-audio-3d' })
      const song = wf.builderBase.EmptyLatentImage({}, { tag: 'song' })
      const mesh = wf.builderBase.EmptyLatentImage({}, { tag: 'mesh' })
      const execution = await run(wf, [
         [song.uid, { audio: [{ filename: 'song_00001_.flac', subfolder: '', type: 'output' }] }],
         [mesh.uid, { '3d': [{ filename: 'world_00001_.glb', subfolder: '', type: 'output' }] }],
      ])
      expect(execution.audios.map((a) => a.tags)).toEqual([['song']])
      expect(execution.models3d.map((m) => m.tags)).toEqual([['mesh']])
   })

   // control: a node built without metadata gives an empty list, never undefined
   it('no metadata, no tags', async () => {
      const wf = host.workflow({ id: 'tags-none' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = await run(wf, [[node.uid, { images: [{ filename: 'x_00001_.mp4', subfolder: '', type: 'output' }] }]])
      expect(execution.videos.map((v) => v.tags)).toEqual([[]])
   })
})
