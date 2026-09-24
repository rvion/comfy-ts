// size: starred presets as one-click aspect icons, then the full list (each row starrable),
// then W × H fields that fit their numbers, then ⇄ swap
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { observer } from 'mobx-react-lite'
import { useState, type ReactNode } from 'react'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { asSizeForm } from 'src/cli/serve/web/state/payload.ts'
import { aspectBox, starredPresets, toggleStar } from 'src/cli/serve/web/state/sizeStars.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

/** a tiny rectangle in the preset's own ratio, centred in a fixed square so a row lines up */
function AspectIcon(p: { width: number; height: number; box?: number }): ReactNode {
   const box = p.box ?? 14
   const r = aspectBox(p.width, p.height, box - 2)
   return (
      <svg className="aspect-icon" width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
         <rect
            x={(box - r.w) / 2}
            y={(box - r.h) / 2}
            width={r.w}
            height={r.h}
            rx={1.5}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
         />
      </svg>
   )
}

/** a number field as wide as its number, so 512 and 1344 both read without dead space */
function fitWidth(n: number): string {
   return `${String(n).length + 2.6}ch`
}

export const SizeControl = observer(function SizeControl(p: { v: VarSt; st: WebSt; module: string }) {
   const [open, setOpen] = useState(false)
   const size = asSizeForm(p.v.value)
   const presets = p.v.desc.presets ?? []
   const starKey = `${p.module}/${p.v.name}`
   const defaults = p.v.desc.starredPresets ?? []
   const mine = p.st.sizeStars[starKey]
   const stars = starredPresets({ presets, defaults, mine })
   const current = presets.find((pr) => pr.width === size.width && pr.height === size.height)
   const pick = (pr: { width: number; height: number }): void => p.v.set({ width: pr.width, height: pr.height })
   const setDim = (patch: { width?: number; height?: number }): void => {
      const width = patch.width ?? size.width
      const height = patch.height ?? size.height
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
         p.v.set({ width: Math.floor(width), height: Math.floor(height) })
   }
   return (
      <div className="row-inline size-row">
         {stars.length > 0 ? (
            <span className="btn-group">
               {stars.map((pr) => (
                  <button
                     key={pr.label}
                     type="button"
                     className={pr === current ? 'sel' : ''}
                     data-tip={`${pr.label} · ${pr.width}×${pr.height}`}
                     onClick={() => pick(pr)}
                  >
                     <AspectIcon width={pr.width} height={pr.height} />
                  </button>
               ))}
            </span>
         ) : null}
         <div className="preset-box" onKeyDown={(e) => (e.key === 'Escape' ? setOpen(false) : undefined)}>
            <button type="button" className="preset-btn size-pick" aria-expanded={open} onClick={() => setOpen(!open)}>
               <AspectIcon width={size.width} height={size.height} /> {current?.label ?? 'custom'} ▾
            </button>
            {open ? (
               <>
                  <div className="preset-backdrop" onClick={() => setOpen(false)} />
                  <div className="preset-menu size-menu">
                     {presets.map((pr) => {
                        const starred = stars.includes(pr)
                        return (
                           <div key={pr.label} className={pr === current ? 'size-item on' : 'size-item'}>
                              <button
                                 type="button"
                                 className="size-item-pick"
                                 onClick={() => {
                                    pick(pr)
                                    setOpen(false)
                                 }}
                              >
                                 <AspectIcon width={pr.width} height={pr.height} />
                                 <span className="size-item-label">{pr.label}</span>
                                 <span className="hint">
                                    {pr.width}×{pr.height}
                                 </span>
                              </button>
                              {/* the star is its own button: starring never changes the size */}
                              <button
                                 type="button"
                                 className={starred ? 'size-star on' : 'size-star'}
                                 // a NATIVE tooltip: the page's own tooltip is drawn inside this scrolling list, sticks
                                 // out past its edge and scrolls it sideways over the last row
                                 title={
                                    starred ? 'unstar: remove from the quick buttons' : 'star: add to the quick buttons'
                                 }
                                 onClick={() =>
                                    p.st.setSizeStars(starKey, toggleStar({ defaults, mine, label: pr.label }))
                                 }
                              >
                                 {starred ? '★' : '☆'}
                              </button>
                           </div>
                        )
                     })}
                  </div>
               </>
            ) : null}
         </div>
         <input
            type="number"
            min={1}
            className="size-num"
            style={{ width: fitWidth(size.width) }}
            value={size.width}
            onChange={(e) => setDim({ width: Number(e.target.value) })}
         />
         ×
         <input
            type="number"
            min={1}
            className="size-num"
            style={{ width: fitWidth(size.height) }}
            value={size.height}
            onChange={(e) => setDim({ height: Number(e.target.value) })}
         />
         <button
            type="button"
            data-tip="swap width and height"
            onClick={() => p.v.set({ width: size.height, height: size.width })}
         >
            <Icon name="swap" />
         </button>
      </div>
   )
})
