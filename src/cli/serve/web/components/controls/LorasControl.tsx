// loras: filter-as-you-type over the option list, tick to activate, model/clip
// strengths per active lora, hover (or tap the name) fills the preview pane —
// image + trigger words off the serve lora routes. Value shape = the POST
// payload contract: { "<name>": [model, clip] }, replaced by copy on every edit
import { observer, useLocalObservable } from 'mobx-react-lite'
import { fetchLoraInfo, loraPreviewSrc, type LoraInfo } from 'src/cli/serve/web/api.ts'
import type { LoraStrength } from 'src/vars/ComfyVars.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'

const RENDER_CAP = 100

function asRecord(raw: unknown): Partial<Record<string, LoraStrength>> {
   if (raw != null && typeof raw === 'object' && !Array.isArray(raw))
      return raw as Partial<Record<string, LoraStrength>>
   return {}
}

/** any stored strength shape → the {model, clip} pair the inputs edit */
function strengthPair(st: LoraStrength | undefined): { model: number; clip: number } {
   if (typeof st === 'number') return { model: st, clip: st }
   if (Array.isArray(st)) return { model: st[0], clip: st[1] }
   return { model: 1, clip: 1 }
}

export const LorasControl = observer(function LorasControl(p: { v: VarSt; host: string }) {
   const local = useLocalObservable(() => ({
      filter: '',
      hovered: null as string | null,
      info: new Map<string, LoraInfo | 'loading' | 'error'>(),
      previewFailed: new Set<string>(),
      setFilter(raw: string) {
         this.filter = raw
      },
      setHovered(name: string | null) {
         this.hovered = name
      },
      noteInfo(name: string, v: LoraInfo | 'loading' | 'error') {
         this.info.set(name, v)
      },
      notePreviewFailed(name: string) {
         this.previewFailed.add(name)
      },
   }))
   const hover = (name: string): void => {
      local.setHovered(name)
      if (!local.info.has(name)) {
         local.noteInfo(name, 'loading')
         fetchLoraInfo({ host: p.host, name })
            .then((i) => local.noteInfo(name, i))
            .catch(() => local.noteInfo(name, 'error'))
      }
   }
   const record = asRecord(p.v.value)
   const isActive = (name: string): boolean => record[name] != null && record[name] !== false
   const options = p.v.desc.options ?? []
   const needle = local.filter.toLowerCase()
   const matches = options.filter((o) => o.toLowerCase().includes(needle))
   // active loras stay visible above the fold, then the rest in option order
   const shown = [...matches.filter(isActive), ...matches.filter((o) => !isActive(o))].slice(0, RENDER_CAP)
   const activeCount = options.filter(isActive).length

   const setEntry = (name: string, st: LoraStrength | null): void => {
      const next = { ...record }
      if (st == null) delete next[name]
      else next[name] = st
      p.v.set(next)
   }

   const hovered = local.hovered
   const hoveredInfo = hovered != null ? local.info.get(hovered) : undefined

   return (
      <div className="loras-box">
         <div className="search">
            <input
               type="text"
               placeholder={`filter ${options.length} loras — ${activeCount} active`}
               value={local.filter}
               onChange={(e) => local.setFilter(e.target.value)}
            />
         </div>
         <div className="loras-body">
            <div className="loras-list">
               {shown.map((name) => {
                  const active = isActive(name)
                  const pair = strengthPair(record[name])
                  return (
                     <div
                        key={name}
                        className={active ? 'lora-row active' : 'lora-row'}
                        onMouseEnter={() => hover(name)}
                     >
                        <input
                           type="checkbox"
                           checked={active}
                           onChange={(e) => setEntry(name, e.target.checked ? [1, 1] : null)}
                        />
                        {/* tap = the touch spelling of hover */}
                        <button type="button" className="name" title={name} onClick={() => hover(name)}>
                           {name}
                        </button>
                        {active ? (
                           <>
                              <span className="st-label">model</span>
                              <input
                                 type="number"
                                 step={0.05}
                                 value={pair.model}
                                 onChange={(e) => {
                                    const n = parseFloat(e.target.value)
                                    if (Number.isFinite(n)) setEntry(name, [n, pair.clip])
                                 }}
                              />
                              <span className="st-label">clip</span>
                              <input
                                 type="number"
                                 step={0.05}
                                 value={pair.clip}
                                 onChange={(e) => {
                                    const n = parseFloat(e.target.value)
                                    if (Number.isFinite(n)) setEntry(name, [pair.model, n])
                                 }}
                              />
                           </>
                        ) : null}
                     </div>
                  )
               })}
               {matches.length > RENDER_CAP ? (
                  <div className="loras-more">… {matches.length - RENDER_CAP} more — refine the filter</div>
               ) : null}
               {matches.length === 0 ? <div className="loras-more">no lora matches '{local.filter}'</div> : null}
            </div>
            {hovered != null ? (
               <div className="lora-pane">
                  {local.previewFailed.has(hovered) ? (
                     <div className="hint">no preview on the server</div>
                  ) : (
                     <img
                        // key remounts the node per lora: a reused <img> can fire the PREVIOUS
                        // src's error after the swap and mark the wrong name failed
                        key={hovered}
                        src={loraPreviewSrc({ host: p.host, name: hovered })}
                        alt={hovered}
                        onError={() => local.notePreviewFailed(hovered)}
                     />
                  )}
                  <div className="lora-pane-name" title={hovered}>
                     {typeof hoveredInfo === 'object' ? hoveredInfo.displayName : hovered}
                  </div>
                  {typeof hoveredInfo === 'object' && hoveredInfo.triggerWords.length > 0 ? (
                     <div className="hint">{hoveredInfo.triggerWords.join(', ')}</div>
                  ) : null}
               </div>
            ) : null}
         </div>
      </div>
   )
})
