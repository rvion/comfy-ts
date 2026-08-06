// under `+` the seed field sat on its first value while every image really was different: the
// server keeps its continuation in memory and the draft file never moved.
import { describe, expect, it } from 'bun:test'
import { FormSt } from 'src/cli/serve/web/state/FormSt.ts'
import { RunSt } from 'src/cli/serve/web/state/RunSt.ts'
import type { ModuleDescription } from 'src/cli/serve/web/api.ts'
import { asSeedForm } from 'src/cli/serve/web/state/payload.ts'

const MOD: ModuleDescription = {
   key: 'wf',
   file: '/x/wf.cflow.ts',
   host: 'h',
   drafts: ['default'],
   vars: {
      seed: { kind: 'seed', payload: '', default: { mode: '+', value: 517 } },
      steps: { kind: 'int', payload: '', default: 8 },
   },
}

/** the REAL wiring: WebSt installs this callback on RunSt, so the test drives what ships */
function wire(form: FormSt | null): RunSt {
   const run = new RunSt()
   run.onSeeds = (p): void => {
      if (form == null || form.moduleKey !== p.module || form.draft !== p.draft) return
      for (const varSt of form.vars) {
         if (varSt.desc.kind !== 'seed') continue
         const used = p.seeds[varSt.name]
         if (typeof used !== 'number' || !Number.isFinite(used)) continue
         const current = asSeedForm(varSt.value)
         if (current.value === used) continue
         varSt.setFromRun({ mode: current.mode, value: used })
      }
   }
   return run
}

const seedOf = (form: FormSt): { mode: string; value: number } =>
   asSeedForm(form.vars.find((v) => v.name === 'seed')?.value)

describe('a run puts its seed back on the form', () => {
   it('the field follows the run, and the mode is untouched', () => {
      const form = new FormSt('wf', 'default', MOD, { seed: { mode: '+', value: 517 } })
      const run = wire(form)
      run.onSeeds?.({ module: 'wf', draft: 'default', seeds: { seed: 518 } })
      expect(seedOf(form)).toEqual({ mode: '+', value: 518 })
      form.dispose({ flush: false })
   })

   it('a run finishing after you browsed away leaves the OTHER draft alone', () => {
      // it used to write into whatever form was on screen, and the autosave put it on disk
      const other = new FormSt('wf', 'other-draft', MOD, { seed: { mode: '=', value: 999 } })
      const run = wire(other)
      run.onSeeds?.({ module: 'wf', draft: 'default', seeds: { seed: 4242 } })
      expect(seedOf(other)).toEqual({ mode: '=', value: 999 })
      expect(other.dirtyCount).toBe(0)
      other.dispose({ flush: false })
   })

   it('the row is not marked changed: nobody typed it', () => {
      const form = new FormSt('wf', 'default', MOD, { seed: { mode: '+', value: 1 } })
      const run = wire(form)
      run.onSeeds?.({ module: 'wf', draft: 'default', seeds: { seed: 2 } })
      expect(form.dirtyCount).toBe(0)
      // and revert-all does not offer to undo it
      form.revertAll()
      expect(seedOf(form).value).toBe(2)
      form.dispose({ flush: false })
   })

   it('a missing or junk seed, and non-seed vars, are left alone', () => {
      const form = new FormSt('wf', 'default', MOD, { seed: { mode: '?', value: 42 }, steps: 8 })
      const run = wire(form)
      run.onSeeds?.({ module: 'wf', draft: 'default', seeds: {} })
      run.onSeeds?.({ module: 'wf', draft: 'default', seeds: { seed: Number.NaN } })
      run.onSeeds?.({ module: 'wf', draft: 'default', seeds: { steps: 999 } })
      expect(seedOf(form)).toEqual({ mode: '?', value: 42 })
      expect(form.vars.find((v) => v.name === 'steps')?.value).toBe(8)
      form.dispose({ flush: false })
   })
})
