import { describe, expect, it } from 'bun:test'
import type { ModuleDescription } from 'src/cli/serve/web/api.ts'
import { FormSt } from 'src/cli/serve/web/state/FormSt.ts'

const MOD: ModuleDescription = {
   module: 'wf',
   file: '/x/wf.cflow.ts',
   host: 'h',
   drafts: ['default'],
   vars: {
      model: { kind: 'choice', payload: '', default: 'turbo', choices: ['turbo', 'base'] },
      cfg: { kind: 'float', payload: '', default: 4, ui: { activeWhen: { model: ['base'] } } },
      steps: { kind: 'int', payload: '', default: 30 },
   },
}

describe('activeWhen in the panel', () => {
   it('a field is inactive, with the reason, until the other var holds a listed value', () => {
      const form = new FormSt('wf', 'default', MOD, { model: 'turbo' })
      const cfg = form.vars.find((v) => v.name === 'cfg')
      const model = form.vars.find((v) => v.name === 'model')
      if (cfg == null || model == null) throw new Error('vars missing')
      expect(form.inactiveReason(cfg)).toBe('only used when model is base')
      model.set('base')
      expect(form.inactiveReason(cfg)).toBeNull()
      form.dispose({ flush: false })
   })

   it('control: a var without a condition is always active', () => {
      const form = new FormSt('wf', 'default', MOD, {})
      const steps = form.vars.find((v) => v.name === 'steps')
      if (steps != null) expect(form.inactiveReason(steps)).toBeNull()
      form.dispose({ flush: false })
   })
})
