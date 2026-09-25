import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { ServeApp } from 'src/cli/serve/ServeApp.ts'
import { MediaImage } from 'src/runner/MediaImage.ts'
import { ComfyTS } from 'src/state.ts'
import { asAbsolutePath } from 'src/types/index.ts'
import { v } from 'src/vars/ComfyVars.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-index-tags-')) })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

describe('index tags', () => {
   it('the index carries tags read from a dry build, and the dry build uploads nothing', async () => {
      const host = comfy.host({ id: 'tags-host', host: '127.0.0.1', port: 65502 })
      host.schema.update({ spec: JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8')), embeddings: [] })
      let uploads = 0
      host.uploader.uploadImage = () => {
         uploads++
         return Promise.reject(new Error('a dry build must not upload'))
      }
      const image = v.image(join(import.meta.dir, '..', 'examples', 'images', 'bear_1024x1024.jpg'))
      const dw = host.defineWorkflow({
         id: 'edit',
         tags: ['Bears'],
         vars: { image },
         build: async (b, _vars, wf) => {
            const loaded = await new MediaImage({
               path: asAbsolutePath(image.absPath()),
            }).loadInWorkflow_viaLoadImageNode(wf)
            b.PreviewImage({ images: loaded })
         },
      })
      const app = new ServeApp([{ key: 'edit', file: '/fake/edit.cflow.ts', dw }], {
         starter: () => Promise.reject(new Error('never runs here')),
      })
      const reply = await app.handle({ method: 'GET', url: '/' })
      const body = JSON.parse(String(reply.body)) as { workflows: { tags: string[] }[] }
      expect(body.workflows[0]?.tags).toEqual(['image', 'edit', 'bears'])
      expect(uploads).toBe(0)
      expect(dw.lastWorkflow).toBeNull()
   })
})
