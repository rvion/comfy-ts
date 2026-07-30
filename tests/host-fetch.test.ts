import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { Server } from 'bun'
import { ComfyHostAuthError } from 'src/host/ComfyHost.ts'
import { fetchLoraPreviewMap } from 'src/host/loraManagerApi.ts'
import { ResilientWebSocketClient } from 'src/host/ResilientWebsocket.ts'
import { ComfyTS } from 'src/state.ts'

// the shape is what matters, never a real key (and never the guarded key shape)
const DUMMY_KEY = 'test-api-key-12345'

// the global registration is process-wide state: isolate each test and restore
// whatever another test file may have registered
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
const servers: Server[] = []
beforeEach(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
})
afterEach(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
   for (const s of servers.splice(0)) s.stop(true)
})

type Seen = { path: string; headers: Record<string, string> }

function serve(handler: (req: Request, seen: Seen[]) => Response | undefined): { port: number; seen: Seen[] } {
   const seen: Seen[] = []
   const server = Bun.serve({
      port: 0,
      fetch(req: Request): Response {
         const url = new URL(req.url)
         const headers: Record<string, string> = {}
         req.headers.forEach((v, k) => {
            headers[k] = v
         })
         seen.push({ path: url.pathname + url.search, headers })
         return handler(req, seen) ?? new Response('not found', { status: 404 })
      },
   })
   servers.push(server)
   return { port: server.port, seen }
}

function freshComfy(): ComfyTS {
   return ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-hostfetch-')) })
}

describe('host.fetch — auth headers', () => {
   test('X-API-Key and extra headers ride every request', async () => {
      const srv = serve((req) => {
         if (new URL(req.url).pathname === '/api/prompt') return Response.json({ ok: true })
         return undefined
      })
      const comfy = freshComfy()
      const host = comfy.host({
         id: 'auth-1',
         url: `http://127.0.0.1:${srv.port}`,
         apiKey: DUMMY_KEY,
         headers: { 'X-Extra': 'modal-style' },
      })
      const res = await host.fetch('/prompt')
      expect(res.ok).toBe(true)
      expect(srv.seen[0]?.headers['x-api-key']).toBe(DUMMY_KEY)
      expect(srv.seen[0]?.headers['x-extra']).toBe('modal-style')
   })

   test('no apiKey configured => no X-API-Key header sent', async () => {
      const srv = serve(() => Response.json({ ok: true }))
      const comfy = freshComfy()
      const host = comfy.host({ id: 'noauth-1', url: `http://127.0.0.1:${srv.port}` })
      await host.fetch('/prompt')
      expect(srv.seen[0]?.headers['x-api-key']).toBeUndefined()
   })

   test('basePath is joined before the /api prefix decision', async () => {
      const srv = serve((req) => {
         if (new URL(req.url).pathname === '/base/api/prompt') return Response.json({ ok: true })
         return undefined
      })
      const comfy = freshComfy()
      const host = comfy.host({ id: 'base-1', url: `http://127.0.0.1:${srv.port}/base` })
      const res = await host.fetch('/prompt')
      expect(res.ok).toBe(true)
      expect(srv.seen.at(-1)?.path).toBe('/base/api/prompt')
   })
})

describe('host.fetch — /api prefix preference and fallback', () => {
   test('prefers /api<route>; old bare-only hosts still answer (fallback + memo)', async () => {
      const srv = serve((req) => {
         const path = new URL(req.url).pathname
         if (path === '/prompt') return Response.json({ ok: true }) // bare-only host
         return undefined
      })
      const comfy = freshComfy()
      const host = comfy.host({ id: 'bare-1', url: `http://127.0.0.1:${srv.port}` })
      const res = await host.fetch('/prompt')
      expect(res.ok).toBe(true)
      expect(srv.seen.map((s) => s.path)).toEqual(['/api/prompt', '/prompt'])
      // memoized: the second call goes straight to the bare spelling
      await host.fetch('/prompt')
      expect(srv.seen.map((s) => s.path)).toEqual(['/api/prompt', '/prompt', '/prompt'])
   })

   test('memoized /api winner still reaches a bare-only route (mixed servers exist)', async () => {
      const srv = serve((req) => {
         const path = new URL(req.url).pathname
         if (path === '/api/object_info') return Response.json({})
         if (path === '/only-bare') return Response.json({ bare: true })
         return undefined
      })
      const comfy = freshComfy()
      const host = comfy.host({ id: 'mixed-1', url: `http://127.0.0.1:${srv.port}` })
      await host.fetch('/object_info') // memoizes the /api spelling
      const res = await host.fetch('/only-bare')
      expect(res.ok).toBe(true)
      expect((await res.json()) as { bare: boolean }).toEqual({ bare: true })
   })

   test('apiPrefix:false hits exactly the bare route, once', async () => {
      const srv = serve((req) => {
         if (new URL(req.url).pathname === '/internal/logs/raw') return Response.json({ entries: [] })
         return undefined
      })
      const comfy = freshComfy()
      const host = comfy.host({ id: 'internal-1', url: `http://127.0.0.1:${srv.port}` })
      const res = await host.fetch('/internal/logs/raw', {}, { apiPrefix: false })
      expect(res.ok).toBe(true)
      expect(srv.seen.map((s) => s.path)).toEqual(['/internal/logs/raw'])
   })
})

