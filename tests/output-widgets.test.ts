import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { RunRecord } from 'src/cli/serve/resultHistory.ts'
import { ServeApp, type ServeExecution, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'
import { resolveWidgetRoles, widget } from 'src/vars/outputWidgets.ts'

describe('widget.relight: roles name output tags', () => {
   it('keeps the roles it is given', () => {
      expect(widget.relight({ image: 'src', depth: 'd' })).toEqual({
         kind: 'relight',
         roles: { image: 'src', depth: 'd' },
      })
   })
   it('refuses a relight with neither depth nor normal: there is no surface to light', () => {
      expect(() => widget.relight({ image: 'src' })).toThrow(/depth.*normal/)
   })
   it('resolves each role to the first image carrying its tag, and skips a tag no image has', () => {
      const w = widget.relight({ image: 'src', depth: 'd', normal: 'n', albedo: 'a' })
      const roles = resolveWidgetRoles(w, [{ tags: ['n'] }, {}, { tags: ['x', 'src'] }, { tags: ['d'] }])
      expect([...roles.entries()]).toEqual([
         ['image', 2],
         ['depth', 3],
         ['normal', 0],
      ])
   })
})

describe('serve: tags and widgets reach the run reply and the kept results', () => {
   const globalHack = globalThis as { comfyts?: ComfyTS }
   let prior: ComfyTS | undefined
   let comfy: ComfyTS
   beforeAll(() => {
      prior = globalHack.comfyts
      Reflect.deleteProperty(globalThis, 'comfyts')
      comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-widgets-')) })
   })
   afterAll(() => {
      if (prior != null) globalHack.comfyts = prior
      else Reflect.deleteProperty(globalThis, 'comfyts')
   })

   it('carries each image tag and the module widgets, also after a reload', async () => {
      const host = comfy.host({ id: 'widget-host', host: '127.0.0.1', port: 65502 })
      const relight = widget.relight({ image: 'source', depth: 'depth' })
      const dw = host.defineWorkflow({
         id: 'wf',
         vars: { prompt: v.prompt('hi') },
         build: () => {},
         widgets: [relight],
      })
      const mod: ServeModule = { key: 'wf', file: '/fake/wf.cflow.ts', dw }
      const images: ServeExecution['images'] = [
         { absPath: null, filename: 'a.png', buffer: new Uint8Array(4), tags: ['source'] },
         { absPath: null, filename: 'b.png', buffer: new Uint8Array(4), tags: ['depth'] },
         { absPath: null, filename: 'c.png', buffer: new Uint8Array(4) },
      ]
      const app = new ServeApp([mod], {
         starter: () => Promise.resolve({ done: Promise.resolve(null), status: 'Success', images, data: { id: 'p1' } }),
      })
      await app.handle({ method: 'PUT', url: '/settings', body: '{"saveToDisk":false}' })
      const reply = JSON.parse(
         String((await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' })).body),
      ) as RunRecord
      expect(reply.images.map((i) => i.tags)).toEqual([['source'], ['depth'], undefined])
      expect(reply.widgets).toEqual([relight])
      const kept = JSON.parse(String((await app.handle({ method: 'GET', url: '/results' })).body)) as {
         runs: RunRecord[]
      }
      expect(kept.runs[0]?.widgets).toEqual([relight])
      expect(kept.runs[0]?.images[1]?.tags).toEqual(['depth'])
   })
})
