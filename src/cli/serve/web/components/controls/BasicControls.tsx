// the small per-kind controls: text, int/float, toggle, choice —
// bigger kinds (prompt, seed, size, loras, image) have their own files
import { observer } from 'mobx-react-lite'
import { PresetPicker } from 'src/cli/serve/web/components/controls/PresetPicker.tsx'
import { VarIcon } from 'src/cli/serve/web/components/VarIcon.tsx'
import { choiceAsButtons, clickChoice, pickedChoices } from 'src/cli/serve/web/state/choiceButtons.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'

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
   // one (the default), zero-or-one (null = none picked), many (a list)
   const select = p.v.desc.select ?? 'one'
   const picked = pickedChoices(p.v.value)
   const looks = p.v.desc.ui?.options ?? {}
   const click = (c: string): void => p.v.set(clickChoice({ select, choices, value: p.v.value, c }))
   // a stale draft value is said, never shown as if one of the buttons were lit
   const stale = picked.filter((x) => !choices.includes(x))
   const staleNote =
      stale.length > 0 ? (
         <span className="hint">{stale.join(', ')} (not on this host)</span>
      ) : select === 'one' && picked.length === 0 ? (
         <span className="hint">(unset)</span>
      ) : null
   // many choices can always be several buttons at once: a select holds one value only
   if (choiceAsButtons(choices) || select !== 'one')
      return (
         <span className="row-inline">
            <span className="btn-group wrap">
               {choices.map((c) => {
                  // the workflow's look for THIS option: its icon, and its color for the lit fill
                  const look = looks[c]
                  const on = picked.includes(c)
                  return (
                     <button
                        key={c}
                        type="button"
                        className={on ? 'sel' : ''}
                        data-tip={
                           select === 'many'
                              ? `${on ? 'on' : 'off'}: click to toggle`
                              : select === 'zero-or-one' && on
                                ? 'click again to pick none'
                                : undefined
                        }
                        style={
                           look?.color == null
                              ? undefined
                              : on
                                ? { background: look.color, borderColor: look.color }
                                : { color: look.color }
                        }
                        onClick={() => click(c)}
                     >
                        {look?.icon == null ? null : <VarIcon icon={look.icon} color={undefined} />}
                        {c}
                     </button>
                  )
               })}
            </span>
            {staleNote}
         </span>
      )
   const value = picked[0] ?? ''
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
