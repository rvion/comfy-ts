import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
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
   it('a REFUSED connection answers immediately: nothing is listening, retrying cannot help', async () => {
      // port 1 is privileged and closed, so the TCP connect is refused outright.
      // This must not cost the deadline: the old 2s retry loop made every caller
      // (and, behind serve's mutex, every queued request) wait the full timeout
      const host = comfy.host({ id: 'dead-host', host: '127.0.0.1', port: 1 })
      const t0 = Date.now()
      const err = await host.connect({ timeoutMs: 10_000 }).then(
         () => null,
         (e: unknown) => e,
      )
      const elapsed = Date.now() - t0
      expect(err, 'connect() resolved or hung instead of rejecting').toBeInstanceOf(Error)
      expect((err as Error).name).toBe('ComfyHostUnreachableError')
      expect(String(err)).toContain('dead-host')
      expect(elapsed, `took ${elapsed}ms: it waited out the deadline instead of failing fast`).toBeLessThan(2000)
      host.disconnect()
   })

   it('a server that ACCEPTS but never speaks still gets the full deadline (a busy ComfyUI is not a dead one)', async () => {
      // the distinction the fast path must preserve: a refused socket is definitive,
      // a silent one is just slow, and a single threaded ComfyUI under load stalls
      // new connections without refusing them
      const server = createServer()
      await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
      const addr = server.address()
      if (addr == null || typeof addr === 'string') throw new Error('no port')
      const host = comfy.host({ id: 'silent-host', host: '127.0.0.1', port: addr.port })
      const t0 = Date.now()
      const err = await host.connect({ timeoutMs: 1500 }).then(
         () => null,
         (e: unknown) => e,
      )
      const elapsed = Date.now() - t0
      expect(err).toBeInstanceOf(Error)
      expect(String(err)).toContain('1500')
      expect(elapsed, 'the deadline was not honoured for a silent server').toBeGreaterThan(1200)
      host.disconnect()
      server.close()
   })

   it('a failed connect is RETRYABLE: the next connect() starts fresh, not the stale rejection', async () => {
      const host = comfy.host({ id: 'dead-host-2', host: '127.0.0.1', port: 1 })
      const first = await host.connect({ timeoutMs: 5000 }).catch((e: unknown) => e)
      expect(first).toBeInstanceOf(Error)
      // a host that comes back must be reachable again: the second call must do real
      // work, never replay the first rejection from a cached promise
      const second = await host.connect({ timeoutMs: 5000 }).catch((e: unknown) => e)
      expect(second).toBeInstanceOf(Error)
      expect(second, 'the same Error object came back: the rejection was cached').not.toBe(first)
      host.disconnect()
   })
})
