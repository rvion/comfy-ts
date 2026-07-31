import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { ComfyTS } from 'src/state.ts'

// Found while verifying the 2.2.0 serve fix: a `POST /generate` against an
// UNREACHABLE host never answered. `connect()` awaits a ws that ResilientWebsocket
// retries every 2s forever, and a refused TCP connection is a close, not a dead
// transport, so `markFailed` never ran and the promise never settled. In serve the
// per-module mutex then queued every later request behind the hung one, so one dead
// host wedged the whole module. A library that hangs forever with no error violates
// "never fail silently" for scripts too, not just for serve.

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-timeout-')) })
})

afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

describe('connect() against an unreachable host fails loud instead of hanging', () => {
   it('rejects within the deadline, naming the host and the url', async () => {
      // port 1 is privileged and closed: the TCP connect is refused immediately
      const host = comfy.host({ id: 'dead-host', host: '127.0.0.1', port: 1 })
      const t0 = Date.now()
      const err = await host.connect({ timeoutMs: 1500 }).then(
         () => null,
         (e: unknown) => e,
      )
      const elapsed = Date.now() - t0
      expect(err, 'connect() resolved or hung instead of rejecting').toBeInstanceOf(Error)
      expect(String(err)).toContain('dead-host')
      expect(String(err)).toContain('1500')
      // the deadline is the point: it must not sit in the 2s reconnect loop forever
      expect(elapsed).toBeLessThan(6000)
      host.disconnect()
   })

   it('a failed connect is RETRYABLE: the next connect() starts fresh, not the stale rejection', async () => {
      const host = comfy.host({ id: 'dead-host-2', host: '127.0.0.1', port: 1 })
      const first = await host.connect({ timeoutMs: 1200 }).catch((e: unknown) => e)
      expect(first).toBeInstanceOf(Error)
      // a host that comes back must be reachable again: the second call must do real
      // work (and take real time), never return the first rejection instantly
      const t0 = Date.now()
      const second = await host.connect({ timeoutMs: 1200 }).catch((e: unknown) => e)
      expect(second).toBeInstanceOf(Error)
      expect(Date.now() - t0, 'second connect() returned the cached rejection').toBeGreaterThan(500)
      host.disconnect()
   })
})
