// the presets button of a text/prompt var (`v.text(…, { presets })`). Picking one REPLACES
// the field, so the row's own revert dot is what undoes it — nothing here is a mode.
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { activePresetLabel } from 'src/vars/presets.ts'

/** one line of a preset's text, enough to tell two of them apart in the menu */
function firstLine(text: string): string {
   const line = text.split('\n').find((l) => l.trim() !== '') ?? ''
   return line.length <= 90 ? line : `${line.slice(0, 89)}…`
}

export const PresetPicker = observer(function PresetPicker(p: { v: VarSt }) {
   const presets = p.v.desc.textPresets ?? []
   const [open, setOpen] = useState(false)
   if (presets.length === 0) return null
   const value = typeof p.v.value === 'string' ? p.v.value : ''
   const active = activePresetLabel(presets, value)
   return (
      <div className="preset-box" onKeyDown={(e) => (e.key === 'Escape' ? setOpen(false) : undefined)}>
         <button
            type="button"
            className="preset-btn"
            aria-expanded={open}
            data-tip="named starting texts — picking one replaces the field"
            onClick={() => setOpen(!open)}
         >
            <Icon name="tag" /> presets ▾
         </button>
         {open ? (
            <>
               {/* a backdrop closes the menu on any outside click: no document listener, and
                   nothing to leak when the form is swapped under it */}
               <div className="preset-backdrop" onClick={() => setOpen(false)} />
               <div className="preset-menu">
                  {presets.map((preset) => (
                     <button
                        key={preset.label}
                        type="button"
                        className={preset.label === active ? 'preset-item on' : 'preset-item'}
                        onClick={() => {
                           p.v.set(preset.text)
                           setOpen(false)
                        }}
                     >
                        <span className="preset-name">
                           {preset.label === active ? '• ' : '  '}
                           {preset.label}
                        </span>
                        <span className="preset-peek">{firstLine(preset.text)}</span>
                     </button>
                  ))}
               </div>
            </>
         ) : null}
      </div>
   )
})
