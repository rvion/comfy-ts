import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'pathe'
import { makeRequestListener } from 'src/cli/serve/run-serve.ts'
import { ServeApp, type ServeExecution, type ServeModule, type ServeStarter } from 'src/cli/serve/ServeApp.ts'
import { draftsDirForFile } from 'src/cli/tui/state/DraftsSt.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

// the global registration is process-wide state: this file owns ONE temp-root
// instance (ServeApp resolves drafts + outputs through it), restored after
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let root: string
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   root = mkdtempSync(join(tmpdir(), 'comfy-ts-serve-'))
   comfy = ComfyTS.create({ rootPath: root })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

function fakeExecution(
   p: { id?: string; status?: string; images?: string[]; texts?: string[]; error?: unknown } = {},
): ServeExecution {
   return {
      done: Promise.resolve(null),
      status: p.status ?? 'Success',
      images: (p.images ?? []).map((absPath) => ({ absPath, filename: absPath.split('/').pop() ?? absPath })),
      texts: (p.texts ?? []).map((text, ix) => ({ nodeId: String(ix), nodeKey: 'PreviewAny', text })),
      data: { id: p.id ?? 'prompt-1', error: p.error },
   }
}

/** a served module over throwaway vars; the starter is injected per test */
function makeModule(key: string): ServeModule {
   const host = comfy.host({ id: `serve-test-host`, host: '127.0.0.1', port: 65500 })
   const dw = host.defineWorkflow({
      id: key,
      vars: {
         prompt: v.text('default prompt'),
         seed: v.seed(7),
         steps: v.int(8, { min: 1, max: 40 }),
         sampler: v.choice(['euler', 'ddim'] as const, 'euler'),
         source: v.image(''),
      },
      build: () => {},
   })
   return { key, file: `/fake/${key}.cflow.ts`, dw }
}

/** snapshot what the starter saw (the values the graph would be built from) */
function snapshottingStarter(seen: Record<string, unknown>[], exec?: () => ServeExecution): ServeStarter {
   return (mod) => {
      seen.push(Object.fromEntries(mod.dw.entries().map(([k, varDef]) => [k, varDef.toJSON()])))
      return Promise.resolve(exec?.() ?? fakeExecution())
   }
}

async function post(app: ServeApp, path: string, body?: unknown, accept?: string) {
   return app.handle({ method: 'POST', url: path, body: body == null ? '' : JSON.stringify(body), accept })
}

function parse(reply: { body: string | Uint8Array }): Record<string, unknown> {
   return JSON.parse(typeof reply.body === 'string' ? reply.body : new TextDecoder().decode(reply.body))
}

describe('ServeApp routing + introspection', () => {
   it('GET / and /drafts self-describe modules, drafts, vars', async () => {
      const mod = makeModule('wf-index')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      const reply = await app.handle({ method: 'GET', url: '/drafts' })
      expect(reply.status).toBe(200)
      const body = parse(reply)
      const wf = (body.workflows as Record<string, unknown>[])[0]!
      expect(wf.module).toBe('wf-index')
      expect(wf.drafts).toEqual(['default'])
      const vars = wf.vars as Record<string, { kind: string; choices?: string[] }>
      expect(vars.sampler?.choices).toEqual(['euler', 'ddim'])
      expect(vars.seed?.kind).toBe('seed')
   })

   it('GET /drafts/<module>/<draft> merges stored values; unknown → 404', async () => {
      const mod = makeModule('wf-detail')
      mkdirSync(draftsDirForFile(mod.file), { recursive: true })
      writeFileSync(join(draftsDirForFile(mod.file), 'tuned.json'), JSON.stringify({ prompt: 'tuned!' }))
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      const body = parse(await app.handle({ method: 'GET', url: '/drafts/wf-detail/tuned' }))
      expect((body.values as Record<string, unknown>).prompt).toBe('tuned!')
      expect((await app.handle({ method: 'GET', url: '/drafts/wf-detail/nope' })).status).toBe(404)
      expect((await app.handle({ method: 'GET', url: '/drafts/ghost/default' })).status).toBe(404)
   })

   it('unqualified /generate/<draft> resolves when unique, 400s when ambiguous', async () => {
      const a = makeModule('wf-amb-a')
      const b = makeModule('wf-amb-b')
      for (const m of [a, b]) mkdirSync(draftsDirForFile(m.file), { recursive: true })
      writeFileSync(join(draftsDirForFile(a.file), 'only-a.json'), '{}')
      writeFileSync(join(draftsDirForFile(a.file), 'both.json'), '{}')
      writeFileSync(join(draftsDirForFile(b.file), 'both.json'), '{}')
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([a, b], { starter: snapshottingStarter(seen), outputRoot: join(root, 'out') })
      expect((await post(app, '/generate/only-a')).status).toBe(200)
      const amb = await post(app, '/generate/both')
      expect(amb.status).toBe(400)
      expect(parse(amb).error).toContain('/generate/wf-amb-a/both')
      expect((await post(app, '/generate/ghost-draft')).status).toBe(404)
   })
})

