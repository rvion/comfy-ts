// the reboot route is POST from ComfyUI-Manager V3 on (probed against V3.41): a GET there
// answers 404 while the process keeps running, so a caller that treats every failure as the
// expected mid-reboot disconnect reports a reboot that never happened.
import { describe, expect, it } from 'bun:test'
import { ComfyManager } from 'src/host/ComfyManager.ts'

type Call = { route: string; method: string }

function managerOver(reply: (c: Call) => Response | Error): { manager: ComfyManager; calls: Call[] } {
   const calls: Call[] = []
   const manager = new ComfyManager({
      getServerHostHTTP: () => 'http://host:8188',
      fetch: (route, init) => {
         const call = { route, method: init?.method ?? 'GET' }
         calls.push(call)
         const out = reply(call)
         return out instanceof Error ? Promise.reject(out) : Promise.resolve(out)
      },
   })
   return { manager, calls }
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
})
