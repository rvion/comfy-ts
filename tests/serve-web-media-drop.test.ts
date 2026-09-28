// what lands on a media var in the panel: a desktop file or a gallery output. The var must end
// on a LOCAL PATH, since that is what /generate reads. A saved output already is one, an unsaved
// one lives in server memory only and is fetched then uploaded
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import type { ModuleDescription } from 'src/cli/serve/web/api.ts'
import { FormSt } from 'src/cli/serve/web/state/FormSt.ts'
import {
   decodeDraggedOutput,
   encodeDraggedOutput,
   mediaKindOfFile,
   refuseDrop,
   valueForOutput,
   type DraggedOutput,
} from 'src/cli/serve/web/state/mediaDrop.ts'

const realFetch = globalThis.fetch
afterEach(() => {
   globalThis.fetch = realFetch
})
afterAll(() => {
   globalThis.fetch = realFetch
})

const MOD: ModuleDescription = {
   module: 'wf',
   file: '/x/wf.cflow.ts',
   host: 'h',
   drafts: ['default'],
   vars: {
      voice: { kind: 'audio', payload: '', default: '', extensions: ['wav', 'flac'] },
      clip: { kind: 'video', payload: '', default: '', extensions: ['mp4'] },
   },
}

/** records every request; /upload answers the path the server would write */
function stubFetch(): { calls: string[] } {
   const calls: string[] = []
   const g = globalThis as { fetch: typeof fetch }
   g.fetch = ((url: string, init?: { method?: string; body?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/upload') {
         const name = (JSON.parse(String(init?.body)) as { name: string }).name
         return Promise.resolve(
            Response.json({ ok: true, path: `/out/serve-inputs/ab-${name}`, url: `/outputs/serve-inputs/ab-${name}` }),
         )
      }
      if (url.startsWith('/audio/'))
         return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/flac' } }))
      return Promise.resolve(Response.json({ ok: true, drafts: ['default'] }))
   }) as typeof fetch
   return { calls }
}

const form = (): FormSt => new FormSt('wf', 'default', MOD, {}, { autosaveMs: 60_000, previewMs: 60_000 })
const varOf = (f: FormSt, name: string) => f.vars.find((x) => x.name === name)!

describe('dragged outputs', () => {
   it('round-trip through the dataTransfer string', () => {
      const o: DraggedOutput = { kind: 'video', url: '/video/p/0', absPath: null, filename: 'a.mp4' }
      expect(decodeDraggedOutput(encodeDraggedOutput(o))).toEqual(o)
   })

   // control: a drop from another page is not ours
   it('anything else decodes to null', () => {
      expect(decodeDraggedOutput('not json')).toBe(null)
      expect(decodeDraggedOutput(JSON.stringify({ kind: 'pdf', url: '/x', filename: 'x' }))).toBe(null)
      expect(decodeDraggedOutput(JSON.stringify({ kind: 'image', filename: 'x' }))).toBe(null)
   })
})

describe('a desktop file medium', () => {
   it('comes from the mime, else from the extension', () => {
      expect(mediaKindOfFile({ name: 'a.bin', type: 'audio/x-wav' })).toBe('audio')
      expect(mediaKindOfFile({ name: 'clip.mkv', type: '' })).toBe('video')
      expect(mediaKindOfFile({ name: 'notes.txt', type: 'text/plain' })).toBe(null)
   })

   it('a mismatch is refused with a reason, a match is not', () => {
      expect(refuseDrop('audio', 'audio', 'a.wav')).toBe(null)
      expect(refuseDrop('audio', 'image', 'cat.png')).toBe('this is an audio input: cat.png is an image')
      expect(refuseDrop('video', null, 'notes.txt')).toBe('this is a video input: notes.txt is not a known media file')
   })
})

describe('valueForOutput', () => {
   it('a saved output is used by path, nothing fetched', async () => {
      let touched = false
      const value = await valueForOutput(
         { kind: 'audio', url: '/outputs/a.flac', absPath: '/out/a.flac', filename: 'a.flac' },
         {
            fetchBlob: () => ((touched = true), Promise.resolve(new Blob())),
            upload: () => ((touched = true), Promise.resolve({ path: '', url: null })),
         },
      )
      expect(value).toEqual({ path: '/out/a.flac', url: '/outputs/a.flac' })
      expect(touched).toBe(false)
   })
})

describe('VarSt takes media', () => {
   it('an unsaved gallery audio is fetched, uploaded, and the var points at the upload', async () => {
      const { calls } = stubFetch()
      const f = form()
      const voice = varOf(f, 'voice')
      await voice.takeOutput({ kind: 'audio', url: '/audio/p/0', absPath: null, filename: 'song.flac' })
      expect(calls).toEqual(['GET /audio/p/0', 'POST /upload'])
      expect(voice.value).toBe('/out/serve-inputs/ab-song.flac')
      expect(voice.uploadedUrl).toBe('/outputs/serve-inputs/ab-song.flac')
      expect(voice.mediaError).toBe(null)
      f.dispose()
   })

   it('a video output dropped on the audio var is refused loud, the value untouched', async () => {
      const { calls } = stubFetch()
      const f = form()
      const voice = varOf(f, 'voice')
      await voice.takeOutput({ kind: 'video', url: '/video/p/0', absPath: '/out/c.mp4', filename: 'c.mp4' })
      expect(voice.value).toBe('')
      expect(voice.mediaError).toBe('this is an audio input: c.mp4 is a video')
      expect(calls).toEqual([])
      f.dispose()
   })

   it('a desktop video on the video var uploads it', async () => {
      stubFetch()
      const f = form()
      const clip = varOf(f, 'clip')
      await clip.takeFile(new File([new Uint8Array([0, 0, 0, 0x18])], 'take.mp4', { type: 'video/mp4' }))
      expect(clip.value).toBe('/out/serve-inputs/ab-take.mp4')
      f.dispose()
   })
})
