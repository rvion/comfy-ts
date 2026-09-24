// the host protocol as WIRED in WebSt, not only as parsed: a fake window, a fake storage and a
// fake /drafts api drive the real boot. Two things are pinned here that the pure parsers cannot
// show. (1) the url deep link opens the named draft even when this browser stored another one
// and the workflow list answers late. (2) a host message that lands while the panel is still
// booting is APPLIED once there is a form, never silently dropped (set-prompt was dropped).
// The fake parent records the targetOrigin of every post and throws on one a browser refuses,
// so the origin rules are asserted as sent, not assumed.
import { afterEach, describe, expect, it } from 'bun:test'
import type { ModuleDescription } from 'src/cli/serve/web/api.ts'
import { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const MODULES: ModuleDescription[] = [
   {
      module: 'wf',
      file: '/x/wf.cflow.ts',
      host: 'h',
      drafts: ['default', 'two'],
      vars: {
         prompt: { kind: 'prompt', payload: '', default: '' },
         seed: { kind: 'seed', payload: '', default: { mode: '+', value: 1 } },
         size: { kind: 'size', payload: '', default: { width: 512, height: 512 } },
         mode: { kind: 'choice', payload: '', default: 'a', choices: ['a', 'b'] },
      },
   },
   {
      module: 'other',
      file: '/x/other.cflow.ts',
      host: 'h',
      drafts: ['default'],
      vars: { prompt: { kind: 'prompt', payload: '', default: '' } },
   },
   {
      // no kind:'prompt' var: the name fallback must skip the float and the negative prompt
      module: 'named',
      file: '/x/named.cflow.ts',
      host: 'h',
      drafts: ['default', 'broken'],
      vars: {
         prompt_strength: { kind: 'float', payload: '', default: 0.5 },
         negative_prompt: { kind: 'text', payload: '', default: '' },
         main_prompt: { kind: 'text', payload: '', default: '' },
      },
   },
]

const HOST_ORIGIN = 'http://host.test'
// the real debounces, shrunk: the order of events is what is under test, never the 500ms
const TIMING = { autosaveMs: 5, previewMs: 2 }
const GLOBALS = ['window', 'document', 'localStorage', 'fetch'] as const
const saved = new Map<string, unknown>(GLOBALS.map((k) => [k, Reflect.get(globalThis, k)]))
const live: WebSt[] = []

// bun runs every test file in one process: a stub left on globalThis breaks files that run later
afterEach(() => {
   for (const st of live.splice(0)) st.form?.dispose({ flush: false })
   for (const k of GLOBALS) {
      const v = saved.get(k)
      if (v === undefined) Reflect.deleteProperty(globalThis, k)
      else Reflect.set(globalThis, k, v)
   }
})

type Posted = Record<string, unknown> & { comfyTs: string }
type Post = { msg: Posted; target: string }
type Source = { postMessage: (msg: Posted, target: string) => void }

function json(body: unknown): Response {
   return new Response(JSON.stringify(body), { status: 200 })
}

/** what a browser accepts as a postMessage targetOrigin: '*', '/', or a parseable url.
 * "null" is not one, so an opaque parent origin must never be used as a target */
function assertTargetOrigin(target: string): void {
   if (target === '*' || target === '/') return
   new URL(target)
}

/** a panel inside a frame, with the index held until release() */
function boot(p: { search: string; stored?: Record<string, unknown>; index?: 'ok' | 'empty' | 'fail' }): {
   st: WebSt
   posted: Posted[]
   posts: Post[]
   parent: Source
   send: (data: unknown, o?: { origin?: string; source?: unknown }) => void
   release: () => void
   storage: Map<string, string>
   loc: { search: string }
   puts: { url: string; body: string }[]
} {
   const posts: Post[] = []
   const posted: Posted[] = []
   const listeners: ((e: { data: unknown; origin: string; source: unknown }) => void)[] = []
   const storage = new Map<string, string>()
   if (p.stored != null) storage.set('comfy-ts-serve-ui', JSON.stringify(p.stored))
   const loc = { search: p.search, pathname: '/', hash: '' }
   let releaseIndex = (): void => {}
   const indexGate = new Promise<void>((r) => (releaseIndex = r))
   const puts: { url: string; body: string }[] = []
   const drafts: Record<string, Record<string, unknown>> = {
      'wf/default': { prompt: 'default prompt', seed: { mode: '+', value: 1 } },
      'wf/two': { prompt: 'second', seed: { mode: '=', value: 7 }, mode: 'b' },
      'other/default': { prompt: 'other' },
      'named/default': {},
   }
   const parent: Source = {
      postMessage: (msg: Posted, target: string): void => {
         assertTargetOrigin(target)
         posts.push({ msg, target })
         posted.push(msg)
      },
   }
   Object.assign(globalThis, {
      window: {
         parent,
         location: loc,
         history: {
            replaceState: (_s: unknown, _t: string, url: string): void => {
               loc.search = new URL(url, 'http://panel.test').search
            },
         },
         matchMedia: () => ({ matches: false }),
         addEventListener: (
            type: string,
            fn: (e: { data: unknown; origin: string; source: unknown }) => void,
         ): void => {
            if (type === 'message') listeners.push(fn)
         },
      },
      document: { addEventListener: (): void => {}, visibilityState: 'visible' },
      localStorage: {
         getItem: (k: string): string | null => storage.get(k) ?? null,
         setItem: (k: string, v: string): void => void storage.set(k, v),
      },
      fetch: async (url: string, init?: { method?: string; body?: string }): Promise<Response> => {
         if (init?.method === 'PUT') {
            puts.push({ url, body: String(init.body ?? '') })
            return json({ ok: true, drafts: ['default', 'two'] })
         }
         if (url === '/drafts') {
            await indexGate
            if (p.index === 'fail') return new Response('{"error":"index exploded"}', { status: 500 })
            return json({ workflows: p.index === 'empty' ? [] : MODULES })
         }
         if (url.startsWith('/drafts/')) {
            const key = url.slice('/drafts/'.length).split('/').map(decodeURIComponent).join('/')
            if (key === 'named/broken') return new Response('{"error":"draft unreadable"}', { status: 500 })
            return json({ values: drafts[key] ?? {} })
         }
         if (url === '/hosts') return json({ hosts: [], defaults: {}, overrides: {} })
         if (url === '/settings')
            return json({ saveToDisk: true, hostOverride: {}, savePrefix: {}, effectivePrefix: {} })
         return new Response('{"error":"nope"}', { status: 404 })
      },
   })
   const st = new WebSt(TIMING)
   live.push(st)
   return {
      st,
      posted,
      posts,
      parent,
      send: (data, o = {}): void => {
         for (const fn of listeners) fn({ data, origin: o.origin ?? HOST_ORIGIN, source: o.source ?? parent })
      },
      release: releaseIndex,
      storage,
      loc,
      puts,
   }
}

async function until(what: string, pred: () => boolean): Promise<void> {
   const deadline = Date.now() + 2000
   while (!pred()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`)
      await new Promise((r) => setTimeout(r, 0))
   }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
const valueOf = (st: WebSt, name: string): unknown => st.form?.vars.find((v) => v.name === name)?.value
const last = (posted: Posted[], kind: string): Posted | undefined => posted.filter((m) => m.comfyTs === kind).at(-1)

describe('the url deep link in a fresh frame', () => {
   it('opens the named draft over a stored OTHER workflow, when the list answers late', async () => {
      const t = boot({ search: '?workflow=wf&draft=two', stored: { module: 'other', draft: 'default' } })
      await tick()
      // nothing may open from the stored selection while the list is still out
      expect(t.st.form).toBeNull()
      expect(t.posted.filter((m) => m.comfyTs === 'selection')).toHaveLength(0)
      t.release()
      await until('ready', () => last(t.posted, 'ready') != null)
      expect([t.st.form?.moduleKey, t.st.form?.draft]).toEqual(['wf', 'two'])
      expect(valueOf(t.st, 'prompt')).toBe('second')
      expect(t.posted.filter((m) => m.comfyTs === 'selection')).toEqual([
         { comfyTs: 'selection', module: 'wf', draft: 'two' },
      ])
      expect(new URLSearchParams(t.loc.search).get('draft')).toBe('two')
      expect(JSON.parse(t.storage.get('comfy-ts-serve-ui') ?? '{}')).toMatchObject({ module: 'wf', draft: 'two' })
   })

   it('opens the named draft over a stored other draft of the SAME workflow', async () => {
      const t = boot({ search: '?workflow=wf&draft=two', stored: { module: 'wf', draft: 'default' } })
      t.release()
      await until('ready', () => last(t.posted, 'ready') != null)
      expect([t.st.form?.moduleKey, t.st.form?.draft]).toEqual(['wf', 'two'])
   })
})

describe('a host message during the boot', () => {
   it('set-prompt sent before the form exists is applied once it does', async () => {
      const t = boot({ search: '?workflow=wf&draft=default' })
      await tick()
      t.send({ comfyTs: 'set-prompt', text: 'a fox in the snow' })
      t.release()
      await until('ready', () => last(t.posted, 'ready') != null)
      await until('prompt applied', () => valueOf(t.st, 'prompt') === 'a fox in the snow')
   })

   it('set-selection sent before the list loaded wins over the url', async () => {
      const t = boot({ search: '?workflow=wf&draft=default' })
      await tick()
      t.send({ comfyTs: 'set-selection', module: 'wf', draft: 'two' })
      t.release()
      await until('switched', () => t.st.form?.draft === 'two')
      expect(t.st.form?.moduleKey).toBe('wf')
   })
})

/** the replies to host requests: `state` or `error` carrying `request` */
const replies = (posted: Posted[]): Posted[] =>
   posted.filter((m) => (m.comfyTs === 'state' || m.comfyTs === 'error') && m.request != null)

/** long enough for the autosave debounce to have fired, so a late extra reply shows */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, TIMING.autosaveMs * 3))

async function ready(search = '?workflow=wf&draft=default'): Promise<ReturnType<typeof boot>> {
   const t = boot({ search })
   t.release()
   await until('ready', () => last(t.posted, 'ready') != null)
   return t
}

/** a host that has spoken once: the origin is pinned, and the mark is where its replies start */
async function pinned(search?: string): Promise<ReturnType<typeof boot> & { mark: number }> {
   const t = await ready(search)
   t.send({ comfyTs: 'get-state' })
   await until('pinning reply', () => last(t.posted, 'state') != null)
   return { ...t, mark: t.posted.length }
}

describe('procedural control once booted', () => {
   it('set-selection switches, says so with selection, and answers with exactly one state', async () => {
      const t = await pinned()
      t.send({ comfyTs: 'set-selection', module: 'wf', draft: 'two' })
      await until('state for two', () => last(t.posted, 'state')?.draft === 'two')
      await settle()
      expect(t.st.form?.draft).toBe('two')
      const after = t.posted.slice(t.mark)
      expect(after.filter((m) => m.comfyTs === 'selection')).toEqual([
         { comfyTs: 'selection', module: 'wf', draft: 'two' },
      ])
      expect(replies(after)).toHaveLength(1)
      expect(after.filter((m) => m.comfyTs === 'state')).toHaveLength(1)
      expect(last(t.posted, 'state')).toMatchObject({
         request: 'set-selection',
         module: 'wf',
         draft: 'two',
         values: { prompt: 'second', seed: { mode: '=', value: 7 }, mode: 'b' },
      })
   })

   it('an unknown draft opens that workflow at default', async () => {
      const t = await ready('?workflow=other&draft=default')
      t.send({ comfyTs: 'set-selection', module: 'wf', draft: 'nope' })
      await until('switched', () => t.st.form?.moduleKey === 'wf')
      expect(t.st.form?.draft).toBe('default')
   })

   it('an unknown module changes nothing and answers with an error', async () => {
      const t = await pinned()
      t.send({ comfyTs: 'set-selection', module: 'nope', draft: 'two' })
      await until('an answer', () => replies(t.posted.slice(t.mark)).length > 0)
      await settle()
      expect([t.st.form?.moduleKey, t.st.form?.draft]).toEqual(['wf', 'default'])
      expect(replies(t.posted.slice(t.mark))).toEqual([
         { comfyTs: 'error', code: 'unknown-module', message: expect.any(String), request: 'set-selection' },
      ])
   })

   it('re-selecting the open draft still answers, once, so a host waiting on it is not left hanging', async () => {
      const t = await pinned()
      t.send({ comfyTs: 'set-selection', module: 'wf', draft: 'default' })
      await until('an answer', () => replies(t.posted.slice(t.mark)).length > 0)
      await settle()
      expect(replies(t.posted.slice(t.mark))).toEqual([
         expect.objectContaining({ comfyTs: 'state', request: 'set-selection', module: 'wf', draft: 'default' }),
      ])
   })

   it('set-values validates each value, lists what it refused, and answers once', async () => {
      const t = await pinned()
      t.send({
         comfyTs: 'set-values',
         values: { prompt: 'a red fox', seed: 99, size: '768x1344', mode: 'not-a-choice', ghost: 1 },
      })
      await until('state after values', () => replies(t.posted.slice(t.mark)).length > 0)
      expect(valueOf(t.st, 'prompt')).toBe('a red fox')
      expect(valueOf(t.st, 'seed')).toEqual({ mode: '+', value: 99 })
      expect(valueOf(t.st, 'size')).toEqual({ width: 768, height: 1344 })
      expect(valueOf(t.st, 'mode')).toBe('a')
      const reply = last(t.posted, 'state')
      expect(reply).toMatchObject({ request: 'set-values', rejected: ['mode', 'ghost'] })
      expect(reply?.values).not.toHaveProperty('ghost')
      // the autosave writes it like a typed edit, and the host already has these values
      await until('autosave', () => t.puts.some((x) => x.body.includes('a red fox')))
      await settle()
      expect(t.posted.slice(t.mark).filter((m) => m.comfyTs === 'state')).toHaveLength(1)
   })

   it('a value that JSON cannot print is refused without losing the reply', async () => {
      const t = await pinned()
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      t.send({ comfyTs: 'set-values', values: { mode: 10n, size: cyclic, prompt: 'still here' } })
      await until('a reply', () => replies(t.posted.slice(t.mark)).length > 0)
      expect(last(t.posted, 'state')).toMatchObject({ request: 'set-values', rejected: ['mode', 'size'] })
      expect(valueOf(t.st, 'prompt')).toBe('still here')
   })

   it('set-selection then set-values back to back: the values land on the NEW draft', async () => {
      const t = await ready()
      t.send({ comfyTs: 'set-selection', module: 'wf', draft: 'two' })
      t.send({ comfyTs: 'set-values', values: { prompt: 'for two' } })
      await until('values on two', () => t.st.form?.draft === 'two' && valueOf(t.st, 'prompt') === 'for two')
   })

   it('get-state answers with the current values', async () => {
      const t = await ready()
      t.send({ comfyTs: 'get-state' })
      await until('state', () => last(t.posted, 'state') != null)
      expect(last(t.posted, 'state')).toEqual({
         comfyTs: 'state',
         request: 'get-state',
         module: 'wf',
         draft: 'default',
         values: {
            prompt: 'default prompt',
            seed: { mode: '+', value: 1 },
            size: { width: 512, height: 512 },
            mode: 'a',
         },
      })
   })

   it('a user switching drafts in the panel is mirrored to a host that has spoken', async () => {
      const t = await pinned()
      await t.st.select({ module: 'other', draft: 'default' })
      expect(last(t.posted, 'selection')).toEqual({ comfyTs: 'selection', module: 'other', draft: 'default' })
      expect(last(t.posted, 'state')).toEqual({
         comfyTs: 'state',
         module: 'other',
         draft: 'default',
         values: { prompt: 'other' },
      })
   })

   it('a message from a second origin is ignored once the parent has pinned its own', async () => {
      const t = await pinned()
      t.send({ comfyTs: 'set-selection', module: 'wf', draft: 'two' }, { origin: 'http://evil.test' })
      t.send({ comfyTs: 'set-values', values: { prompt: 'injected' } }, { origin: 'http://evil.test' })
      await settle()
      expect([t.st.form?.draft, valueOf(t.st, 'prompt')]).toEqual(['default', 'default prompt'])
      expect(t.posted.length).toBe(t.mark)
   })
})

describe('who may speak for the host', () => {
   it('a frame that is not the parent, speaking FIRST, is ignored and does not pin; the parent then works', async () => {
      const t = await ready()
      const sibling: Source = { postMessage: (): void => {} }
      t.send(
         { comfyTs: 'set-values', values: { prompt: 'from a sibling' } },
         { origin: 'http://evil.test', source: sibling },
      )
      t.send({ comfyTs: 'get-state' }, { origin: 'http://evil.test', source: sibling })
      await settle()
      expect(valueOf(t.st, 'prompt')).toBe('default prompt')
      expect(replies(t.posted)).toHaveLength(0)
      t.send({ comfyTs: 'get-state' })
      await until('the parent is answered', () => replies(t.posted).length > 0)
      expect(t.posts.at(-1)).toEqual({ msg: expect.objectContaining({ comfyTs: 'state' }), target: HOST_ORIGIN })
   })

   it('before the host speaks, only ready and selection go out, to *; after, replies go to the pinned origin', async () => {
      const t = await ready()
      // a user edit and a user switch before any host message: neither may leak values
      t.st.form?.vars.find((v) => v.name === 'prompt')?.set('typed before the pin')
      await t.st.select({ module: 'other', draft: 'default' })
      await settle()
      const before = t.posts.slice()
      expect(before.length).toBeGreaterThan(0)
      expect(before.every((x) => x.target === '*')).toBe(true)
      expect(before.map((x) => x.msg.comfyTs).every((k) => k === 'ready' || k === 'selection')).toBe(true)
      t.send({ comfyTs: 'get-state' })
      await until('reply', () => replies(t.posted).length > 0)
      const after = t.posts.slice(before.length)
      expect(after.length).toBeGreaterThan(0)
      expect(after.every((x) => x.target === HOST_ORIGIN)).toBe(true)
   })

   it('an opaque parent origin ("null") still gets its replies', async () => {
      const t = await ready()
      t.send({ comfyTs: 'get-state' }, { origin: 'null' })
      await until('reply', () => replies(t.posted).length > 0)
      expect(t.posts.at(-1)).toEqual({ msg: expect.objectContaining({ comfyTs: 'state' }), target: '*' })
   })
})

describe('every request gets exactly one answer', () => {
   it('with no form (the draft could not be read), each request answers with an error', async () => {
      const t = await pinned()
      t.send({ comfyTs: 'set-selection', module: 'named', draft: 'broken' })
      await until('select reply', () => replies(t.posted.slice(t.mark)).length > 0)
      expect(t.st.form).toBeNull()
      expect(replies(t.posted.slice(t.mark))).toEqual([
         { comfyTs: 'error', code: 'select-failed', message: expect.any(String), request: 'set-selection' },
      ])
      t.send({ comfyTs: 'set-values', values: { main_prompt: 'x' } })
      t.send({ comfyTs: 'get-state' })
      await until('two more replies', () => replies(t.posted.slice(t.mark)).length === 3)
      await settle()
      expect(replies(t.posted.slice(t.mark)).slice(1)).toEqual([
         { comfyTs: 'error', code: 'no-form', message: expect.any(String), request: 'set-values' },
         { comfyTs: 'error', code: 'no-form', message: expect.any(String), request: 'get-state' },
      ])
   })

   it('a request landing mid-switch waits for the switch and answers with the new form', async () => {
      const t = await pinned()
      // a user click: the form goes null synchronously while the next draft loads
      const switching = t.st.select({ module: 'other', draft: 'default' })
      expect(t.st.form).toBeNull()
      t.send({ comfyTs: 'get-state' })
      await switching
      await until('reply', () => replies(t.posted.slice(t.mark)).length > 0)
      await settle()
      expect(replies(t.posted.slice(t.mark))).toEqual([
         { comfyTs: 'state', request: 'get-state', module: 'other', draft: 'default', values: { prompt: 'other' } },
      ])
   })
})

describe('a boot that cannot finish says so', () => {
   it('an index that fails posts error boot, and no ready', async () => {
      const t = boot({ search: '', index: 'fail' })
      t.release()
      await until('boot error', () => last(t.posted, 'error') != null)
      expect(last(t.posted, 'error')).toEqual({ comfyTs: 'error', code: 'boot', message: expect.any(String) })
      expect(t.posts.at(-1)?.target).toBe('*')
      expect(last(t.posted, 'ready')).toBeUndefined()
   })

   it('zero workflows served posts error boot, and no ready', async () => {
      const t = boot({ search: '', index: 'empty' })
      t.release()
      await until('boot error', () => last(t.posted, 'error') != null)
      expect(last(t.posted, 'error')).toMatchObject({ code: 'boot' })
      expect(last(t.posted, 'ready')).toBeUndefined()
   })
})

describe('set-prompt picks a real prompt var', () => {
   it('without a kind prompt var, a float or a negative prompt named like one is left alone', async () => {
      const t = await ready('?workflow=named&draft=default')
      t.send({ comfyTs: 'set-prompt', text: 'a fox' })
      await until('prompt set', () => valueOf(t.st, 'main_prompt') === 'a fox')
      expect(valueOf(t.st, 'prompt_strength')).toBe(0.5)
      expect(valueOf(t.st, 'negative_prompt')).toBe('')
   })
})

describe('the host can mirror the form without polling', () => {
   it('a user edit posts state once, after the autosave debounce', async () => {
      const t = await pinned()
      const prompt = t.st.form?.vars.find((v) => v.name === 'prompt')
      prompt?.set('t')
      prompt?.set('ty')
      prompt?.set('typed')
      expect(t.posted.length).toBe(t.mark)
      await until('mirrored', () => {
         const values = last(t.posted, 'state')?.values as Record<string, unknown> | undefined
         return values?.prompt === 'typed'
      })
      await settle()
      const states = t.posted.slice(t.mark).filter((m) => m.comfyTs === 'state')
      expect(states).toHaveLength(1)
      expect(states[0]).not.toHaveProperty('request')
   })

   it('seeds a finished run wrote back are mirrored', async () => {
      const t = await pinned()
      t.st.run.onSeeds?.({ module: 'wf', draft: 'default', seeds: { seed: 1234 } })
      await until('mirrored seed', () => {
         const values = last(t.posted, 'state')?.values as Record<string, unknown> | undefined
         return (values?.seed as { value?: number } | undefined)?.value === 1234
      })
   })
})
