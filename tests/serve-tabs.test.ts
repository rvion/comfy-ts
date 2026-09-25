import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { ServeApp, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { SERVE_TABS_FILE } from 'src/cli/serve/web/state/draftTabs.ts'
import { draftsDirForFile } from 'src/cli/tui/state/DraftsSt.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let root: string
let comfy: ComfyTS

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   root = mkdtempSync(join(tmpdir(), 'comfy-ts-tabs-'))
   comfy = ComfyTS.create({ rootPath: root })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

function makeModule(key: string, drafts: string[]): ServeModule {
   const host = comfy.host({ id: 'tabs-test-host', host: '127.0.0.1', port: 65500 })
   const dw = host.defineWorkflow({ id: key, vars: { prompt: v.text('p') }, build: () => {} })
   const mod = { key, file: `/fake/${key}.cflow.ts`, dw }
   mkdirSync(draftsDirForFile(mod.file), { recursive: true })
   for (const d of drafts) writeFileSync(join(draftsDirForFile(mod.file), `${d}.json`), '{}')
   return mod
}

const body = (r: { body: string | Uint8Array }): { tabs: unknown } =>
   JSON.parse(typeof r.body === 'string' ? r.body : new TextDecoder().decode(r.body)) as { tabs: unknown }

describe('open draft tabs, kept by the serve process', () => {
   it('a PUT is what the next GET answers, from any window, and it survives a restart', async () => {
      const mod = makeModule('wf-tabs', ['a', 'b'])
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      expect(body(await app.handle({ method: 'GET', url: '/tabs' })).tabs).toEqual([])
      const tabs = [
         { module: 'wf-tabs', draft: 'b' },
         { module: 'wf-tabs', draft: 'a' },
      ]
      expect((await app.handle({ method: 'PUT', url: '/tabs', body: JSON.stringify({ tabs }) })).status).toBe(200)
      expect(body(await app.handle({ method: 'GET', url: '/tabs' })).tabs).toEqual(tabs)
      // a new process reads the file the first one wrote
      const restarted = new ServeApp([mod], { outputRoot: join(root, 'out') })
      expect(body(await restarted.handle({ method: 'GET', url: '/tabs' })).tabs).toEqual(tabs)
      expect(existsSync(join(comfy.baseFolder, SERVE_TABS_FILE))).toBe(true)
   })

   it('a tab whose draft is gone, or junk, is dropped', async () => {
      const mod = makeModule('wf-tabs-gone', ['kept'])
      const app = new ServeApp([mod], { outputRoot: join(root, 'out') })
      const tabs = [{ module: 'wf-tabs-gone', draft: 'kept' }, { module: 'wf-tabs-gone', draft: 'deleted' }, 'junk']
      const reply = await app.handle({ method: 'PUT', url: '/tabs', body: JSON.stringify({ tabs }) })
      expect(body(reply).tabs).toEqual([{ module: 'wf-tabs-gone', draft: 'kept' }])
      expect(JSON.parse(readFileSync(join(comfy.baseFolder, SERVE_TABS_FILE), 'utf8'))).toEqual([
         { module: 'wf-tabs-gone', draft: 'kept' },
      ])
   })

   it('a body that is not a tab list is refused', async () => {
      const app = new ServeApp([makeModule('wf-tabs-bad', [])], { outputRoot: join(root, 'out') })
      expect((await app.handle({ method: 'PUT', url: '/tabs', body: '{"tabs":"x"}' })).status).toBe(400)
   })

   it('the file lands under .comfy-ts/ of this repo, which git ignores: open tabs name private drafts', () => {
      const probe = Bun.spawnSync(['git', 'check-ignore', '-q', `.comfy-ts/${SERVE_TABS_FILE}`], {
         cwd: join(import.meta.dir, '..'),
      })
      expect(probe.exitCode).toBe(0)
      // control: a tracked path is NOT ignored, so a green above means the rule, not a broken probe
      const control = Bun.spawnSync(['git', 'check-ignore', '-q', 'package.json'], { cwd: join(import.meta.dir, '..') })
      expect(control.exitCode).toBe(1)
   })
})
