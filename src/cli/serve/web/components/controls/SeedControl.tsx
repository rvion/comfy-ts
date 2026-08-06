// seed: mode buttons + value + 🎲. Drafts are live, so the mode configures the
// SERVER's per-draft seed policy (generate posts no seed key; step 4 applies
// the draft's {mode, value}). The buttons are the SYMBOLS the mode actually is,
// with the sentence in the tooltip: `fixed / +1 / -1 / random` spelled out was a
// row of prose wider than the input it belongs to
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { observer } from 'mobx-react-lite'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { asSeedForm, randomSeed } from 'src/cli/serve/web/state/payload.ts'

const MODES: { mode: string; hint: string }[] = [
   { mode: '=', hint: 'fixed: this exact seed, every run' },
   { mode: '+', hint: 'increments after each run' },
   { mode: '?', hint: 'a fresh random seed each run' },
]

/** `-` is a real mode a draft can hold (the TUI offers it), it is just not worth a permanent
 * button here. It appears only while it IS the mode, so the row never misreports the draft,
 * and it disappears once you pick another one */
function visibleModes(current: string): { mode: string; hint: string }[] {
   if (MODES.some((m) => m.mode === current)) return MODES
   return [...MODES, { mode: current, hint: current === '-' ? 'decrements after each run' : `mode '${current}'` }]
}

export const SeedControl = observer(function SeedControl(p: { v: VarSt }) {
   const seed = asSeedForm(p.v.value)
   const setValue = (n: number): void => {
      // parseInt('') is NaN, so clearing the box never snaps the seed to 0
      if (Number.isFinite(n)) p.v.set({ mode: seed.mode, value: Math.max(0, Math.floor(n)) })
   }
   return (
      <div>
         {/* one control: the modes are a segmented group, and every element on the row is
             input-height so buttons and the number line up instead of stepping over each other */}
         <div className="row-inline">
            <span className="btn-group field-height">
               {visibleModes(seed.mode).map((m) => (
                  <button
                     key={m.mode}
                     type="button"
                     className={seed.mode === m.mode ? 'sel' : ''}
                     data-tip={m.hint}
                     onClick={() => p.v.set({ mode: m.mode, value: seed.value })}
                  >
                     {m.mode}
                  </button>
               ))}
            </span>
            <input type="number" min={0} value={seed.value} onChange={(e) => setValue(parseInt(e.target.value, 10))} />
            <button
               type="button"
               className="field-height"
               data-tip="roll a random seed now"
               onClick={() => setValue(randomSeed())}
            >
               <Icon name="dice" />
            </button>
         </div>
      </div>
   )
})
