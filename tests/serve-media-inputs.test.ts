// audio and video vars through serve: the same file gate as an image var, each medium with its
// own floor and its own magic sniff, and video outputs in the run reply and the memory store
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { describeVar } from 'src/cli/serve/describeVar.ts'
import { makeRequestListener } from 'src/cli/serve/run-serve.ts'
import { isMediaMagic, ServeApp, type ServeExecution, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let root: string
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   root = mkdtempSync(join(tmpdir(), 'comfy-ts-serve-media-'))
   comfy = ComfyTS.create({ rootPath: root })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b)
const WAV = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)
const FLAC = bytes(0x66, 0x4c, 0x61, 0x43, 0, 0)
const MP3_ID3 = bytes(0x49, 0x44, 0x33, 4, 0)
const MP3_FRAME = bytes(0xff, 0xfb, 0x90, 0x44)
const OGG = bytes(0x4f, 0x67, 0x67, 0x53, 0)
const MP4 = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d)
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f)
const AVI = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)

let started = 0
function makeModule(key: string, exec?: () => ServeExecution): { mod: ServeModule; app: ServeApp } {
   const host = comfy.host({ id: 'serve-media-host', host: '127.0.0.1', port: 65520 })
   const dw = host.defineWorkflow({
      id: key,
      vars: { voice: v.audio(''), clip: v.video('') },
      build: () => {},
   })
   const mod = { key, file: `/fake/${key}.cflow.ts`, dw }
   const app = new ServeApp([mod], {
      outputRoot: join(root, 'out'),
      starter: () => {
         started++
         return Promise.resolve(
            exec?.() ?? { done: Promise.resolve(null), status: 'Success', images: [], data: { id: `p-${key}` } },
         )
      },
   })
   return { mod, app }
}

function file(name: string, content: Uint8Array | string): string {
   const abs = join(root, name)
   writeFileSync(abs, content)
   return abs
}

async function generate(
   app: ServeApp,
   key: string,
   body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
   const r = await app.handle({ method: 'POST', url: `/generate/${key}/default`, body: JSON.stringify(body) })
   return { status: r.status, json: JSON.parse(String(r.body)) as Record<string, unknown> }
}

describe('media magic', () => {
   it('recognizes each medium by its bytes', () => {
      for (const b of [WAV, FLAC, MP3_ID3, MP3_FRAME, OGG, MP4]) expect(isMediaMagic('audio', b)).toBe(true)
      for (const b of [MP4, WEBM, AVI]) expect(isMediaMagic('video', b)).toBe(true)
      expect(isMediaMagic('image', PNG)).toBe(true)
   })

   // control: one medium's bytes never pass as another's (mp4 and m4a share isobmff: the extension floor splits them)
   it('refuses the other media and plain text', () => {
      for (const b of [PNG, WEBM, AVI, new TextEncoder().encode('#!/bin/sh')])
         expect(isMediaMagic('audio', b)).toBe(false)
      for (const b of [PNG, WAV, FLAC, OGG, new TextEncoder().encode('PRIVATE KEY')])
         expect(isMediaMagic('video', b)).toBe(false)
      expect(isMediaMagic('image', WAV)).toBe(false)
   })

   // why we think it is actually a bug, and not just meaning spec should change: FF FE is the
   // utf-16le BOM; it matched the mpeg frame sync, so a text file named .mp3 was read and uploaded
   it('a utf-16le text file does not pass as mp3', () => {
      const utf16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(Buffer.from('password=hunter2', 'utf16le'))])
      expect(isMediaMagic('audio', utf16)).toBe(false)
   })
})