describe('host.fetch — typed auth errors', () => {
   test('401 throws ComfyHostAuthError naming the host, never the key', async () => {
      const srv = serve(() => new Response('unauthorized', { status: 401 }))
      const comfy = freshComfy()
      const host = comfy.host({ id: 'denied-1', url: `http://127.0.0.1:${srv.port}`, apiKey: DUMMY_KEY })
      const err = await host.fetch('/user').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ComfyHostAuthError)
      const authErr = err as ComfyHostAuthError
      expect(authErr.code).toBe(401)
      expect(authErr.message).toContain('denied-1')
      expect(authErr.message).not.toContain(DUMMY_KEY)
   })

   test('402 (insufficient credits) and 429 (subscription inactive) are typed too', async () => {
      const srv402 = serve(() => new Response('pay up', { status: 402 }))
      const comfy = freshComfy()
      const h402 = comfy.host({ id: 'broke-1', url: `http://127.0.0.1:${srv402.port}`, apiKey: DUMMY_KEY })
      const e402 = await h402.fetch('/prompt').catch((e: unknown) => e)
      expect(e402).toBeInstanceOf(ComfyHostAuthError)
      expect((e402 as ComfyHostAuthError).code).toBe(402)

      const srv429 = serve(() => new Response('inactive', { status: 429 }))
      const h429 = comfy.host({ id: 'inactive-1', url: `http://127.0.0.1:${srv429.port}`, apiKey: DUMMY_KEY })
      const e429 = await h429.fetch('/prompt').catch((e: unknown) => e)
      expect((e429 as ComfyHostAuthError).code).toBe(429)
   })
})

describe('host.fetchFile — signed-url redirect', () => {
   test('follows the 302 WITHOUT forwarding X-API-Key to the storage host', async () => {
      const srv = serve((req) => {
         const path = new URL(req.url).pathname
         if (path === '/api/view')
            return new Response(null, {
               status: 302,
               headers: { Location: `http://127.0.0.1:${srv.port}/signed/blob` },
            })
         if (path === '/signed/blob') return new Response('IMAGEBYTES')
         return undefined
      })
      const comfy = freshComfy()
      const host = comfy.host({ id: 'view-1', url: `http://127.0.0.1:${srv.port}`, apiKey: DUMMY_KEY })
      const res = await host.fetchFile('/view')
      expect(await res.text()).toBe('IMAGEBYTES')
      const first = srv.seen[0]
      const signed = srv.seen.find((s) => s.path === '/signed/blob')
      expect(first?.headers['x-api-key']).toBe(DUMMY_KEY)
      expect(signed).toBeDefined()
      expect(signed?.headers['x-api-key']).toBeUndefined()
   })
})

describe('cloud degrade — local-only surfaces stay loud but nonfatal', () => {
   test('missing /internal logs reject cleanly and the host keeps serving', async () => {
      const srv = serve((req) => {
         if (new URL(req.url).pathname === '/api/prompt') return Response.json({ ok: true })
         return undefined // everything else 404s, like the cloud
      })
      const comfy = freshComfy()
      const host = comfy.host({ id: 'cloudish-1', url: `http://127.0.0.1:${srv.port}`, apiKey: DUMMY_KEY })
      const err = await host.fetchRawLogs().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('/internal/logs/raw')
      // the failed internal route must not poison the host
      const res = await host.fetch('/prompt')
      expect(res.ok).toBe(true)
   })

   test('absent lora-manager extension => null map, not a throw', async () => {
      const srv = serve((req) => {
         if (new URL(req.url).pathname === '/api/prompt') return Response.json({ ok: true })
         return undefined
      })
      const comfy = freshComfy()
      const host = comfy.host({ id: 'cloudish-2', url: `http://127.0.0.1:${srv.port}`, apiKey: DUMMY_KEY })
      expect(await fetchLoraPreviewMap(host)).toBeNull()
   })
})

describe('ws upgrade auth', () => {
   test('ResilientWebSocketClient sends the headers thunk on the upgrade', async () => {
      let upgradeKey: string | null | undefined
      const server = Bun.serve({
         port: 0,
         fetch(req: Request, srv): Response | undefined {
            upgradeKey = req.headers.get('x-api-key')
            if (srv.upgrade(req)) return undefined
            return new Response('no upgrade', { status: 400 })
         },
         websocket: { message(): void {} },
      })
      servers.push(server)
      const opened = new Promise<void>((res) => {
         const client = new ResilientWebSocketClient({
            url: () => `ws://127.0.0.1:${server.port}/ws`,
            headers: () => ({ 'X-API-Key': DUMMY_KEY }),
            onMessage: () => {},
            onConnectOrReconnect: () => {
               client.disconnectPermanently()
               res()
            },
            onClose: () => {},
         })
      })
      await opened
      expect(upgradeKey).toBe(DUMMY_KEY)
   })
})
