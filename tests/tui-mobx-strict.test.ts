import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyTS } from 'src/state.ts'

// mobx 6 defaults to enforceActions:'observed'. A mutation of an OBSERVED
// observable outside an action prints `[MobX] Since strict-mode is enabled…`
// on console.warn — inside ink that noise lands in the user's frame, and a
// permanent warning stream trains everyone to ignore the one that matters
// (agent/coding.md, the same contract as `bun run lint` printing nothing).

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'mobx-host'>

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-mobx-')) })
   host = comfy.host({ id: 'mobx-host', host: '127.0.0.1', port: 65497 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
})

afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

/** run fn with console.warn captured; returns every [MobX] line it printed */
function mobxWarnings(fn: () => void): string[] {
   const seen: string[] = []
   const original = console.warn
   console.warn = (...args: unknown[]): void => {
      const line = args.map((a) => String(a)).join(' ')
      if (line.includes('[MobX]')) seen.push(line)
      else original(...args)
   }
   try {
      fn()
   } finally {
      console.warn = original
   }
   return seen
}

describe('the TUI state tree never mutates observables outside an action', () => {
   it('opening a workflow file records lastWorkflow without a strict-mode warning', async () => {
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({ id: 'mobx-strict-test', vars: {}, build: () => {} })
      // SettingsSt's own persist reaction OBSERVES lastWorkflow, so the
      // constructor's `settings.lastWorkflow = currentFile` write is exactly
      // the strict-mode case (repro: the warning showed up in every run of
      // tests/workflow-builder.test.ts)
      let st: InstanceType<typeof TuiSt> | null = null
      const warnings = mobxWarnings(() => {
         st = new TuiSt(wf, { currentFile: '/tmp/mobx-strict-test.cflow.ts' })
      })
      expect(warnings).toEqual([])
      expect(st).not.toBeNull()
      st?.dispose()
   })
})