describe('ServeApp generate', () => {
   it('draft values are the defaults, payload overrides, run sees the merge', async () => {
      const mod = makeModule('wf-gen')
      mkdirSync(draftsDirForFile(mod.file), { recursive: true })
      writeFileSync(join(draftsDirForFile(mod.file), 'tuned.json'), JSON.stringify({ prompt: 'from draft', steps: 12 }))
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([mod], { starter: snapshottingStarter(seen), outputRoot: join(root, 'out') })
      const reply = await post(app, '/generate/wf-gen/tuned', { steps: 33 })
      expect(reply.status).toBe(200)
      expect(seen[0]).toMatchObject({ prompt: 'from draft', steps: 33 })
      const body = parse(reply)
      expect(body.ok).toBe(true)
      expect(body.promptId).toBe('prompt-1')
      // draft NOT hit by the previous request's payload: fresh reload each time
      await post(app, '/generate/wf-gen/tuned')
      expect(seen[1]).toMatchObject({ prompt: 'from draft', steps: 12 })
   })

   it('unknown var and invalid values 400 without starting anything', async () => {
      const mod = makeModule('wf-400')
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([mod], { starter: snapshottingStarter(seen), outputRoot: join(root, 'out') })
      const unknown = await post(app, '/generate/wf-400/default', { nope: 1 })
      expect(unknown.status).toBe(400)
      expect(parse(unknown).error).toContain("unknown var 'nope'")
      const badChoice = await post(app, '/generate/wf-400/default', { sampler: 'dpmpp' })
      expect(badChoice.status).toBe(400)
      const badImage = await post(app, '/generate/wf-400/default', { source: '/definitely/not/here.png' })
      expect(badImage.status).toBe(400)
      expect(parse(badImage).error).toContain('file not found')
      const badBody = await app.handle({ method: 'POST', url: '/generate/wf-400/default', body: '[1,2]' })
      expect(badBody.status).toBe(400)
      expect(seen.length).toBe(0)
   })

   it("seed policy: '+' continues across requests, '?' rerolls, explicit payload wins", async () => {
      const mod = makeModule('wf-seed')
      mkdirSync(draftsDirForFile(mod.file), { recursive: true })
      writeFileSync(join(draftsDirForFile(mod.file), 'inc.json'), JSON.stringify({ seed: { mode: '+', value: 100 } }))
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([mod], { starter: snapshottingStarter(seen), outputRoot: join(root, 'out') })
      const r1 = parse(await post(app, '/generate/wf-seed/inc'))
      const r2 = parse(await post(app, '/generate/wf-seed/inc'))
      expect((r1.seeds as Record<string, number>).seed).toBe(100)
      expect((r2.seeds as Record<string, number>).seed).toBe(101)
      const r3 = parse(await post(app, '/generate/wf-seed/inc', { seed: 55 }))
      expect((r3.seeds as Record<string, number>).seed).toBe(55)
      const r4 = parse(await post(app, '/generate/wf-seed/inc'))
      expect((r4.seeds as Record<string, number>).seed).toBe(56)
   })

   it('a payload seed mode must NOT leak into the next request', async () => {
      const mod = makeModule('wf-seed-leak')
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([mod], { starter: snapshottingStarter(seen), outputRoot: join(root, 'out') })
      // request 1 asks for reroll mode; the default draft has mode '=' value 7
      await post(app, '/generate/wf-seed-leak/default', { seed: { mode: '?' } })
      // request 2 sends NO seed: it must get the draft's fixed 7, not a reroll
      const r2 = parse(await post(app, '/generate/wf-seed-leak/default'))
      expect((r2.seeds as Record<string, number>).seed).toBe(7)
      expect((seen[1] as { seed: { mode: string } }).seed.mode).toBe('=')
   })

   it('concurrent posts on one module never interleave var state (mutex)', async () => {
      const mod = makeModule('wf-mutex')
      let inFlight = 0
      let maxInFlight = 0
      const seen: Record<string, unknown>[] = []
      const starter: ServeStarter = async (m) => {
         inFlight++
         maxInFlight = Math.max(maxInFlight, inFlight)
         await new Promise((r) => setTimeout(r, 15))
         seen.push(Object.fromEntries(m.dw.entries().map(([k, varDef]) => [k, varDef.toJSON()])))
         inFlight--
         return fakeExecution()
      }
      const app = new ServeApp([mod], { starter, outputRoot: join(root, 'out') })
      const [a, b] = await Promise.all([
         post(app, '/generate/wf-mutex/default', { prompt: 'first' }),
         post(app, '/generate/wf-mutex/default', { prompt: 'second' }),
      ])
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(maxInFlight).toBe(1)
      expect(seen.map((s) => s.prompt).sort()).toEqual(['first', 'second'])
   })

   it('execution Failure → 500 with the error payload', async () => {
      const mod = makeModule('wf-fail')
      const app = new ServeApp([mod], {
         starter: () => Promise.resolve(fakeExecution({ status: 'Failure', error: { node: '3', reason: 'OOM' } })),
         outputRoot: join(root, 'out'),
      })
      const reply = await post(app, '/generate/wf-fail/default')
      expect(reply.status).toBe(500)
      expect(parse(reply).error).toMatchObject({ reason: 'OOM' })
   })

   it('images map to /outputs urls; Accept: image/* returns the raw bytes', async () => {
      const outputRoot = join(root, 'out')
      const imgAbs = join(outputRoot, 'sub dir', 'result.png')
      mkdirSync(join(outputRoot, 'sub dir'), { recursive: true })
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      writeFileSync(imgAbs, bytes)
      const mod = makeModule('wf-img')
      const app = new ServeApp([mod], {
         starter: () => Promise.resolve(fakeExecution({ images: [imgAbs] })),
         outputRoot,
      })
      const body = parse(await post(app, '/generate/wf-img/default'))
      const img = (body.images as { url: string }[])[0]!
      expect(img.url).toBe('/outputs/sub%20dir/result.png')
      // the url round-trips through the static route
      const fetched = await app.handle({ method: 'GET', url: img.url })
      expect(fetched.status).toBe(200)
      expect(fetched.contentType).toBe('image/png')
      expect(fetched.body).toEqual(bytes)
      // Accept: image/* short-circuits to the first image's bytes
      const raw = await post(app, '/generate/wf-img/default', undefined, 'image/*')
      expect(raw.contentType).toBe('image/png')
      expect(raw.body).toEqual(bytes)
   })

   it('outputs route refuses path traversal', async () => {
      const mod = makeModule('wf-trav')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      const reply = await app.handle({ method: 'GET', url: '/outputs/../../etc/passwd' })
      expect(reply.status).toBe(400)
      expect(parse(reply).error).toContain('escapes')
      // the outputs ROOT itself is a directory, not a servable file
      expect((await app.handle({ method: 'GET', url: '/outputs/' })).status).toBe(404)
      // malformed percent-escapes are a client error, not a crash
      expect((await app.handle({ method: 'GET', url: '/outputs/%ZZ' })).status).toBe(400)
   })
})

