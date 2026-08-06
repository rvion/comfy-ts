// the small per-kind controls: prompt, text, int/float, toggle, choice —
// bigger kinds (seed, size, loras, image) have their own files
import { observer } from 'mobx-react-lite'
import { PresetPicker } from 'src/cli/serve/web/components/controls/PresetPicker.tsx'
import { PromptEnhancer } from 'src/cli/serve/web/components/PromptEnhancer.tsx'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export const PromptControl = observer(function PromptControl(p: { v: VarSt; st: WebSt; module: string }) {
   const text = typeof p.v.value === 'string' ? p.v.value : ''
   const rows = Math.min(12, Math.max(4, text.split('\n').length + 1))
   // what the ACTIVE loras will prepend at build time: invisible until now, so the prompt you
   // read here was not the prompt that ran
   const injected = p.st.form?.loraKeywordsFor(p.v) ?? []
   return (
      <div>
         {injected.length > 0 ? (
            <div className="kw-prefix" data-tip="added in front of your prompt at run time, one per active lora">
               {injected.map((kw) => (
                  <span key={kw} className="kw-chip">
                     {kw}
                  </span>
               ))}
            </div>
         ) : null}
         <textarea rows={rows} value={text} onChange={(e) => p.v.set(e.target.value)} />
         <div className="row-inline">
            <span className="hint">// line = comment · "- " line = negative prompt</span>
            <PresetPicker v={p.v} />
            <PromptEnhancer v={p.v} st={p.st} module={p.module} />
         </div>
      </div>
   )
})

export const TextControl = observer(function TextControl(p: { v: VarSt }) {
   const text = typeof p.v.value === 'string' ? p.v.value : ''
   const presets = p.v.desc.textPresets ?? []
   // `v.text(…, { multiline: true })`: an llm instruction is a paragraph, and a one-line field
   // shows its first few words. Grows with the text like the prompt box does
   if (p.v.desc.multiline === true) {
      const rows = Math.min(12, Math.max(3, text.split('\n').length + 1))
      return (
         <div>
            <textarea rows={rows} value={text} onChange={(e) => p.v.set(e.target.value)} />
            {presets.length > 0 ? (
               <div className="row-inline">
                  <PresetPicker v={p.v} />
               </div>
            ) : null}
         </div>
      )
   }
   if (presets.length === 0) return <input type="text" value={text} onChange={(e) => p.v.set(e.target.value)} />
   // a one-line field keeps the button BESIDE it: a menu under a single input would sit alone
   // on a row of its own, twice the height for one button
   return (
      <div className="row-inline">
         <input type="text" style={{ flex: 1 }} value={text} onChange={(e) => p.v.set(e.target.value)} />
         <PresetPicker v={p.v} />
      </div>
   )
})

export const NumberControl = observer(function NumberControl(p: { v: VarSt }) {
   const isInt = p.v.desc.kind === 'int'
   const num = typeof p.v.value === 'number' ? p.v.value : 0
   const min = p.v.desc.min
   const max = p.v.desc.max
   const apply = (raw: string): void => {
      const n = isInt ? parseInt(raw, 10) : parseFloat(raw)
      if (Number.isFinite(n)) p.v.set(n)
   }
   return (
      <div className="row-inline">
         <input
            type="number"
            value={num}
            step={isInt ? 1 : 'any'}
            min={min}
            max={max}
            onChange={(e) => apply(e.target.value)}
         />
         {min != null && max != null ? (
            <input
               type="range"
               style={{ flex: 1, minWidth: 120 }}
               value={num}
               min={min}
               max={max}
               step={isInt ? 1 : (max - min) / 200}
               onChange={(e) => apply(e.target.value)}
            />
         ) : null}
         {min != null || max != null ? <span className="hint">{`${min ?? '-∞'} … ${max ?? '∞'}`}</span> : null}
      </div>
   )
})

export const ToggleControl = observer(function ToggleControl(p: { v: VarSt }) {
   return (
      <label className="row-inline" style={{ cursor: 'pointer' }}>
         <input type="checkbox" checked={p.v.value === true} onChange={(e) => p.v.set(e.target.checked)} />
         <span className="hint">{p.v.value === true ? 'on' : 'off'}</span>
      </label>
   )
})

export const ChoiceControl = observer(function ChoiceControl(p: { v: VarSt }) {
   const choices = p.v.desc.choices ?? []
   const value = typeof p.v.value === 'string' ? p.v.value : ''
   return (
      <select value={value} onChange={(e) => p.v.set(e.target.value)}>
         {/* honest display for a value outside the current union (stale draft): the
             browser would silently SHOW the first option while the state differs */}
         {choices.includes(value) ? null : (
            <option value={value} disabled>
               {value === '' ? '(unset)' : `${value} (not on this host)`}
            </option>
         )}
         {choices.map((c) => (
            <option key={c} value={c}>
               {c}
            </option>
         ))}
      </select>
   )
})
