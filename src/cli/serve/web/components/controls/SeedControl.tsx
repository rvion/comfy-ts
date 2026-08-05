// seed: mode buttons + value + 🎲. Drafts are live, so the mode configures the
// SERVER's per-draft seed policy (generate posts no seed key; step 4 applies
// the draft's {mode, value})
import { observer } from 'mobx-react-lite'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { asSeedForm, randomSeed } from 'src/cli/serve/web/state/payload.ts'

const MODES: { mode: string; label: string; hint: string }[] = [
   { mode: '=', label: 'fixed', hint: 'this exact seed, every run' },
   { mode: '+', label: '+1', hint: 'increments after each run' },
   { mode: '-', label: '-1', hint: 'decrements after each run' },
   { mode: '?', label: 'random', hint: 'a fresh random seed each run' },
]

export const SeedControl = observer(function SeedControl(p: { v: VarSt }) {
   const seed = asSeedForm(p.v.value)
   const setValue = (n: number): void => {
      // parseInt('') is NaN, so clearing the box never snaps the seed to 0
      if (Number.isFinite(n)) p.v.set({ mode: seed.mode, value: Math.max(0, Math.floor(n)) })
   }
   return (
      <div>
         <div className="row-inline">
            {MODES.map((m) => (
               <button
                  key={m.mode}
                  type="button"
                  className={seed.mode === m.mode ? 'mode sel' : 'mode'}
                  title={m.hint}
                  onClick={() => p.v.set({ mode: m.mode, value: seed.value })}
               >
                  {m.label}
               </button>
            ))}
            <input type="number" min={0} value={seed.value} onChange={(e) => setValue(parseInt(e.target.value, 10))} />
            <button type="button" title="roll a random seed now" onClick={() => setValue(randomSeed())}>
               🎲
            </button>
         </div>
         <div className="hint">{MODES.find((m) => m.mode === seed.mode)?.hint ?? seed.mode}</div>
      </div>
   )
})