describe('image vars are a file gate, not a file reader', () => {
   // the path in a payload is read off THIS box and uploaded to the ComfyUI host, which for a
   // cloud host is a third party. The descriptor advertises the extensions it takes, so they
   // are ENFORCED: an unauthenticated caller must not be able to name an arbitrary file
   it('refuses a real file whose extension the var never advertised', async () => {
      const secret = join(root, 'id_rsa')
      writeFileSync(secret, 'PRIVATE KEY')
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([makeModule('wf-img-ext')], {
         outputRoot: join(root, 'out'),
         starter: snapshottingStarter(seen),
      })
      const reply = await app.handle({
         method: 'POST',
         url: '/generate/wf-img-ext/default',
         body: JSON.stringify({ source: secret }),
      })
      expect(reply.status).toBe(400)
      expect(JSON.parse(String(reply.body)).error).toContain('is not one of')
      expect(seen).toHaveLength(0) // nothing was queued, so nothing was uploaded
   })

   it('refuses a directory, which existsSync alone happily accepts', async () => {
      const app = new ServeApp([makeModule('wf-img-dir')], { outputRoot: join(root, 'out') })
      const reply = await app.handle({
         method: 'POST',
         url: '/generate/wf-img-dir/default',
         body: JSON.stringify({ source: root }),
      })
      expect(reply.status).toBe(400)
      expect(JSON.parse(String(reply.body)).error).toContain('not a file')
   })

   it('an advertised extension still passes', async () => {
      const png = join(root, 'ok.png')
      writeFileSync(png, 'not really a png, but the name is what is gated')
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([makeModule('wf-img-ok')], {
         outputRoot: join(root, 'out'),
         starter: snapshottingStarter(seen),
      })
      const reply = await app.handle({
         method: 'POST',
         url: '/generate/wf-img-ok/default',
         body: JSON.stringify({ source: png }),
      })
      expect(reply.status).toBe(200)
      expect(seen).toHaveLength(1)
   })
})

