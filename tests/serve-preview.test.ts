import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { ServeApp, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

// process-wide global: this file owns ONE temp-root instance, restored after
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-preview-')) })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

function makeApp(): { app: ServeApp; mod: ServeModule } {
   const host = comfy.host({ id: 'preview-host', host: '127.0.0.1', port: 65500 })
   const dw = host.defineWorkflow({
      id: 'wf',
      vars: {
         prompt: v.prompt('a cat\n- blurry'),
         quality: v.choice(['good', 'best'], 'best', { select: 'zero-or-one' }),
      },
      build: () => {},
      previews: {
         prompt: (vars) =>
            `${vars.quality ?? 'no'} quality, ${vars.prompt.positive} | negative: ${vars.prompt.negative}`,
         broken: () => {
            throw new Error('nope')
         },
      },
   })
   const mod: ServeModule = { key: 'wf', file: '/fake/wf.cflow.ts', dw }
   return { app: new ServeApp([mod], { starter: () => Promise.reject(new Error('never runs here')) }), mod }
}

describe('live previews', () => {
   it('computed from the values the panel sends, through the same vars build reads', async () => {
      const { app } = makeApp()
      const reply = await app.handle({
         method: 'POST',
         url: '/preview/wf',
         body: JSON.stringify({ prompt: 'a dog\n- jpeg', quality: null }),
      })
      expect(reply.status).toBe(200)
      const previews = (JSON.parse(String(reply.body)) as { previews: Record<string, string> }).previews
      expect(previews.prompt).toBe('no quality, a dog | negative: jpeg')
      // one preview failing says so, the others still answer
      expect(previews.broken).toContain("preview 'broken' failed: nope")
   })

   it('the shared vars are put back: a preview never leaks into a run', async () => {
      const { app, mod } = makeApp()
      await app.handle({ method: 'POST', url: '/preview/wf', body: JSON.stringify({ prompt: 'changed' }) })
      expect(mod.dw.vars.prompt.value).toBe('a cat\n- blurry')
   })

   it('the workflow description names its previews, so the panel knows to ask', async () => {
      const { app } = makeApp()
      const index = JSON.parse(String((await app.handle({ method: 'GET', url: '/drafts' })).body)) as {
         workflows: { previews: string[] }[]
      }
      expect(index.workflows[0]?.previews).toEqual(['prompt', 'broken'])
   })
})
