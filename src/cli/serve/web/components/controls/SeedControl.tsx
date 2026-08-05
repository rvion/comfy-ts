// seed: a dirty seed posts a FIXED number; untouched defers to the draft's
// seed policy on the server (the payload.ts seed rule — never post a bare mode)
import { observer } from 'mobx-react-lite'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { asSeedForm, randomSeed } from 'src/cli/serve/web/state/payload.ts'

const MODE_TEXT: Record<string, string> = {
   '=': 'fixed',
   '+': 'auto-increment',
   '-': 'auto-decrement',
   '?': 'reroll each run',
}

export const SeedControl = observer(function SeedControl(p: { v: VarSt }) {
   const seed = asSeedForm(p.v.value)
   const setValue = (n: number): void => {
      // parseInt('') is NaN, so clearing the box never snaps the seed to 0
      if (Number.isFinite(n)) p.v.set({ mode: seed.mode, value: Math.max(0, Math.floor(n)) })
   }
   return (
      <div>
         <div className="row-inline">
            <input type="number" min={0} value={seed.value} onChange={(e) => setValue(parseInt(e.target.value, 10))} />
            <button type="button" title="random seed, sent as-is" onClick={() => setValue(randomSeed())}>
               🎲
            </button>
            {p.v.dirty ? (
               <button type="button" className="link" onClick={() => p.v.revert()}>
                  back to draft policy
               </button>
            ) : null}
         </div>
         <div className="hint">
            {p.v.dirty
               ? 'edited: this exact seed will be used'
               : `draft policy: ${seed.mode} (${MODE_TEXT[seed.mode] ?? seed.mode}) — the server applies it`}
         </div>
      </div>
   )
})