describe('http layer (makeRequestListener over a real socket)', () => {
   it('--cors is what grants another origin, and it is off by default', async () => {
      const app = new ServeApp([makeModule('wf-cors')], { outputRoot: join(root, 'out') })
      const server = createServer(makeRequestListener(app, { cors: true }))
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const addr = server.address()
      if (addr == null || typeof addr === 'string') throw new Error('no port')
      try {
         const res = await fetch(`http://127.0.0.1:${addr.port}/drafts`, {
            headers: { origin: 'https://elsewhere.example' },
         })
         expect(res.headers.get('access-control-allow-origin')).toBe('*')
      } finally {
         server.close()
      }
   })

   it('serves the index, answers OPTIONS, 413s an oversized body', async () => {
      const mod = makeModule('wf-http')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      const server = createServer(makeRequestListener(app))
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const addr = server.address()
      if (addr == null || typeof addr === 'string') throw new Error('no port')
      const base = `http://127.0.0.1:${addr.port}`
      try {
         const index = await fetch(`${base}/drafts`)
         expect(index.status).toBe(200)
         // NO cross-origin grant by default: the panel is same-origin, and `*` on a no-auth
         // server lets any page you open drive this api and read the replies
         expect(index.headers.get('access-control-allow-origin')).toBeNull()
         const preflight = await fetch(`${base}/generate/x`, { method: 'OPTIONS' })
         expect(preflight.status).toBe(204)
         expect(preflight.headers.get('access-control-allow-methods')).toBeNull()
         // the overflow path must ANSWER, never just destroy the socket
         const big = await fetch(`${base}/generate/wf-http/default`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: `{"prompt":"${'x'.repeat(11_000_000)}"}`,
         })
         expect(big.status).toBe(413)
         expect(((await big.json()) as { error: string }).error).toContain('too large')
      } finally {
         await new Promise((r) => server.close(r))
      }
   })
})

