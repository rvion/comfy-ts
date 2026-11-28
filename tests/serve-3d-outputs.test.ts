// 3D outputs through serve: the run reply and the kept results carry them, an unsaved one is served
// from memory with its mime, a saved one from /outputs/, and the panel's record gets name and size
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { ServeApp, type ServeExecution } from 'src/cli/serve/ServeApp.ts'
import { ComfyTS } from 'src/state.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let root: string
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   root = mkdtempSync(join(tmpdir(), 'comfy-ts-serve-3d-'))
   comfy = ComfyTS.create({ rootPath: root })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])
const PLY = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\n')

function makeApp(key: string, exec: () => ServeExecution): ServeApp {
   const host = comfy.host({ id: 'serve-3d-host', host: '127.0.0.1', port: 65521 })
   const dw = host.defineWorkflow({ id: key, vars: {}, build: () => {} })
   return new ServeApp([{ key, file: `/fake/${key}.cflow.ts`, dw }], {
      outputRoot: join(root, 'out'),
      starter: () => Promise.resolve(exec()),
   })
}

type Model3D = { filename: string; mime: string; format: string; size: number; url: string | null; absPath: string | null }

async function generate(app: ServeApp, key: string): Promise<Record<string, unknown>> {
   const r = await app.handle({ method: 'POST', url: `/generate/${key}/default`, body: '{}' })
   expect(r.status).toBe(200)
   return JSON.parse(String(r.body)) as Record<string, unknown>
}

describe('3D outputs reach the panel', () => {
   it('an unsaved glb is served from /model3d/<promptId>/<ix>, and the kept results list it', async () => {
      const app = makeApp('wf-3d-mem', () => ({
         done: Promise.resolve(null),
         status: 'Success',
         images: [],
         data: { id: 'p-3d' },
         models3d: [
            { absPath: null, filename: 'mesh_00001_.glb', mime: 'model/gltf-binary', format: 'glb', bytes: GLB },
         ],
      }))
      const reply = await generate(app, 'wf-3d-mem')
      const m = (reply.models3d as Model3D[])[0]!
      expect(m).toEqual({
         filename: 'mesh_00001_.glb',
         mime: 'model/gltf-binary',
         format: 'glb',
         size: GLB.byteLength,
         url: '/model3d/p-3d/0',
         absPath: null,
      })
      const fetched = await app.handle({ method: 'GET', url: '/model3d/p-3d/0' })
      expect(fetched.status).toBe(200)
      expect(fetched.contentType).toBe('model/gltf-binary')
      expect(fetched.body).toEqual(GLB)
      const kept = JSON.parse(String((await app.handle({ method: 'GET', url: '/results' })).body)) as {
         runs: { models3d?: Model3D[] }[]
      }
      expect(kept.runs[0]?.models3d?.[0]?.url).toBe('/model3d/p-3d/0')
      expect(kept.runs[0]?.models3d?.[0]?.size).toBe(GLB.byteLength)
   })

   it('a saved splat ply is served from /outputs/ with its mime', async () => {
      const dir = join(root, 'out', 'wf-3d-saved')
      mkdirSync(dir, { recursive: true })
      const abs = join(dir, 'splat_00001_.ply')
      writeFileSync(abs, PLY)
      const app = makeApp('wf-3d-saved', () => ({
         done: Promise.resolve(null),
         status: 'Success',
         images: [],
         data: { id: 'p-3d-saved' },
         models3d: [{ absPath: abs, filename: 'splat_00001_.ply', mime: 'model/x-ply', format: 'ply', bytes: PLY }],
      }))
      const reply = await generate(app, 'wf-3d-saved')
      const m = (reply.models3d as Model3D[])[0]!
      expect(m.url).toBe('/outputs/wf-3d-saved/splat_00001_.ply')
      expect(m.size).toBe(PLY.byteLength)
      const fetched = await app.handle({ method: 'GET', url: m.url ?? '' })
      expect(fetched.status).toBe(200)
      expect(fetched.contentType).toBe('model/x-ply')
   })

   // control: a run with no 3D output carries an empty list, never a missing key
   it('a run without 3D outputs replies models3d: []', async () => {
      const app = makeApp('wf-3d-none', () => ({
         done: Promise.resolve(null),
         status: 'Success',
         images: [],
         data: { id: 'p-3d-none' },
      }))
      const reply = await generate(app, 'wf-3d-none')
      expect(reply.models3d).toEqual([])
   })
})
