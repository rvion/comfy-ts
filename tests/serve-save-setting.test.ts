import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'pathe'
import { ServeApp, type ServeExecution, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { readServeSettings } from 'src/cli/serve/serveSettings.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-save-')) })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

function makeApp(p: { seen?: { saveToDisk: boolean }[]; images?: ServeExecution['images'] } = {}): ServeApp {
   const host = comfy.host({ id: 'save-host', host: '127.0.0.1', port: 65500 })
   const dw = host.defineWorkflow({ id: 'wf', vars: { prompt: v.prompt('hi') }, build: () => {} })
   const mod: ServeModule = { key: 'wf', file: '/fake/wf.cflow.ts', dw }
   return new ServeApp([mod], {
      starter: (_mod, opts) => {
         p.seen?.push(opts)
         return Promise.resolve({
            done: Promise.resolve(null),
            status: 'Success',
            images: p.images ?? [{ absPath: null, filename: 'image-abc.png', buffer: PNG }],
            data: { id: 'prompt-1' },
         })
      },
   })
}

function body(reply: { body: string | Uint8Array }): Record<string, unknown> {
   return JSON.parse(String(reply.body)) as Record<string, unknown>
}

describe('save to disk is a setting, not a hardcode', () => {
   it('defaults to saving, and the flag reaches the starter', async () => {
      const seen: { saveToDisk: boolean }[] = []
      const app = makeApp({ seen })
      expect(body(await app.handle({ method: 'GET', url: '/settings' })).saveToDisk).toBe(true)
      await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' })
      expect(seen[0]).toEqual({ saveToDisk: true })
   })

   it('turning it off makes the next run memory-only, and it survives in settings.json', async () => {
      const seen: { saveToDisk: boolean }[] = []
      const app = makeApp({ seen })
      const put = await app.handle({ method: 'PUT', url: '/settings', body: '{"saveToDisk":false}' })
      expect(put.status).toBe(200)
      await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' })
      expect(seen[0]).toEqual({ saveToDisk: false })
      // persisted, so a restart keeps the choice
      expect(readServeSettings().saveToDisk).toBe(false)
      // and a fresh app picks it up
      expect(body(await makeApp().handle({ method: 'GET', url: '/settings' })).saveToDisk).toBe(false)
   })

   it('writing the setting MERGES: the TUI keys in the same file survive', () => {
      mkdirSync(dirname(comfy.settingsPath), { recursive: true })
      writeFileSync(comfy.settingsPath, JSON.stringify({ previewRenderer: 'native', lastDraft: { a: 'b' } }))
      const app = makeApp()
      void app.handle({ method: 'PUT', url: '/settings', body: '{"saveToDisk":true}' })
      const blob = JSON.parse(readFileSync(comfy.settingsPath, 'utf8')) as Record<string, unknown>
      expect(blob.previewRenderer).toBe('native')
      expect(blob.lastDraft).toEqual({ a: 'b' })
      expect(blob.serve).toEqual({ saveToDisk: true, hostOverride: {} })
   })

   it('a body that is not a boolean is a 400', async () => {
      const app = makeApp()
      expect((await app.handle({ method: 'PUT', url: '/settings', body: '{"saveToDisk":"yes"}' })).status).toBe(400)
      expect((await app.handle({ method: 'PUT', url: '/settings', body: 'nope' })).status).toBe(400)
   })
})

describe('in-memory outputs stay reachable (else "memory only" shows a blank gallery)', () => {
   it('the reply points at /images/<promptId>/<ix>, and that route serves the bytes', async () => {
      const app = makeApp()
      const reply = body(await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' }))
      const images = reply.images as { url: string; absPath: string | null }[]
      expect(images[0]?.absPath).toBeNull()
      expect(images[0]?.url).toBe('/images/prompt-1/0')
      const bytes = await app.handle({ method: 'GET', url: '/images/prompt-1/0' })
      expect(bytes.status).toBe(200)
      expect(bytes.contentType).toBe('image/png')
      expect(new Uint8Array(bytes.body as Uint8Array)).toEqual(PNG)
   })

   it('Accept: image/* returns the in-memory bytes too, not an empty 200', async () => {
      const app = makeApp()
      const reply = await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}', accept: 'image/*' })
      expect(reply.contentType).toBe('image/png')
      expect(new Uint8Array(reply.body as Uint8Array)).toEqual(PNG)
   })

   it('an unknown or expired id 404s with a reason instead of a blank image', async () => {
      const reply = await makeApp().handle({ method: 'GET', url: '/images/nope/0' })
      expect(reply.status).toBe(404)
      expect(String(reply.body)).toContain('Turn saving on')
   })

   it('a saved image keeps its /outputs/ url and never enters the memory store', async () => {
      const app = makeApp({ images: [{ absPath: `${comfy.outputPath}/wf/a.png`, filename: 'a.png' }] })
      const reply = body(await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' }))
      const images = reply.images as { url: string }[]
      expect(images[0]?.url).toContain('/outputs/')
      expect((await app.handle({ method: 'GET', url: '/images/prompt-1/0' })).status).toBe(404)
   })
})
