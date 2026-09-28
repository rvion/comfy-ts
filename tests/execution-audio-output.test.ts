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

// a video saver names its file under `images` (core SaveVideo, `animated: [true]`) or `gifs`
// (VideoHelperSuite). Fed to the image path, an mp4 became a broken <img> in the gallery
describe('video outputs', () => {
   it('an mp4 listed under images lands in execution.videos, never in images', async () => {
      const wf = host.workflow({ id: 'video-core' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, false)

      await finish(execution, node.uid, {
         images: [{ filename: 'ComfyUI_00001_.mp4', subfolder: 'video', type: 'output' }],
         animated: [true],
      })

      expect(execution.images).toEqual([])
      expect(execution.videos.length).toBe(1)
      expect(execution.videos[0]?.mime).toBe('video/mp4')
      expect(execution.videos[0]?.filename).toBe('ComfyUI_00001_.mp4')
      expect(fetched.at(-1)).toBe('/view?filename=ComfyUI_00001_.mp4&subfolder=video&type=output')
   })

   it('VideoHelperSuite `gifs` entries are videos too, and saving writes them raw', async () => {
      const wf = host.workflow({ id: 'video-vhs' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, true)

      await finish(execution, node.uid, {
         gifs: [{ filename: 'AnimateDiff_00001.webm', subfolder: '', type: 'output' }],
      })

      const vid = execution.videos[0]
      expect(vid?.mime).toBe('video/webm')
      expect(vid?.absPath?.endsWith('.webm')).toBe(true)
      expect(new Uint8Array(readFileSync(vid?.absPath ?? ''))).toEqual(FLAC)
   })

   // why we think it is actually a bug, and not just meaning spec should change: LoadVideo echoes the
   // file it READ (type 'input') in its ui payload; a run that loads one video and saves one listed two
   // outputs on the live host, the first being the input itself
   it('a loader echoing its input file is not an output', async () => {
      const wf = host.workflow({ id: 'video-input-echo' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, false)

      await finish(execution, node.uid, {
         images: [{ filename: 'ceee.mp4', subfolder: '', type: 'input' }],
         animated: [true],
      })

      expect(execution.videos).toEqual([])
      expect(execution.images).toEqual([])
   })

   // control: an animated webp is an IMAGE, whatever the animated flag says
   it('an animated webp stays an image', async () => {
      const wf = host.workflow({ id: 'video-webp' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf, false)

      await finish(execution, node.uid, {
         images: [{ filename: 'anim_00001_.webp', subfolder: '', type: 'output' }],
         animated: [true],
      })

      expect(execution.videos).toEqual([])
      expect(execution.images.length + execution.imageErrors.length).toBe(1)
   })
})
