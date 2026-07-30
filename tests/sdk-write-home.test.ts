// the cloud sdk single-home invariant (agent/architecture.md "The committed
// cloud SDK catalog"): a host with sdkAutoWrite:false never writes sdk.d.ts,
// and `gen --out` sends the sdk to the explicit home while the json dumps
// still cache under .comfy-ts/hosts/<id>/
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { Server } from 'bun'
import { runGen } from 'src/cli/gen.ts'
import { ComfyTS } from 'src/state.ts'

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

function freshRoot(): string {
   return mkdtempSync(join(tmpdir(), 'comfy-ts-sdkhome-'))
}

function serveSchema(): number {
   const server = Bun.serve({
      port: 0,
      fetch(req: Request): Response {
         const path = new URL(req.url).pathname
         if (path === '/api/object_info') return Response.json({})
         if (path === '/api/embeddings') return Response.json([])
         return new Response('not found', { status: 404 })
      },
   })
   servers.push(server)
   return server.port
}

describe('sdkAutoWrite', () => {
   test('default: loadSchemaFromCache writes the missing sdk.d.ts', async () => {
      const root = freshRoot()
      const comfy = ComfyTS.create({ rootPath: root })
      const hostDir = join(root, '.comfy-ts', 'hosts', 'auto-on')
      mkdirSync(hostDir, { recursive: true })
      writeFileSync(join(hostDir, 'object_info.json'), '{}', 'utf8')
      const host = comfy.host({ id: 'auto-on', url: 'http://127.0.0.1:9' })
      await host.loadSchemaFromCache()
      expect(existsSync(join(hostDir, 'sdk.d.ts'))).toBe(true)
   })

   test('sdkAutoWrite false: no sdk.d.ts ever lands in .comfy-ts/hosts/', async () => {
      const root = freshRoot()
      const comfy = ComfyTS.create({ rootPath: root })
      const hostDir = join(root, '.comfy-ts', 'hosts', 'auto-off')
      mkdirSync(hostDir, { recursive: true })
      writeFileSync(join(hostDir, 'object_info.json'), '{}', 'utf8')
      const host = comfy.host({ id: 'auto-off', url: 'http://127.0.0.1:9', sdkAutoWrite: false })
      await host.loadSchemaFromCache()
      expect(existsSync(join(hostDir, 'sdk.d.ts'))).toBe(false)
   })
})

describe('gen --out', () => {
   test('sdk goes to the explicit home, json dumps still cache under hosts/', async () => {
      const root = freshRoot()
      const port = serveSchema()
      const cwdBefore = process.cwd()
      process.chdir(root)
      try {
         const outPath = join(root, 'examples', 'cloudish', 'sdk.d.ts')
         const code = await runGen(['--id', 'cloudish', '--host', `http://127.0.0.1:${port}`, '--out', outPath])
         expect(code).toBe(0)
         expect(existsSync(outPath)).toBe(true)
         const hostDir = join(root, '.comfy-ts', 'hosts', 'cloudish')
         expect(existsSync(join(hostDir, 'object_info.json'))).toBe(true)
         expect(existsSync(join(hostDir, 'embeddings.json'))).toBe(true)
         expect(existsSync(join(hostDir, 'sdk.d.ts'))).toBe(false)
      } finally {
         process.chdir(cwdBefore)
      }
   })
})
