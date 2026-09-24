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
      expect(String(reply.body)).toContain('/web/app.js?v=')
      expect(String(reply.body)).toContain('id="root"')
   })

   it('an edited web ui reaches the next page load without a server restart', async () => {
      // why we think it is actually a bug, and not just meaning spec should change: `bun run
      // serve:rvion` restarts only when a file the SERVER imports changes, and the web ui is
      // bundled, not imported, so an edited panel never showed on refresh until a manual restart
      let js = 'console.log(1)'
      const app = makeApp({ webJs: () => Promise.resolve(js) })
      const shell = async (): Promise<string> =>
         String((await app.handle({ method: 'GET', url: '/', accept: 'text/html' })).body)
      const before = await shell()
      js = 'console.log(2)'
      expect(await shell()).not.toBe(before)
      expect(String((await app.handle({ method: 'GET', url: '/web/app.js' })).body)).toBe('console.log(2)')
   })

   it('the shell carries the project icon as an inlined png favicon', async () => {
      const app = makeApp({ webJs: () => Promise.resolve('js!') })
      const body = String((await app.handle({ method: 'GET', url: '/', accept: 'text/html' })).body)
      const href = body.match(
         /<link rel="icon" type="image\/png" href="data:image\/png;base64,([A-Za-z0-9+/=]+)">/,
      )?.[1]
      expect(href).toBeDefined()
      const bytes = Buffer.from(href ?? '', 'base64')
      // the png signature, then a 64x64 IHDR
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(bytes.readUInt32BE(16)).toBe(64)
      expect(bytes.readUInt32BE(20)).toBe(64)
   })

   // no-store cannot save a browser that already cached app.js under the plain url in an
   // earlier run: the CONTENT HASH in the src is what guarantees a changed bundle is fetched
   it('the script url carries a build id that follows the bundle content', async () => {
      const shellFor = async (js: string): Promise<string> => {
         const app = makeApp({ webJs: () => Promise.resolve(js) })
         return String((await app.handle({ method: 'GET', url: '/', accept: 'text/html' })).body)
      }
      const a = await shellFor('console.log(1)')
      const b = await shellFor('console.log(2)')
      const again = await shellFor('console.log(1)')
      expect(a).not.toBe(b)
      expect(a).toBe(again) // same bundle, same url: an unchanged panel still caches
      expect(a).toMatch(/\/web\/app\.js\?v=[a-z0-9]+"/)
   })

   it('a versioned request still reaches the bundle route', async () => {
      const app = makeApp({ webJs: () => Promise.resolve('js!') })
      const reply = await app.handle({ method: 'GET', url: '/web/app.js?v=abc123' })
      expect(reply.status).toBe(200)
      expect(String(reply.body)).toBe('js!')
   })

   // the bundle is rebuilt per serve process, so a cached copy is ALWAYS the wrong one: with
   // no cache header a browser applies heuristic freshness and reuses app.js across reloads
   it('the shell and the bundle are uncacheable', async () => {
      const app = makeApp({ webJs: () => Promise.resolve('js!') })
      const shell = await app.handle({ method: 'GET', url: '/', accept: 'text/html' })
      expect(shell.headers?.['cache-control']).toContain('no-store')
      const js = await app.handle({ method: 'GET', url: '/web/app.js' })
      expect(js.status).toBe(200)
      expect(js.headers?.['cache-control']).toContain('no-store')
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

   it('GET /web/app.js serves what the provider hands over (the provider owns the cache)', async () => {
      const app = makeApp({ webJs: () => Promise.resolve('the-bundle') })
      const reply = await app.handle({ method: 'GET', url: '/web/app.js' })
      expect(reply.status).toBe(200)
      expect(reply.contentType).toContain('javascript')
      expect(String(reply.body)).toBe('the-bundle')
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

describe('web ui source signature', () => {
   it('moves when a source file is rewritten, added or removed, and only then', async () => {
      const { sourceSignature } = await import('src/cli/serve/webBundle.ts')
      const { writeFileSync, rmSync, mkdirSync, utimesSync } = await import('node:fs')
      const dir = mkdtempSync(join(tmpdir(), 'comfy-ts-websig-'))
      mkdirSync(join(dir, 'web'))
      writeFileSync(join(dir, 'web', 'a.tsx'), 'one')
      const first = sourceSignature(dir)
      expect(sourceSignature(dir)).toBe(first)
      writeFileSync(join(dir, 'web', 'a.tsx'), 'one!')
      const edited = sourceSignature(dir)
      expect(edited).not.toBe(first)
      writeFileSync(join(dir, 'b.ts'), 'x')
      utimesSync(join(dir, 'b.ts'), 0, 0)
      const added = sourceSignature(dir)
      expect(added).not.toBe(edited)
      rmSync(join(dir, 'b.ts'))
      expect(sourceSignature(dir)).not.toBe(added)
   })
})
