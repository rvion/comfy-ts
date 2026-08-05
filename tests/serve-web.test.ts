import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { ServeApp } from 'src/cli/serve/ServeApp.ts'

// the web ui routes need no modules: html shell, bundle, upload are module-free
function makeApp(p: { webJs?: () => Promise<string | null>; outputRoot?: string } = {}): ServeApp {
   return new ServeApp([], {
      outputRoot: p.outputRoot ?? mkdtempSync(join(tmpdir(), 'comfy-ts-serve-web-')),
      webJs: p.webJs,
   })
}

describe('serve web ui routes', () => {
   it('GET / with Accept text/html serves the shell when webJs is wired', async () => {
      const app = makeApp({ webJs: () => Promise.resolve('js!') })
      const reply = await app.handle({ method: 'GET', url: '/', accept: 'text/html,application/xhtml+xml' })
      expect(reply.status).toBe(200)
      expect(reply.contentType).toContain('text/html')
      expect(String(reply.body)).toContain('/web/app.js')
      expect(String(reply.body)).toContain('id="root"')
   })

   it('GET / without a browser accept stays the json index', async () => {
      const app = makeApp({ webJs: () => Promise.resolve('js!') })
      const reply = await app.handle({ method: 'GET', url: '/' })
      expect(reply.contentType).toBe('application/json')
      expect(JSON.parse(String(reply.body)).server).toBe('comfy-ts serve')
   })

   it('GET / with a browser accept but NO webJs stays the json index', async () => {
      const app = makeApp()
      const reply = await app.handle({ method: 'GET', url: '/', accept: 'text/html' })
      expect(reply.contentType).toBe('application/json')
   })

   it('GET / falls back to the json index when the bundle resolves to null — never a blank shell', async () => {
      const app = makeApp({ webJs: () => Promise.resolve(null) })
      const reply = await app.handle({ method: 'GET', url: '/', accept: 'text/html' })
      expect(reply.contentType).toBe('application/json')
      expect(JSON.parse(String(reply.body)).server).toBe('comfy-ts serve')
   })

   it('GET /lora-info and /lora-preview 404 an unknown host by name', async () => {
      const app = makeApp()
      const info = await app.handle({ method: 'GET', url: '/lora-info/nope/some-lora' })
      const preview = await app.handle({ method: 'GET', url: '/lora-preview/nope/some-lora' })
      expect(info.status).toBe(404)
      expect(JSON.parse(String(info.body)).error).toContain("unknown host 'nope'")
      expect(preview.status).toBe(404)
   })

   it('GET /drafts stays json even for a browser (the api contract is unchanged)', async () => {
      const app = makeApp({ webJs: () => Promise.resolve('js!') })
      const reply = await app.handle({ method: 'GET', url: '/drafts', accept: 'text/html' })
      expect(reply.contentType).toBe('application/json')
   })

   it('GET /web/app.js serves the bundle, built once', async () => {
      let builds = 0
      const app = makeApp({
         webJs: () => {
            builds++
            return Promise.resolve('the-bundle')
         },
      })
      const first = await app.handle({ method: 'GET', url: '/web/app.js' })
      const second = await app.handle({ method: 'GET', url: '/web/app.js' })
      expect(first.status).toBe(200)
      expect(first.contentType).toContain('javascript')
      expect(String(first.body)).toBe('the-bundle')
      expect(String(second.body)).toBe('the-bundle')
      expect(builds).toBe(1)
   })

   it('GET /web/app.js answers 404 when the bundle is unavailable', async () => {
      const app = makeApp({ webJs: () => Promise.resolve(null) })
      const reply = await app.handle({ method: 'GET', url: '/web/app.js' })
      expect(reply.status).toBe(404)
   })
})

describe('serve upload', () => {
   it('stores the decoded bytes under outputs/serve-inputs and answers path + url', async () => {
      const outputRoot = mkdtempSync(join(tmpdir(), 'comfy-ts-serve-up-'))
      const app = makeApp({ outputRoot })
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      const reply = await app.handle({
         method: 'POST',
         url: '/upload',
         body: JSON.stringify({ name: 'té st img.png', dataBase64: Buffer.from(bytes).toString('base64') }),
      })
      expect(reply.status).toBe(200)
      const payload = JSON.parse(String(reply.body)) as { ok: boolean; path: string; url: string }
      expect(payload.ok).toBe(true)
      expect(payload.path).toStartWith(join(outputRoot, 'serve-inputs') + '/')
      expect(payload.url).toStartWith('/outputs/serve-inputs/')
      expect(new Uint8Array(readFileSync(payload.path))).toEqual(bytes)
      // the filename is sanitized, never trusted
      expect(payload.path).not.toContain(' ')
   })

   it('rejects a body without name/dataBase64', async () => {
      const app = makeApp()
      const reply = await app.handle({ method: 'POST', url: '/upload', body: JSON.stringify({ name: 'x.png' }) })
      expect(reply.status).toBe(400)
   })

   it('rejects garbage base64 that decodes to zero bytes', async () => {
      const app = makeApp()
      const reply = await app.handle({
         method: 'POST',
         url: '/upload',
         body: JSON.stringify({ name: 'x.png', dataBase64: '$$$$' }),
      })
      expect(reply.status).toBe(400)
   })
})
