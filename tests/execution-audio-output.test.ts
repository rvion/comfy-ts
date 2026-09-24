// an audio output node (SaveAudio*, PreviewAudio) publishes `audio: [{ filename, subfolder, type }]`
// in its ui payload, the same shape as `images`. The file comes back through /view like an image.
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

const PROMPT_ID = 'prompt-audio' as PromptID
const FLAC = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]) // "fLaC" + payload

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'audio-host'>
const fetched: string[] = []

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-audio-')) })
   host = comfy.host({ id: 'audio-host', host: '127.0.0.1', port: 65503 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
   host.fetchFile = async (route: string): Promise<Response> => {
      fetched.push(route)
      return new Response(FLAC)
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

describe('audio outputs', () => {
   it('downloads every audio entry through /view, bytes untouched, in memory when saving is off', async () => {
      const wf = host.workflow({ id: 'audio-mem' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, false)

      await finish(execution, node.uid, {
         audio: [{ filename: 'ComfyUI_temp_abcd_00001_.flac', subfolder: '', type: 'temp' }],
      })

      expect(fetched.at(-1)).toBe('/view?filename=ComfyUI_temp_abcd_00001_.flac&subfolder=&type=temp')
      expect(execution.audios.length).toBe(1)
      const a = execution.audios[0]
      expect(a?.filename).toBe('ComfyUI_temp_abcd_00001_.flac')
      expect(a?.mime).toBe('audio/flac')
      expect(a?.absPath).toBe(null)
      expect(a?.nodeId).toBe(node.uid)
      expect(a?.bytes).toEqual(FLAC)
      expect(execution.images).toEqual([])
   })

   it('writes the file under the local output naming when saving is on', async () => {
      const wf = host.workflow({ id: 'audio-saved' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, true)

      await finish(execution, node.uid, {
         audio: [{ filename: 'song_00001_.mp3', subfolder: 'yue2', type: 'output' }],
      })

      const a = execution.audios[0]
      expect(a?.mime).toBe('audio/mpeg')
      expect(a?.absPath).not.toBe(null)
      expect(a?.absPath?.endsWith('.mp3')).toBe(true)
      expect(existsSync(a?.absPath ?? '')).toBe(true)
      expect(new Uint8Array(readFileSync(a?.absPath ?? ''))).toEqual(FLAC)
   })

   // control: a payload without audio leaves the list empty
   it('an image or text payload yields no audio', async () => {
      const wf = host.workflow({ id: 'audio-none' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, false)

      await finish(execution, node.uid, { text: ['hi'] })

      expect(execution.audios).toEqual([])
   })
})
