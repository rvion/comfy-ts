// a host named by its id alone: `comfy-ts gen` saves the address in .comfy-ts/hosts/<id>/host.json,
// and comfy.host({ id }) reads it back, so shared code never names a machine
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { Server } from 'bun'
import { runGen } from 'src/cli/gen.ts'
import { renderHttpBase } from 'src/host/hostUrl.ts'
import { ComfyTS } from 'src/state.ts'
import { createMemoryStorage } from 'src/storage/ComfyStorage.ts'

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
   return mkdtempSync(join(tmpdir(), 'comfy-ts-hostbyid-'))
}

function saveHostFile(root: string, id: string, body: string): string {
   const dir = join(root, '.comfy-ts', 'hosts', id)
   mkdirSync(dir, { recursive: true })
   const path = join(dir, 'host.json')
   writeFileSync(path, body, 'utf8')
   return path
}

describe('host({ id }) reads the saved address', () => {
   test('the url in host.json becomes the host base', () => {
      const root = freshRoot()
      saveHostFile(root, 'gpu-box', JSON.stringify({ url: 'http://192.168.1.5:8188/comfy' }))
      const host = ComfyTS.create({ rootPath: root }).host({ id: 'gpu-box' })
      expect(host.base).toEqual({ scheme: 'http', host: '192.168.1.5', port: 8188, basePath: '/comfy' })
      expect(host.getServerHostHTTP()).toBe('http://192.168.1.5:8188/comfy')
   })

   test('no host.json: a loud error naming the gen command and the path, never a localhost default', () => {
      const root = freshRoot()
      const comfy = ComfyTS.create({ rootPath: root })
      expect(() => comfy.host({ id: 'nowhere' })).toThrow('comfy-ts gen --host <url> --id nowhere')
      expect(() => comfy.host({ id: 'nowhere' })).toThrow(join(root, '.comfy-ts', 'hosts', 'nowhere', 'host.json'))
      expect(comfy.hosts.has('nowhere')).toBe(false)
   })

   test('a host.json without a url string throws loud', () => {
      const root = freshRoot()
      saveHostFile(root, 'broken', JSON.stringify({ host: 'a', port: 1 }))
      saveHostFile(root, 'garbled', '{ not json')
      const comfy = ComfyTS.create({ rootPath: root })
      expect(() => comfy.host({ id: 'broken' })).toThrow('no "url"')
      expect(() => comfy.host({ id: 'garbled' })).toThrow('not valid json')
   })

   test('no file system (the web entry): the error says to pass the url', () => {
      const comfy = new ComfyTS({ rootPath: '/virtual', storage: createMemoryStorage() })
      expect(() => comfy.host({ id: 'web-only' })).toThrow("host({ id: 'web-only', url: '<url>' })")
   })

   test('an id already registered in the process comes back as is, whatever spelling registered it', () => {
      const root = freshRoot()
      const comfy = ComfyTS.create({ rootPath: root })
      const first = comfy.host({ id: 'live', url: 'http://127.0.0.1:65501' })
      expect(comfy.host({ id: 'live' })).toBe(first)
      expect(() => comfy.host({ id: 'live', apiKey: 'test-api-key-12345' })).toThrow('already registered')
   })

   test('the id alone keeps its literal type, like the other spellings', () => {
      const root = freshRoot()
      saveHostFile(root, 'typed', JSON.stringify({ url: 'http://127.0.0.1:65502' }))
      const host = ComfyTS.create({ rootPath: root }).host({ id: 'typed' })
      const id: 'typed' = host.data.id
      expect(id).toBe('typed')
   })
})

describe('gen saves the address', () => {
   test('host.json holds the normalized url and never the api key; host({ id }) then resolves', async () => {
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
      const root = freshRoot()
      const cwdBefore = process.cwd()
      process.chdir(root)
      try {
         const url = `http://127.0.0.1:${server.port}/`
         const code = await runGen(['--id', 'saved', '--host', url, '--api-key', 'test-api-key-12345'])
         expect(code).toBe(0)
         const path = join(root, '.comfy-ts', 'hosts', 'saved', 'host.json')
         expect(existsSync(path)).toBe(true)
         const text = readFileSync(path, 'utf8')
         expect(JSON.parse(text)).toEqual({ url: `http://127.0.0.1:${server.port}` })
         expect(text).not.toContain('test-api-key')
      } finally {
         process.chdir(cwdBefore)
      }
      Reflect.deleteProperty(globalThis, 'comfyts')
      const host = ComfyTS.create({ rootPath: root }).host({ id: 'saved' })
      expect(renderHttpBase(host.base)).toBe(`http://127.0.0.1:${server.port}`)
   })
})
