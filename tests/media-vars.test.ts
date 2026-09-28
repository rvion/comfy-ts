// v.image / v.audio / v.video: one path contract, three loader nodes. loadInWorkflow uploads the
// file hash-named through /upload/image (ComfyUI's one upload route, audio and video included)
// and adds LoadImage / LoadAudio / LoadVideo with that name
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { MediaImage } from 'src/runner/MediaImage.ts'
import { ComfyTS } from 'src/state.ts'
import { asAbsolutePath } from 'src/types/index.ts'
import { hashArrayBuffer } from 'src/utils/hashArrayBuffer.ts'
import {
   DEFAULT_AUDIO_EXTENSIONS,
   DEFAULT_VIDEO_EXTENSIONS,
   ImageVarEmptyError,
   MediaVarEmptyError,
   v,
} from 'src/vars/ComfyVars.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'media-host'>
let bare: ComfyHost<'media-bare'>
const uploads: string[] = []
const dir = mkdtempSync(join(tmpdir(), 'comfy-ts-media-vars-'))
const FLAC = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 9, 8, 7])
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
const PNG = new Uint8Array(readFileSync('examples/images/bear_1024x1024.jpg'))
const flacPath = join(dir, 'voice.flac')
const mp4Path = join(dir, 'clip.mp4')
const jpgPath = join(dir, 'bear.jpg')

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   writeFileSync(flacPath, FLAC)
   writeFileSync(mp4Path, MP4)
   writeFileSync(jpgPath, PNG)
   const comfy = new ComfyTS({ rootPath: dir })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   // the fixture predates LoadVideo: the core node's own declaration
   const withVideo = {
      ...spec,
      LoadVideo: {
         input: { required: { file: [[], { video_upload: true }] } },
         output: ['VIDEO'],
         output_is_list: [false],
         output_name: ['VIDEO'],
         name: 'LoadVideo',
         display_name: 'Load Video',
         description: '',
         category: 'image/video',
         python_module: 'comfy_extras.nodes_video',
         output_node: false,
      },
   }
   host = comfy.host({ id: 'media-host', host: '127.0.0.1', port: 65511 })
   host.schema.update({ spec: withVideo, embeddings: [] })
   host.fetch = async (route: string, init: RequestInit = {}): Promise<Response> => {
      const form = init.body as FormData
      const file = form.get('image') as File
      uploads.push(`${route} ${file.name} ${file.type}`)
      return Response.json({ name: file.name, subfolder: '', type: 'input' })
   }
   bare = comfy.host({ id: 'media-bare', host: '127.0.0.1', port: 65512 })
   bare.schema.update({ spec, embeddings: [] })
})

afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

describe('media vars', () => {
   it('audio and video are their own kinds with their own picker extensions', () => {
      const a = v.audio('/x/voice.wav')
      const vid = v.video('/x/clip.mp4')
      expect(a.kind).toBe('audio')
      expect(vid.kind).toBe('video')
      expect(a.extensions).toEqual(DEFAULT_AUDIO_EXTENSIONS)
      expect(vid.extensions).toEqual(DEFAULT_VIDEO_EXTENSIONS)
      expect(v.audio('', { extensions: ['wav'] }).extensions).toEqual(['wav'])
      expect(a.toJSON()).toBe('/x/voice.wav')
   })

   it('an empty media var throws the one error class, naming its medium', () => {
      const a = v.audio('')
      a.name = 'voice'
      expect(() => a.outValue()).toThrow(MediaVarEmptyError)
      expect(() => a.outValue()).toThrow("audio var 'voice' is empty")
      // the image-only name is the same class, so old catch sites keep working
      expect(ImageVarEmptyError).toBe(MediaVarEmptyError)
      expect(new MediaVarEmptyError('x', 'video').name).toBe('MediaVarEmptyError')
   })

   it('audio loads through LoadAudio, uploaded hash-named, and a rerun does not upload again', async () => {
      const a = v.audio(flacPath)
      const wf = host.workflow({ id: 'load-audio' })
      const node = await a.loadInWorkflow(wf)
      const name = `${hashArrayBuffer(FLAC)}.flac`
      expect(node.json.class_type).toBe('LoadAudio')
      expect(node.json.inputs).toEqual({ audio: name })
      expect(uploads.at(-1)).toBe(`/upload/image ${name} audio/flac`)
      const before = uploads.length
      await a.loadInWorkflow(host.workflow({ id: 'load-audio-again' }))
      expect(uploads.length).toBe(before)
   })

   it('video loads through LoadVideo `file`', async () => {
      const wf = host.workflow({ id: 'load-video' })
      const node = await v.video(mp4Path).loadInWorkflow(wf)
      expect(node.json.class_type).toBe('LoadVideo')
      expect(node.json.inputs).toEqual({ file: `${hashArrayBuffer(MP4)}.mp4` })
      expect(uploads.at(-1)).toContain('video/mp4')
   })

   it('image loads through LoadImage under the SAME name MediaImage gives it', async () => {
      const wf = host.workflow({ id: 'load-image' })
      wf.dry = true
      const node = await v.image(jpgPath).loadInWorkflow(wf)
      const viaMedia = new MediaImage({ path: asAbsolutePath(jpgPath) }).enumName
      expect(node.json.inputs).toEqual({ image: viaMedia })
   })

   it('a dry build names the file and uploads nothing', async () => {
      const before = uploads.length
      const wf = host.workflow({ id: 'dry-audio' })
      wf.dry = true
      const node = await v.audio(flacPath).loadInWorkflow(wf)
      expect(node.json.inputs).toEqual({ audio: `${hashArrayBuffer(FLAC)}.flac` })
      expect(uploads.length).toBe(before)
   })

   it('a host without the loader node fails loud, naming the node', async () => {
      const vid = v.video(mp4Path)
      vid.name = 'clip'
      await expect(vid.loadInWorkflow(bare.workflow({ id: 'no-video' }))).rejects.toThrow(
         "host 'media-bare' has no LoadVideo node: video var 'clip' cannot load",
      )
   })
})
