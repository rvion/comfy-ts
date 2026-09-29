// live preview frames (binary ws types 1 and 4) reach a run's `onPreview`, only when it asked,
// and never cross into outputs. The ws saver's output path is the other consumer of the same
// frame kinds, so every test here also pins that the two stay disjoint.
import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { previewMethodFromSystemStats } from 'src/host/previewMethod.ts'
import { ComfyExecution, type ExecutionPreview } from 'src/runner/ComfyExecution.ts'
import type { ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'
import { PromptID_ark, type PromptID } from 'src/runner/ComfyWsApi.ts'
import * as frames from 'src/runner/wsBinaryFrame.ts'
import { ComfyTS } from 'src/state.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'preview-host'>

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-preview-')) })
   host = comfy.host({ id: 'preview-host', host: '127.0.0.1', port: 65503 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
})

afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

afterEach(() => {
   host.onLatentPreview = null
   for (const id of [...host.executions.keys()]) host.executions.delete(id)
   host._pendingMsgs.clear()
})

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 7, 7]
const PNG = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]

function u32(n: number): number[] {
   const b = new ArrayBuffer(4)
   new DataView(b).setUint32(0, n)
   return [...new Uint8Array(b)]
}

function frame(bytes: number[]): ArrayBuffer {
   return Uint8Array.from(bytes).buffer
}

const type1 = (image: number[], imageType = 1): ArrayBuffer => frame([...u32(1), ...u32(imageType), ...image])
const type4 = (metadata: object, image: number[]): ArrayBuffer => {
   const json = [...new TextEncoder().encode(JSON.stringify(metadata))]
   return frame([...u32(4), ...u32(json.length), ...json, ...image])
}

