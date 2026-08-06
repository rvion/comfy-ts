// the live-draft contract: what the panel shows IS what the draft file holds.
// The failure this pins: `lastSaved` is committed only when a PUT RESOLVES, so while one is
// in flight the form still believes the disk holds the older value. Editing back to that
// value made save() report "saved" and write nothing, and the in-flight PUT then landed the
// value you had just undone.
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { FormSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { ModuleDescription } from 'src/cli/serve/web/api.ts'

const MOD: ModuleDescription = {
   key: 'wf',
   file: '/x/wf.cflow.ts',
   host: 'h',
   drafts: ['default'],
   vars: { prompt: { kind: 'prompt', payload: '', default: '' } },
}

const ok = (): Response => new Response(JSON.stringify({ ok: true, drafts: ['default'] }), { status: 200 })

// bun runs every test file in ONE process: a stubbed global that is not put back breaks the
// files that run after this one, and the failure surfaces far from here
const realFetch = globalThis.fetch
afterEach(() => {
   globalThis.fetch = realFetch
})
afterAll(() => {
   globalThis.fetch = realFetch
})

/** a fetch stub that holds every PUT open until release(), then stops holding: saves are
 * CHAINED, so a later one is only issued once the earlier resolves */
function heldFetch(): { calls: { body: string }[]; release: () => void } {
   const calls: { body: string }[] = []
   const gates: (() => void)[] = []
   let held = true
   const g = globalThis as { fetch: typeof fetch }
   g.fetch = ((_url: string, init?: { body?: string }) => {
      calls.push({ body: String(init?.body ?? '') })
      if (!held) return Promise.resolve(ok())
      return new Promise<Response>((resolve) => gates.push(() => resolve(ok())))
   }) as typeof fetch

   return {
      calls,
      release: () => {
         held = false
         for (const gate of gates.splice(0)) gate()
      },
   }
}

/** let the save chain's microtasks run */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('draft autosave', () => {
   it('an edit made while a PUT is in flight is still written when it returns to the last CONFIRMED value', async () => {
      const net = heldFetch()
      const form = new FormSt('wf', 'default', MOD, { prompt: 'V1' })

      form.vars[0]?.set('V2')
      const p2 = form.save() // PUT V2, held open by the stub
      await tick() // saves ride a promise chain, so the fetch happens a microtask later
      expect(net.calls).toHaveLength(1)

      // back to V1 — the value the server last CONFIRMED, but NOT the one in flight
      form.vars[0]?.set('V1')
      const p3 = form.save()
      await tick()

      net.release()
      await Promise.all([p2, p3])

      // the LAST write must be V1: without the fix the second save no-oped and the disk kept V2
      const last = net.calls.at(-1)
      expect(last).not.toBeUndefined()
      expect(JSON.parse(String(last?.body)).prompt).toBe('V1')
      expect(form.saveState).toBe('saved')
      form.dispose({ flush: false })
   })

   it('an unchanged form still writes nothing', async () => {
      const net = heldFetch()
      const form = new FormSt('wf', 'default', MOD, { prompt: 'V1' })
      const done = form.save()
      await tick()
      net.release()
      expect(await done).toBe(true)
      expect(net.calls).toHaveLength(0)
      form.dispose({ flush: false })
   })

   it('a FAILED save stays dirty, so the next attempt really re-sends', async () => {
      const g = globalThis as { fetch: typeof fetch }
      let n = 0
      g.fetch = (() => {
         n++
         return Promise.resolve(new Response('nope', { status: 500 }))
      }) as typeof fetch
      const form = new FormSt('wf', 'default', MOD, { prompt: 'V1' })
      form.vars[0]?.set('V2')
      expect(await form.save()).toBe(false)
      expect(form.saveState).toBe('error')
      // same value again: it must NOT be treated as already on disk
      expect(await form.save()).toBe(false)
      expect(n).toBe(2)
      form.dispose({ flush: false })
   })
})