describe('ServeApp draft save (PUT) + live run state', () => {
   it('PUT writes the draft, lists it, and a follow-up GET serves the stored values', async () => {
      const mod = makeModule('wf-save')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      const put = await app.handle({
         method: 'PUT',
         url: '/drafts/wf-save/night%20mode',
         body: JSON.stringify({ prompt: 'a night bear', steps: 12 }),
      })
      expect(put.status).toBe(200)
      const putBody = JSON.parse(String(put.body)) as { ok: boolean; drafts: string[] }
      expect(putBody.ok).toBe(true)
      expect(putBody.drafts).toContain('night mode')
      const get = await app.handle({ method: 'GET', url: '/drafts/wf-save/night%20mode' })
      const got = JSON.parse(String(get.body)) as { values: Record<string, unknown> }
      expect(got.values.prompt).toBe('a night bear')
      expect(got.values.steps).toBe(12)
   })

   it('PUT rejects bad names, non-object bodies, and unknown vars — nothing written', async () => {
      const mod = makeModule('wf-save-bad')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      const badName = await app.handle({ method: 'PUT', url: '/drafts/wf-save-bad/..%2Fescape', body: '{}' })
      expect(badName.status).toBe(400)
      const badBody = await app.handle({ method: 'PUT', url: '/drafts/wf-save-bad/ok', body: '[1,2]' })
      expect(badBody.status).toBe(400)
      const badVar = await app.handle({
         method: 'PUT',
         url: '/drafts/wf-save-bad/ok',
         body: JSON.stringify({ nope: 1 }),
      })
      expect(badVar.status).toBe(400)
      expect(JSON.parse(String(badVar.body)).error).toContain('unknown var(s) nope')
      const list = await app.handle({ method: 'GET', url: '/drafts' })
      expect(String(list.body)).not.toContain('"ok"')
   })

   it('a generate flushed through PUT is what the run reads (autosave contract)', async () => {
      const mod = makeModule('wf-flush')
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([mod], { outputRoot: join(root, 'out'), starter: snapshottingStarter(seen) })
      await app.handle({
         method: 'PUT',
         url: '/drafts/wf-flush/tuned',
         body: JSON.stringify({ prompt: 'tuned prompt', seed: { mode: '=', value: 99 } }),
      })
      const gen = await app.handle({ method: 'POST', url: '/generate/wf-flush/tuned', body: '{}' })
      expect(gen.status).toBe(200)
      expect(seen[0]?.prompt).toBe('tuned prompt')
      expect(seen[0]?.seed).toEqual({ mode: '=', value: 99 })
   })

   it('/run/<module> reports idle before any run and running state fields after', async () => {
      const mod = makeModule('wf-run-status')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out'), starter: snapshottingStarter([]) })
      const idle = await app.handle({ method: 'GET', url: '/run/wf-run-status' })
      expect(JSON.parse(String(idle.body))).toEqual({
         running: false,
         status: 'idle',
         percent: null,
         // the executing node and its own counter: null while nothing runs
         node: null,
         nodeProgress: null,
         progressText: null,
         hasPreview: false,
         previewSeq: null,
      })
      await app.handle({ method: 'POST', url: '/generate/wf-run-status/default', body: '{}' })
      const after = await app.handle({ method: 'GET', url: '/run/wf-run-status' })
      const afterBody = JSON.parse(String(after.body)) as { running: boolean; status: string }
      expect(afterBody.running).toBe(false)
      expect(afterBody.status).toBe('Success')
      const preview = await app.handle({ method: 'GET', url: '/run/wf-run-status/preview' })
      expect(preview.status).toBe(404)
      const unknown = await app.handle({ method: 'GET', url: '/run/nope' })
      expect(unknown.status).toBe(404)
   })
})

describe('seed continuation vs an edited draft value (live-draft model)', () => {
   it("a NEW draft seed value restarts the +/- continuation — the user's typed seed must win", async () => {
      const mod = makeModule('wf-seed-edit')
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([mod], { outputRoot: join(root, 'out'), starter: snapshottingStarter(seen) })
      await app.handle({
         method: 'PUT',
         url: '/drafts/wf-seed-edit/inc',
         body: JSON.stringify({ seed: { mode: '+', value: 100 } }),
      })
      await app.handle({ method: 'POST', url: '/generate/wf-seed-edit/inc', body: '{}' })
      await app.handle({ method: 'POST', url: '/generate/wf-seed-edit/inc', body: '{}' })
      const seedOf = (ix: number): number => (seen[ix]?.seed as { value: number } | undefined)?.value ?? -1
      expect(seedOf(0)).toBe(100)
      expect(seedOf(1)).toBe(101)
      // the user types 500 into the web form → autosave PUTs the new draft value
      await app.handle({
         method: 'PUT',
         url: '/drafts/wf-seed-edit/inc',
         body: JSON.stringify({ seed: { mode: '+', value: 500 } }),
      })
      await app.handle({ method: 'POST', url: '/generate/wf-seed-edit/inc', body: '{}' })
      expect(seedOf(2)).toBe(500)
      // and the continuation resumes from there
      await app.handle({ method: 'POST', url: '/generate/wf-seed-edit/inc', body: '{}' })
      expect(seedOf(3)).toBe(501)
   })
})

describe('draft name is one gate for every route (traversal)', () => {
   it('%2F in a draft segment must not escape the drafts dir on READ or GENERATE', async () => {
      const mod = makeModule('wf-traversal')
      const seen: Record<string, unknown>[] = []
      const app = new ServeApp([mod], { outputRoot: join(root, 'out'), starter: snapshottingStarter(seen) })
      // a json file two levels above the drafts dir, as if it were someone's config
      const outside = join(draftsDirForFile(mod.file), '..', '..', 'secret.json')
      mkdirSync(dirname(outside), { recursive: true })
      writeFileSync(outside, JSON.stringify({ prompt: 'INJECTED FROM OUTSIDE' }))

      const read = await app.handle({ method: 'GET', url: '/drafts/wf-traversal/..%2F..%2Fsecret' })
      expect(read.status).toBe(404)
      expect(String(read.body)).not.toContain('INJECTED FROM OUTSIDE')

      const generate = await app.handle({ method: 'POST', url: '/generate/wf-traversal/..%2F..%2Fsecret', body: '{}' })
      expect(generate.status).toBe(404)
      expect(seen.length).toBe(0)

      const write = await app.handle({ method: 'PUT', url: '/drafts/wf-traversal/..%2F..%2Fpwned', body: '{}' })
      expect(write.status).toBe(400)
   })
})