describe('audio and video vars in serve', () => {
   it('describe themselves with their kind and extensions', () => {
      const { mod } = makeModule('wf-media-describe')
      const vars = Object.fromEntries(mod.dw.entries())
      const voice = describeVar(vars.voice!)
      expect(voice.kind).toBe('audio')
      expect(voice.extensions).toContain('flac')
      expect(describeVar(vars.clip!).kind).toBe('video')
   })

   it('a real audio file and a real video file pass', async () => {
      const { app } = makeModule('wf-media-ok')
      const before = started
      const r = await generate(app, 'wf-media-ok', { voice: file('ok.wav', WAV), clip: file('ok.mp4', MP4) })
      expect(r.status).toBe(200)
      expect(started).toBe(before + 1)
   })

   it('an image handed to an audio var is refused before anything is queued', async () => {
      const { app } = makeModule('wf-media-wrong')
      const before = started
      const r = await generate(app, 'wf-media-wrong', { voice: file('pic.png', PNG) })
      expect(r.status).toBe(400)
      expect(r.json.error).toBe("audio var 'voice': not a usable audio file")
      expect(started).toBe(before)
   })

   it('a key NAMED .mp4 is refused: the bytes are the gate', async () => {
      const { app } = makeModule('wf-media-fake')
      const r = await generate(app, 'wf-media-fake', { clip: file('id_rsa.mp4', 'PRIVATE KEY') })
      expect(r.status).toBe(400)
      expect(r.json.error).toBe("video var 'clip': not a usable video file")
   })

   it('an empty media var is a 400 naming its medium', async () => {
      const host = comfy.host({ id: 'serve-media-host', host: '127.0.0.1', port: 65520 })
      const dw = host.defineWorkflow({
         id: 'wf-media-empty',
         vars: { voice: v.audio('') },
         build: (_b, vars) => void vars.voice,
      })
      const mod = { key: 'wf-media-empty', file: '/fake/wf-media-empty.cflow.ts', dw }
      const app = new ServeApp([mod], {
         outputRoot: join(root, 'out'),
         starter: async (m) => {
            await m.dw.build({ dry: true })
            throw new Error('unreachable: the build must throw first')
         },
      })
      const r = await generate(app, 'wf-media-empty', {})
      expect(r.status).toBe(400)
      expect(r.json.error).toContain("audio var 'voice' is empty")
   })
})

describe('video outputs reach the panel', () => {
   it('an in-memory video is served from /video/<promptId>/<ix> with its content type', async () => {
      const { app } = makeModule('wf-video-mem', () => ({
         done: Promise.resolve(null),
         status: 'Success',
         images: [],
         data: { id: 'p-video' },
         videos: [{ absPath: null, filename: 'ComfyUI_00001_.mp4', mime: 'video/mp4', bytes: MP4 }],
      }))
      const r = await generate(app, 'wf-video-mem', {})
      const video = (r.json.videos as { url: string; mime: string }[])[0]!
      expect(video.url).toBe('/video/p-video/0')
      expect(video.mime).toBe('video/mp4')
      const fetched = await app.handle({ method: 'GET', url: video.url })
      expect(fetched.status).toBe(200)
      expect(fetched.contentType).toBe('video/mp4')
      expect(fetched.body).toEqual(MP4)
      // and the kept results list it after a reload
      const kept = JSON.parse(String((await app.handle({ method: 'GET', url: '/results' })).body)) as {
         runs: { videos?: { url: string }[] }[]
      }
      expect(kept.runs[0]?.videos?.[0]?.url).toBe('/video/p-video/0')
   })
})

describe('POST /upload takes a video-sized body', () => {
   it('a body past the json cap reaches /upload, and the json routes still refuse it', async () => {
      const { app } = makeModule('wf-media-upload')
      const server = createServer(makeRequestListener(app))
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      const port = typeof address === 'object' && address != null ? address.port : 0
      try {
         const big = new Uint8Array(9_000_000).fill(7)
         const body = JSON.stringify({ name: 'clip.mp4', dataBase64: Buffer.from(big).toString('base64') })
         const up = await fetch(`http://127.0.0.1:${port}/upload`, { method: 'POST', body })
         expect(up.status).toBe(200)
         const drafts = await fetch(`http://127.0.0.1:${port}/drafts/wf-media-upload/big`, { method: 'PUT', body })
         expect(drafts.status).toBe(413)
      } finally {
         server.close()
      }
   })
})
