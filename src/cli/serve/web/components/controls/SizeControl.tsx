// size: preset select + free WxH inputs + ⇄ swap
import { observer } from 'mobx-react-lite'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { asSizeForm } from 'src/cli/serve/web/state/payload.ts'

export const SizeControl = observer(function SizeControl(p: { v: VarSt }) {
   const size = asSizeForm(p.v.value)
   const presets = p.v.desc.presets ?? []
   const current = presets.find((pr) => pr.width === size.width && pr.height === size.height)
   const setDim = (patch: { width?: number; height?: number }): void => {
      const width = patch.width ?? size.width
      const height = patch.height ?? size.height
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
         p.v.set({ width: Math.floor(width), height: Math.floor(height) })
   }
   return (
      <div className="row-inline">
         <select
            value={current?.label ?? '__custom__'}
            onChange={(e) => {
               const preset = presets.find((pr) => pr.label === e.target.value)
               if (preset != null) p.v.set({ width: preset.width, height: preset.height })
            }}
         >
            {current == null ? <option value="__custom__">custom</option> : null}
            {presets.map((pr) => (
               <option key={pr.label} value={pr.label}>
                  {pr.label} ({pr.width}×{pr.height})
               </option>
            ))}
         </select>
         <input type="number" min={1} value={size.width} onChange={(e) => setDim({ width: Number(e.target.value) })} />
         ×
         <input
            type="number"
            min={1}
            value={size.height}
            onChange={(e) => setDim({ height: Number(e.target.value) })}
         />
         <button
            type="button"
            title="swap width and height"
            onClick={() => p.v.set({ width: size.height, height: size.width })}
         >
            ⇄
         </button>
      </div>
   )
})