describe('ServeApp draft delete (DELETE)', () => {
   it('removes the file, reports the remaining drafts, and the draft stops resolving', async () => {
      const mod = makeModule('wf-del')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      await app.handle({ method: 'PUT', url: '/drafts/wf-del/scratch', body: JSON.stringify({ prompt: 'bye' }) })
      const path = join(draftsDirForFile(mod.file), 'scratch.json')
      expect(existsSync(path)).toBe(true)

      const del = await app.handle({ method: 'DELETE', url: '/drafts/wf-del/scratch' })
      expect(del.status).toBe(200)
      expect(existsSync(path)).toBe(false)
      expect((JSON.parse(String(del.body)) as { drafts: string[] }).drafts).not.toContain('scratch')
      expect((await app.handle({ method: 'GET', url: '/drafts/wf-del/scratch' })).status).toBe(404)
   })

   it("deleting 'default' removes the FILE while the implicit default survives (the reset)", async () => {
      const mod = makeModule('wf-del-default')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      await app.handle({
         method: 'PUT',
         url: '/drafts/wf-del-default/default',
         body: JSON.stringify({ prompt: 'tuned default' }),
      })
      await app.handle({ method: 'DELETE', url: '/drafts/wf-del-default/default' })
      expect(existsSync(join(draftsDirForFile(mod.file), 'default.json'))).toBe(false)
      const after = await app.handle({ method: 'GET', url: '/drafts/wf-del-default/default' })
      expect(after.status).toBe(200)
      // back to the spec value, not the tuned one
      expect((JSON.parse(String(after.body)) as { values: { prompt: string } }).values.prompt).toBe('default prompt')
   })

   it('the name gate applies: a traversal name is 400 and touches nothing', async () => {
      const mod = makeModule('wf-del-gate')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      const outside = join(draftsDirForFile(mod.file), '..', '..', 'keep-me.json')
      mkdirSync(dirname(outside), { recursive: true })
      writeFileSync(outside, '{}')
      const bad = await app.handle({ method: 'DELETE', url: '/drafts/wf-del-gate/..%2F..%2Fkeep-me' })
      expect(bad.status).toBe(400)
      expect(existsSync(outside)).toBe(true)
      expect((await app.handle({ method: 'DELETE', url: '/drafts/ghost/x' })).status).toBe(404)
   })

   it('deleting a draft that has no file still reports ok (the end state is what matters)', async () => {
      const mod = makeModule('wf-del-missing')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      const reply = await app.handle({ method: 'DELETE', url: '/drafts/wf-del-missing/never-existed' })
      expect(reply.status).toBe(200)
   })
})

// an llm graph produces STRING outputs and no images at all, so a reply carrying only
// `images` is an empty reply: the panel drew "no image outputs" and nothing else
describe('text outputs reach the panel', () => {
   it('a run with no images and one text still reports the text', async () => {
      const mod = makeModule('wf-text-out')
      const app = new ServeApp([mod], {
         outputRoot: join(root, 'out'),
         starter: snapshottingStarter([], () => fakeExecution({ texts: ['an expanded prompt'] })),
      })
      const body = parse(await post(app, '/generate/wf-text-out/default', {}))
      expect(body.images).toEqual([])
      expect(body.texts).toEqual([{ nodeKey: 'PreviewAny', text: 'an expanded prompt' }])
   })

   it('a run with neither images nor texts reports both empty, never a missing key', async () => {
      const mod = makeModule('wf-no-out')
      const app = new ServeApp([mod], { outputRoot: join(root, 'out'), starter: snapshottingStarter([]) })
      const body = parse(await post(app, '/generate/wf-no-out/default', {}))
      expect(body.images).toEqual([])
      expect(body.texts).toEqual([])
   })
})
