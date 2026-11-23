// GET /thumb is the one route that reads local files by path, so it is a GUARD: what it must
// refuse is fed first (an undeclared file, a traversal), then the lookalikes it must serve.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { ServeApp, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { exampleImagePath } from 'src/exampleAssets.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

describe('serve: /thumb previews declared local images only, and media presets', () => {
   const globalHack = globalThis as { comfyts?: ComfyTS }
   let prior: ComfyTS | undefined
   let app: ServeApp
   let dir: string
   const pug = exampleImagePath('pug_200x300.jpg')

   beforeAll(() => {
      prior = globalHack.comfyts
      Reflect.deleteProperty(globalThis, 'comfyts')
      dir = mkdtempSync(join(tmpdir(), 'comfy-ts-thumb-'))
      copyFileSync(pug, join(dir, 'beside.jpg'))
      const comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-thumb-root-')) })
      const host = comfy.host({ id: 'thumb-host', host: '127.0.0.1', port: 65503 })
      const dw = host.defineWorkflow({
         id: 'wf',
         vars: {
            image: v.image(pug, {
               presets: { pug: pug, gone: '/nowhere/missing.png', web: 'https://example.com/ruin.png' },
            }),
            model: v.choice(['a', 'b'], 'a').ui({ options: { a: { label: 'A', thumb: 'beside.jpg', quality: 4 } } }),
         },
         build: () => {},
      })
      const mod: ServeModule = { key: 'wf', file: join(dir, 'wf.cflow.ts'), dw }
      app = new ServeApp([mod], {
         outputRoot: mkdtempSync(join(tmpdir(), 'comfy-ts-thumb-out-')),
         starter: () => Promise.reject(new Error('no runs here')),
      })
   })
   afterAll(() => {
      if (prior != null) globalHack.comfyts = prior
      else Reflect.deleteProperty(globalThis, 'comfyts')
   })

   const thumb = async (src: string): Promise<number> =>
      (await app.handle({ method: 'GET', url: `/thumb?src=${encodeURIComponent(src)}&w=64` })).status

   async function vars(): Promise<Record<string, VarDescriptor>> {
      const index = JSON.parse(String((await app.handle({ method: 'GET', url: '/drafts' })).body)) as {
         workflows: { vars: Record<string, VarDescriptor> }[]
      }
      return index.workflows[0]?.vars ?? {}
   }

   it('describes presets: a local one gets a thumb url, a missing one is flagged, a url is its own thumb', async () => {
      const presets = (await vars()).image?.mediaPresets ?? []
      expect(presets.map((p) => [p.label, p.missing === true, p.thumb?.startsWith('/thumb?src=') === true])).toEqual([
         ['pug', false, true],
         ['gone', true, false],
         ['web', false, false],
      ])
      expect(presets[2]?.thumb).toBe('https://example.com/ruin.png')
   })

   it('turns a relative option thumb into a /thumb url beside the workflow file', async () => {
      const look = (await vars()).model?.ui?.options?.a
      expect(look?.thumb).toBe(`/thumb?src=${encodeURIComponent(join(dir, 'beside.jpg'))}&w=128`)
      expect(look?.quality).toBe(4)
   })

   it('REFUSES a file no workflow declared, and a traversal out of an allowed folder', async () => {
      await vars()
      expect(await thumb('/etc/hosts')).toBe(403)
      expect(await thumb(`${dir}/../../../etc/hosts`)).toBe(403)
      expect(await thumb(exampleImagePath('dog_512x512.jpg'))).toBe(403)
   })

   it('serves a declared default, a file under the workflow folder, and says missing for a declared absent one', async () => {
      await vars()
      const ok = await app.handle({ method: 'GET', url: `/thumb?src=${encodeURIComponent(pug)}&w=64` })
      expect(ok.status).toBe(200)
      expect(ok.contentType).toBe('image/webp')
      expect(await thumb(join(dir, 'beside.jpg'))).toBe(200)
      expect(await thumb('/nowhere/missing.png')).toBe(404)
   })
})
