// a new lora on the host reaches the open form by itself: no button, no tab reload. The drift
// check notices the host changed, refreshes it (schema + lora list), and the panel re-reads its
// workflow descriptions so the loras var offers the new file
import { afterEach, describe, expect, it } from 'bun:test'
import type { ModuleDescription } from 'src/cli/serve/web/api.ts'
import { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const GLOBALS = ['window', 'document', 'localStorage', 'fetch'] as const
const saved = new Map<string, unknown>(GLOBALS.map((k) => [k, Reflect.get(globalThis, k)]))
const live: WebSt[] = []
afterEach(() => {
   for (const st of live.splice(0)) st.form?.dispose({ flush: false })
   for (const k of GLOBALS) {
      const v = saved.get(k)
      if (v === undefined) Reflect.deleteProperty(globalThis, k)
      else Reflect.set(globalThis, k, v)
   }
})

const moduleWith = (loras: string[]): ModuleDescription => ({
   module: 'wf',
   file: '/x/wf.cflow.ts',
   host: 'h',
   drafts: ['default'],
   vars: { loras: { kind: 'loras', payload: '', default: {}, options: loras } },
})

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })

async function until(what: string, pred: () => boolean): Promise<void> {
   const deadline = Date.now() + 2000
   while (!pred()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`)
      await new Promise((r) => setTimeout(r, 5))
   }
}

describe('a lora added on the host shows up by itself', () => {
   it('drift seen → the host is refreshed and the open form offers the new lora', async () => {
      // why we think it is actually a bug, and not just meaning spec should change: a new lora
      // only reached the form after a manual tab reload, even after pressing the refetch button,
      // because the refresh never re-read the workflow descriptions the form is built from
      let hostLoras = ['a.safetensors']
      const calls: string[] = []
      Object.assign(globalThis, {
         window: {
            parent: null,
            location: { search: '', pathname: '/', hash: '' },
            history: { replaceState: (): void => {} },
            matchMedia: () => ({ matches: false }),
            addEventListener: (): void => {},
         },
         document: { addEventListener: (): void => {}, visibilityState: 'visible' },
         localStorage: { getItem: (): string | null => null, setItem: (): void => {} },
         fetch: async (url: string, init?: { method?: string }): Promise<Response> => {
            calls.push(`${init?.method ?? 'GET'} ${url}`)
            if (url === '/drafts') return json({ workflows: [moduleWith(hostLoras)] })
            if (url.startsWith('/drafts/')) return json({ values: {} })
            if (url === '/hosts') return json({ hosts: [{ id: 'h' }], defaults: { wf: 'h' }, overrides: {} })
            if (url === '/settings')
               return json({ saveToDisk: true, hostOverride: {}, savePrefix: {}, effectivePrefix: {} })
            if (url.startsWith('/hosts/h/drift'))
               return json({
                  host: 'h',
                  checked: true,
                  changed: hostLoras.length > 1 && calls.every((c) => !c.includes('refresh-schema')),
                  summary: '+1 lora',
               })
            if (url === '/hosts/h/refresh-schema') return json({ ok: true, note: 'refetched' })
            return new Response('{"error":"nope"}', { status: 404 })
         },
      })
      const st = new WebSt()
      live.push(st)
      await until('the form', () => st.form != null)
      const optionsNow = (): readonly string[] => st.form?.vars.find((v) => v.name === 'loras')?.desc.options ?? []
      expect(optionsNow()).toEqual(['a.safetensors'])
      hostLoras = ['a.safetensors', 'b.safetensors']
      await st.checkDrift(false)
      await until('the new lora in the form', () => optionsNow().includes('b.safetensors'))
      expect(calls).toContain('POST /hosts/h/refresh-schema')
   })
})
