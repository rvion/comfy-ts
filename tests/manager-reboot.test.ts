// the reboot route is POST from ComfyUI-Manager V3 on (probed against V3.41): a GET there
// answers 404 while the process keeps running, so a caller that treats every failure as the
// expected mid-reboot disconnect reports a reboot that never happened.
import { describe, expect, it } from 'bun:test'
import { ComfyManager } from 'src/host/ComfyManager.ts'

type Call = { route: string; method: string }

// the generation probe answers like the given Manager; `calls` records every other request
function managerOver(
   reply: (c: Call) => Response | Error,
   manager: 'v3' | 'v4' = 'v3',
): { manager: ComfyManager; calls: Call[]; probes: () => number } {
   const calls: Call[] = []
   let probes = 0
   const out = new ComfyManager({
      getServerHostHTTP: () => 'http://host:8188',
      fetch: (route, init) => {
         if (route === '/v2/manager/version' || route === '/manager/version') probes++
         if (route === '/v2/manager/version')
            return Promise.resolve(manager === 'v4' ? new Response('4.4') : new Response('', { status: 404 }))
         if (route === '/manager/version') return Promise.resolve(new Response('V3.42'))
         if (route === '/v2/manager/is_legacy_manager_ui')
            return Promise.resolve(Response.json({ is_legacy_manager_ui: false }))
         const call = { route, method: init?.method ?? 'GET' }
         calls.push(call)
         const r = reply(call)
         return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
      },
   })
   return { manager: out, calls, probes: () => probes }
}

describe('restartComfyUI', () => {
   it('POSTs first, and a dropped connection IS the success shape', async () => {
      const { manager, calls } = managerOver(() => new Error('socket hang up'))
      await manager.restartComfyUI()
      expect(calls).toEqual([{ route: '/manager/reboot', method: 'POST' }])
   })

   it('a 200 is success too (a manager that answers before dying)', async () => {
      const { manager, calls } = managerOver(() => new Response('{}', { status: 200 }))
      await manager.restartComfyUI()
      expect(calls.length).toBe(1)
   })

   it('falls back to GET when POST 404s — an older Manager still reboots', async () => {
      const { manager, calls } = managerOver((c) =>
         c.method === 'POST' ? new Response('', { status: 404 }) : new Error('socket hang up'),
      )
      await manager.restartComfyUI()
      expect(calls.map((c) => c.method)).toEqual(['POST', 'GET'])
   })

   it('THROWS when both verbs 404 — no manager there, and the button must not lie', async () => {
      const { manager, calls } = managerOver(() => new Response('', { status: 404 }))
      await expect(manager.restartComfyUI()).rejects.toThrow(/refused to reboot.*POST → 404.*GET → 404/s)
      expect(calls.map((c) => c.method)).toEqual(['POST', 'GET'])
   })

   it('a non-404 refusal throws at once, without trying the other verb', async () => {
      const { manager, calls } = managerOver(() => new Response('', { status: 403 }))
      await expect(manager.restartComfyUI()).rejects.toThrow(/POST → 403/)
      expect(calls.length).toBe(1)
   })

   it('a 4.x Manager reboots under /v2', async () => {
      const { manager, calls } = managerOver(() => new Error('socket hang up'), 'v4')
      await manager.restartComfyUI()
      expect(calls).toEqual([{ route: '/v2/manager/reboot', method: 'POST' }])
   })

   it('forgets the generation: the process may come back with another Manager', async () => {
      const { manager, probes } = managerOver(() => new Error('socket hang up'))
      await manager.restartComfyUI()
      await manager.restartComfyUI()
      expect(probes()).toBe(4)
   })
})