/** a graph with a sampler-like node and a ws saver, plus the execution for it */
async function run(id: string, p: { onPreview?: (x: ExecutionPreview) => void; register?: boolean } = {}) {
   const wf: ComfyWorkflow = host.workflow({ id })
   const b = wf.builder
   const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
   const latent = b.EmptyLatentImage({ width: 64, height: 64, batch_size: 1 })
   const sampler = b.KSampler({
      model: ckpt,
      positive: b.CLIPTextEncode({ clip: ckpt, text: 'a' }),
      negative: b.CLIPTextEncode({ clip: ckpt, text: 'b' }),
      latent_image: latent,
      sampler_name: 'euler',
      scheduler: 'normal',
   })
   const saver = b.SaveImageWebsocket({ images: b.VAEDecode({ samples: sampler, vae: ckpt }) })
   const snapshot = { apiJson: wf.toApiJson(), workflowJson: await wf.toWorkflowJson() }
   const promptId: PromptID = PromptID_ark.assert(`p-${id}`)
   const start = (): ComfyExecution =>
      new ComfyExecution(wf, { id: promptId, executed: false, graphID: wf.id }, { snapshot, onPreview: p.onPreview })
   const execution = p.register === false ? null : start()
   const executing = (node: string): void =>
      host.routeOrBuffer(promptId, { type: 'executing', data: { prompt_id: promptId, node } })
   const progress = (node: string, value: number, max: number): void =>
      host.routeOrBuffer(promptId, { type: 'progress', data: { prompt_id: promptId, node, value, max } })
   return { wf, sampler, saver, promptId, execution, start, executing, progress }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('binary preview frames: parsing', () => {
   it('reads the event type in place, without a copy', () => {
      expect(frames.binaryFrameType(type1(JPEG))).toBe(1)
      expect(frames.binaryFrameType(type4({}, PNG))).toBe(4)
      expect(frames.binaryFrameType(new ArrayBuffer(2))).toBe(-1)
      expect(frames.isPreviewFrameType(1)).toBe(true)
      expect(frames.isPreviewFrameType(4)).toBe(true)
      expect(frames.isPreviewFrameType(3)).toBe(false)
   })

   it('reads the node a type 4 frame names, null when it names none', () => {
      expect(frames.previewMetadataNodeId({ node_id: '12', prompt_id: 'x' })).toBe('12')
      expect(frames.previewMetadataNodeId({ node_id: '' })).toBe(null)
      expect(frames.previewMetadataNodeId({ node_id: 3 })).toBe(null)
      expect(frames.previewMetadataNodeId(null)).toBe(null)
   })
})

describe('onPreview routing', () => {
   it('a frame during a sampler reaches onPreview with its node, step and mime, and never the outputs', async () => {
      const seen: ExecutionPreview[] = []
      const r = await run('route', { onPreview: (x) => seen.push(x) })
      r.executing(r.sampler.uid)
      r.progress(r.sampler.uid, 3, 20)
      host.onMessage({ data: type1(PNG, 2) })
      await tick()

      expect(seen.length).toBe(1)
      expect(seen[0]?.promptId).toBe(r.promptId)
      expect([...(seen[0]?.bytes ?? [])]).toEqual(PNG)
      expect(seen[0]?.mime).toBe('image/png')
      expect(seen[0]?.nodeId).toBe(r.sampler.uid)
      expect(seen[0]?.nodeName).toBe('KSampler')
      expect(seen[0]?.step).toEqual({ value: 3, max: 20 })
      expect(seen[0]?.metadata).toBe(null)
      expect(r.execution?.images).toEqual([])
   })

   it('a type 4 frame names its own node through its metadata', async () => {
      const seen: ExecutionPreview[] = []
      const r = await run('meta', { onPreview: (x) => seen.push(x) })
      r.executing(r.sampler.uid)
      host.onMessage({ data: type4({ node_id: r.sampler.uid, prompt_id: r.promptId }, JPEG) })

      expect(seen[0]?.nodeId).toBe(r.sampler.uid)
      expect(seen[0]?.mime).toBe('image/jpeg')
      expect(seen[0]?.metadata).toEqual({ node_id: r.sampler.uid, prompt_id: r.promptId })
   })

   it('a frame during the ws saver is an OUTPUT, and never reaches onPreview', async () => {
      const seen: ExecutionPreview[] = []
      const r = await run('saver', { onPreview: (x) => seen.push(x) })
      r.executing(r.saver.uid)
      host.onMessage({ data: type1(PNG, 2) })
      await tick()

      expect(seen).toEqual([])
      expect(r.execution?.images.length).toBe(1)
      expect([...(r.execution?.images[0]?.buffer ?? [])]).toEqual(PNG)
   })

   it('frames beating the POST /prompt reply replay as previews, while the saver frame stays an output', async () => {
      const seen: ExecutionPreview[] = []
      const r = await run('race', { onPreview: (x) => seen.push(x), register: false })
      r.executing(r.sampler.uid)
      host.onMessage({ data: type1(JPEG) })
      r.executing(r.saver.uid)
      host.onMessage({ data: type1(PNG, 2) })

      const execution = r.start()
      await tick()
      expect(seen.map((x) => [...x.bytes])).toEqual([JPEG])
      expect(seen[0]?.nodeId).toBe(r.sampler.uid) // the replay walks the stream in order
      expect(execution.images.length).toBe(1)
      expect([...(execution.images[0]?.buffer ?? [])]).toEqual(PNG)
   })

   it('nobody listening: the frame is never parsed, and the lazy host latent still decodes on read', async () => {
      const parse = spyOn(frames, 'parsePreviewFrame')
      try {
         const r = await run('silent')
         r.executing(r.sampler.uid)
         host.onMessage({ data: type1(PNG, 2) })
         expect(parse).toHaveBeenCalledTimes(0)
         expect(r.execution?.images).toEqual([])

         const latent = host.latentPreview
         expect(parse).toHaveBeenCalledTimes(1)
         expect(latent?.blob.type).toBe('image/png')
         expect(latent?.promptID).toBe(r.promptId)
         expect(host.latentPreview).toBe(latent) // cached per frame
         expect(parse).toHaveBeenCalledTimes(1)
      } finally {
         parse.mockRestore()
      }
   })

   it('the host hook alone still receives every frame', async () => {
      const hooked: string[] = []
      host.onLatentPreview = (x) => void hooked.push(x.mime)
      const r = await run('hook')
      r.executing(r.sampler.uid)
      host.onMessage({ data: type1(JPEG) })
      expect(hooked).toEqual(['image/jpeg'])
   })
})

describe('run entry points thread onPreview', () => {
   it('DefinedWorkflow.run → build().run() → start() hands the callback to the execution', async () => {
      const onPreview = (): void => {}
      const dw = host.defineWorkflow({ id: 'thread', vars: {}, build: () => {} })
      const realConnect = host.connect
      const realFetch = host.fetch
      host.connect = () => Promise.resolve()
      // start() refuses a host with no ws; the socket itself is never used here
      host.ws = {} as never
      host.fetch = () =>
         Promise.resolve(new Response(JSON.stringify({ prompt_id: 'p-thread', number: 1, node_errors: {} })))
      try {
         const done = dw.run({ onPreview })
         const promptId = PromptID_ark.assert('p-thread')
         while (!host.executions.has(promptId)) await tick()
         expect(host.executions.get(promptId)?.onPreview).toBe(onPreview)
         host.routeOrBuffer(promptId, { type: 'execution_success', data: { prompt_id: promptId, timestamp: 0 } })
         expect((await done).status).toBe('Success')
      } finally {
         host.connect = realConnect
         host.fetch = realFetch
         host.ws = null
      }
   })
})

describe('previewMethodFromSystemStats', () => {
   const stats = (argv: unknown): unknown => ({ system: { argv } })
   it('reads both spellings of the flag', () => {
      expect(previewMethodFromSystemStats(stats(['main.py', '--preview-method', 'auto']))).toBe('auto')
      expect(previewMethodFromSystemStats(stats(['main.py', '--preview-method=taesd']))).toBe('taesd')
   })
   it("answers 'none', ComfyUI's default, when the flag is absent", () => {
      expect(previewMethodFromSystemStats(stats(['main.py', '--listen']))).toBe('none')
   })
   it('answers null when there is no argv to read, or a value it does not know', () => {
      expect(previewMethodFromSystemStats({ system: {} })).toBe(null)
      expect(previewMethodFromSystemStats({})).toBe(null)
      expect(previewMethodFromSystemStats(stats(['--preview-method', 'sparkles']))).toBe(null)
   })
})
