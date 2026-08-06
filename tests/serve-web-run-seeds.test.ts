// under `+` the seed field sat on its first value forever while every image really was
// different: the server keeps its continuation in memory and the draft file never moved, so
// nothing on screen ever changed. A finished run reports the seed it used; the form takes it.
import { describe, expect, it } from 'bun:test'
import { FormSt } from 'src/cli/serve/web/state/FormSt.ts'
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

/** the same write WebSt.applyRunSeeds performs, against a real FormSt */
function applyRunSeeds(form: FormSt, seeds: Record<string, number>): void {
   for (const varSt of form.vars) {
      if (varSt.desc.kind !== 'seed') continue
      const used = seeds[varSt.name]
      if (typeof used !== 'number' || !Number.isFinite(used)) continue
      const current = asSeedForm(varSt.value)
      if (current.value === used) continue
      varSt.set({ mode: current.mode, value: used })
   }
}

const seedOf = (form: FormSt): { mode: string; value: number } =>
   asSeedForm(form.vars.find((v) => v.name === 'seed')?.value)

describe('a run puts its seed back on the form', () => {
   it('the field follows the run, and the MODE is untouched', () => {
      const form = new FormSt('wf', 'default', MOD, { seed: { mode: '+', value: 517 } })
      applyRunSeeds(form, { seed: 517 })
      expect(seedOf(form)).toEqual({ mode: '+', value: 517 })
      applyRunSeeds(form, { seed: 518 }) // the next run stepped
      expect(seedOf(form)).toEqual({ mode: '+', value: 518 })
      form.dispose({ flush: false })
   })

   it('writes the seed the run USED, so the server continuation does not skip one', () => {
      // the server restarts its continuation from the draft value, so storing the NEXT seed
      // would make the following run jump two
      const form = new FormSt('wf', 'default', MOD, { seed: { mode: '+', value: 100 } })
      applyRunSeeds(form, { seed: 100 })
      expect(seedOf(form).value).toBe(100)
      form.dispose({ flush: false })
   })

   it('a reply with no seed for a var, or a junk one, leaves it alone', () => {
      const form = new FormSt('wf', 'default', MOD, { seed: { mode: '?', value: 42 } })
      applyRunSeeds(form, {})
      applyRunSeeds(form, { seed: Number.NaN })
      applyRunSeeds(form, { other: 9 })
      expect(seedOf(form)).toEqual({ mode: '?', value: 42 })
      form.dispose({ flush: false })
   })

   it('non-seed vars are never touched by a run reply', () => {
      const form = new FormSt('wf', 'default', MOD, { seed: { mode: '=', value: 1 }, steps: 8 })
      applyRunSeeds(form, { steps: 999, seed: 2 })
      expect(form.vars.find((v) => v.name === 'steps')?.value).toBe(8)
      expect(seedOf(form).value).toBe(2)
      form.dispose({ flush: false })
   })
})
