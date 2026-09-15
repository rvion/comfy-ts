// the host protocol as WIRED in WebSt, not only as parsed: a fake window, a fake storage and a
// fake /drafts api drive the real boot. Two things are pinned here that the pure parsers cannot
// show. (1) the url deep link opens the named draft even when this browser stored another one
// and the workflow list answers late. (2) a host message that lands while the panel is still
// booting is APPLIED once there is a form, never silently dropped (set-prompt was dropped).
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
]

const HOST_ORIGIN = 'http://host.test'
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

function json(body: unknown): Response {
   return new Response(JSON.stringify(body), { status: 200 })
}

/** a panel inside a frame, with the index held until release() */
function boot(p: { search: string; stored?: Record<string, unknown> }): {
   st: WebSt
   posted: Posted[]
   send: (data: unknown, origin?: string) => void
   release: () => void
   storage: Map<string, string>
   loc: { search: string }
   puts: { url: string; body: string }[]
} {
   const posted: Posted[] = []
   const listeners: ((e: { data: unknown; origin: string }) => void)[] = []
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
   }
   Object.assign(globalThis, {
      window: {
         parent: { postMessage: (msg: Posted): void => void posted.push(msg) },
         location: loc,
         history: {
            replaceState: (_s: unknown, _t: string, url: string): void => {
               loc.search = new URL(url, 'http://panel.test').search
            },
         },
         matchMedia: () => ({ matches: false }),
         addEventListener: (type: string, fn: (e: { data: unknown; origin: string }) => void): void => {
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
            return json({ workflows: MODULES })
         }
         if (url.startsWith('/drafts/')) {
            const key = url.slice('/drafts/'.length).split('/').map(decodeURIComponent).join('/')
            return json({ values: drafts[key] ?? {} })
         }
         if (url === '/hosts') return json({ hosts: [], defaults: {}, overrides: {} })
         if (url === '/settings')
            return json({ saveToDisk: true, hostOverride: {}, savePrefix: {}, effectivePrefix: {} })
         return new Response('{"error":"nope"}', { status: 404 })
      },
   })
   const st = new WebSt()
   live.push(st)
   return {
      st,
      posted,
      send: (data, origin = HOST_ORIGIN): void => {
         for (const fn of listeners) fn({ data, origin })
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
      await new Promise((r) => setTimeout(r, 5))
   }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20))
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

describe('procedural control once booted', () => {
   async function ready(search = '?workflow=wf&draft=default'): Promise<ReturnType<typeof boot>> {
      const t = boot({ search })
      t.release()
      await until('ready', () => last(t.posted, 'ready') != null)
      return t
   }

   it('set-selection switches, then says so with selection AND state', async () => {
      const t = await ready()
      t.send({ comfyTs: 'set-selection', module: 'wf', draft: 'two' })
      await until('state for two', () => last(t.posted, 'state')?.draft === 'two')
      expect(t.st.form?.draft).toBe('two')
      expect(last(t.posted, 'selection')).toEqual({ comfyTs: 'selection', module: 'wf', draft: 'two' })
      expect(last(t.posted, 'state')).toMatchObject({
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

   it('an unknown module changes nothing and answers with the current selection', async () => {
      const t = await ready()
      const before = t.posted.length
      t.send({ comfyTs: 'set-selection', module: 'nope', draft: 'two' })
      await until('an answer', () => t.posted.length > before)
      expect([t.st.form?.moduleKey, t.st.form?.draft]).toEqual(['wf', 'default'])
      expect(t.posted.slice(before)).toContainEqual({ comfyTs: 'selection', module: 'wf', draft: 'default' })
   })

   it('re-selecting the open draft still answers, so a host waiting on it is not left hanging', async () => {
      const t = await ready()
      const before = t.posted.length
      t.send({ comfyTs: 'set-selection', module: 'wf', draft: 'default' })
      await until('an answer', () => t.posted.slice(before).some((m) => m.comfyTs === 'selection'))
   })

   it('set-values validates each value, ignores unknown names, and reports the result', async () => {
      const t = await ready()
      t.send({
         comfyTs: 'set-values',
         values: { prompt: 'a red fox', seed: 99, size: '768x1344', mode: 'not-a-choice', ghost: 1 },
      })
      await until('state after values', () => last(t.posted, 'state') != null)
      expect(valueOf(t.st, 'prompt')).toBe('a red fox')
      expect(valueOf(t.st, 'seed')).toEqual({ mode: '+', value: 99 })
      expect(valueOf(t.st, 'size')).toEqual({ width: 768, height: 1344 })
      expect(valueOf(t.st, 'mode')).toBe('a')
      expect(last(t.posted, 'state')?.values).not.toHaveProperty('ghost')
      // the autosave writes it like a typed edit
      await until('autosave', () => t.puts.some((x) => x.body.includes('a red fox')))
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

   it('a user switching drafts in the panel is mirrored to the host', async () => {
      const t = await ready()
      await t.st.select({ module: 'other', draft: 'default' })
      expect(last(t.posted, 'selection')).toEqual({ comfyTs: 'selection', module: 'other', draft: 'default' })
      expect(last(t.posted, 'state')).toMatchObject({ module: 'other', draft: 'default', values: { prompt: 'other' } })
   })

   it('a message from a second origin is ignored once the host has spoken', async () => {
      const t = await ready()
      t.send({ comfyTs: 'get-state' })
      await until('state', () => last(t.posted, 'state') != null)
      t.send({ comfyTs: 'set-selection', module: 'wf', draft: 'two' }, 'http://evil.test')
      t.send({ comfyTs: 'set-values', values: { prompt: 'injected' } }, 'http://evil.test')
      await tick()
      expect([t.st.form?.draft, valueOf(t.st, 'prompt')]).toEqual(['default', 'default prompt'])
   })
})
