// loras. Two states per option: SELECTED (present in the record) and ON (not
// `false`) — switching one off keeps its card in place instead of hiding it, and
// its strength comes back when it does. The row carries the full controls
// (on/off + model/clip), so nothing needs the popup to be adjusted; the popup
// adds discovery: filter, the selected section with trigger words, and a
// preview-card gallery of everything else. The 🖼/🏷 toggles hide images/titles
// on EVERY lora surface (NSFW screens, persisted on WebSt); with both hidden the
// row collapses to a count. Names come from descriptor optionLabels; the value
// keeps raw enum keys: { "<name>": [model, clip] | false }, replaced by copy
import { observer, useLocalObservable } from 'mobx-react-lite'
import { useEffect, type ReactNode } from 'react'
import { fetchLoraInfo, loraPreviewSrc, type LoraInfo } from 'src/cli/serve/web/api.ts'
import type { LoraStrength } from 'src/vars/ComfyVars.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'
import {
   loraIsOn,
   loraStrengthPair,
   setLoraEnabled,
   setLoraStrength,
   type LoraStrengthPair,
} from 'src/cli/serve/web/state/payload.ts'

const CARD_CAP = 60

function asRecord(raw: unknown): Record<string, unknown> {
   if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
   return {}
}

type LocalSt = {
   open: boolean
   filter: string
   info: Map<string, LoraInfo | 'loading' | 'error'>
   previewFailed: Set<string>
   /** strength of a lora switched OFF, so switching it back on restores it (LorasVar.prev) */
   prevStrength: Map<string, LoraStrengthPair>
   setOpen(open: boolean): void
   setFilter(raw: string): void
   noteInfo(name: string, v: LoraInfo | 'loading' | 'error'): void
   notePreviewFailed(name: string): void
   notePrevStrength(name: string, pair: LoraStrengthPair): void
}

export const LorasControl = observer(function LorasControl(p: { v: VarSt; host: string; st: WebSt }) {
   const local = useLocalObservable<LocalSt>(() => ({
      open: false,
      filter: '',
      info: new Map(),
      previewFailed: new Set(),
      prevStrength: new Map(),
      setOpen(open: boolean) {
         this.open = open
      },
      setFilter(raw: string) {
         this.filter = raw
      },
      noteInfo(name: string, v: LoraInfo | 'loading' | 'error') {
         this.info.set(name, v)
      },
      notePreviewFailed(name: string) {
         this.previewFailed.add(name)
      },
      notePrevStrength(name: string, pair: LoraStrengthPair) {
         this.prevStrength.set(name, pair)
      },
   }))
   const record = asRecord(p.v.value)
   const options = p.v.desc.options ?? []
   const labels = p.v.desc.optionLabels ?? {}
   const label = (name: string): string => labels[name] ?? name
   // SELECTED = present in the record (a `false` entry is selected but switched off, and
   // must keep its place in the ui); ON = actually contributing to the graph
   const isSelected = (name: string): boolean => record[name] !== undefined
   const isOn = (name: string): boolean => loraIsOn(record[name])
   const selectedNames = options.filter(isSelected)
   const showImages = p.st.showLoraImages
   const showTitles = p.st.showLoraTitles

   const setEntry = (name: string, st: LoraStrength | null): void => {
      const next = { ...record }
      if (st == null) delete next[name]
      else next[name] = st
      p.v.set(next)
   }
   const toggleOn = (name: string, on: boolean): void => {
      if (!on) local.notePrevStrength(name, loraStrengthPair(record[name]))
      p.v.set(setLoraEnabled(record, name, on, on ? local.prevStrength.get(name) : undefined))
   }
   const setStrength = (name: string, pair: LoraStrengthPair): void => {
      if (!isOn(name)) {
         // editing an OFF lora's strength remembers it for when it comes back on
         local.notePrevStrength(name, pair)
         return
      }
      p.v.set(setLoraStrength(record, name, pair))
   }

   /** the on/off switch + model/clip inputs, shared by the row cards and the modal */
   const strengthControls = (name: string): ReactNode => {
      const pair = isOn(name) ? loraStrengthPair(record[name]) : (local.prevStrength.get(name) ?? { model: 1, clip: 1 })
      return (
         <>
            <input
               type="checkbox"
               checked={isOn(name)}
               title={isOn(name) ? 'switch off (stays in the list)' : 'switch back on'}
               onChange={(e) => toggleOn(name, e.target.checked)}
            />
            <span className="st-label">m</span>
            <input
               type="number"
               step={0.05}
               value={pair.model}
               onChange={(e) => {
                  const n = parseFloat(e.target.value)
                  if (Number.isFinite(n)) setStrength(name, { model: n, clip: pair.clip })
               }}
            />
            <span className="st-label">c</span>
            <input
               type="number"
               step={0.05}
               value={pair.clip}
               onChange={(e) => {
                  const n = parseFloat(e.target.value)
                  if (Number.isFinite(n)) setStrength(name, { model: pair.model, clip: n })
               }}
            />
         </>
      )
   }

   // trigger words for the active section load once per open (bounded: active loras only)
   const open = local.open
   const host = p.host
   const activeKey = selectedNames.join('\n')
   useEffect(() => {
      if (!open) return
      for (const name of activeKey.split('\n')) {
         if (name === '' || local.info.has(name)) continue
         local.noteInfo(name, 'loading')
         fetchLoraInfo({ host, name })
            .then((i) => local.noteInfo(name, i))
            .catch(() => local.noteInfo(name, 'error'))
      }
   }, [open, activeKey, host, local])

   // esc closes wherever focus is, not only inside the filter input
   useEffect(() => {
      if (!open) return
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Escape') local.setOpen(false)
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [open, local])

   const needle = local.filter.toLowerCase()
   const matchesFilter = (name: string): boolean =>
      name.toLowerCase().includes(needle) || label(name).toLowerCase().includes(needle)
   const matches = options.filter(matchesFilter)
   const cards = matches.filter((o) => !isSelected(o)).slice(0, CARD_CAP)

   const thumb = (name: string): ReactNode => {
      if (!showImages) return null
      return local.previewFailed.has(name) ? (
         <div className="lora-thumb none">no preview</div>
      ) : (
         <img
            key={name}
            className="lora-thumb"
            loading="lazy"
            src={loraPreviewSrc({ host: p.host, name })}
            alt={label(name)}
            onError={() => local.notePreviewFailed(name)}
         />
      )
   }

   const visibilityToggles = (
      <>
         <button
            type="button"
            className={showImages ? 'mode sel' : 'mode'}
            title={showImages ? 'hide lora images' : 'show lora images'}
            onClick={() => p.st.toggleLoraImages()}
         >
            🖼
         </button>
         <button
            type="button"
            className={showTitles ? 'mode sel' : 'mode'}
            title={showTitles ? 'hide lora titles' : 'show lora titles'}
            onClick={() => p.st.toggleLoraTitles()}
         >
            🏷
         </button>
      </>
   )

   return (
      <div>
         <div className="row-inline">
            {!showImages && !showTitles ? (
               <span className="hint">
                  {selectedNames.length} lora{selectedNames.length === 1 ? '' : 's'} selected
               </span>
            ) : (
               selectedNames.map((name) => (
                  <span
                     key={name}
                     className={`${showImages ? 'lora-chip card' : 'lora-chip'}${isOn(name) ? '' : ' off'}`}
                     title={name}
                  >
                     {thumb(name)}
                     {showTitles ? <span className="chip-title">{label(name)}</span> : null}
                     {/* strengths and the on/off switch live HERE: adjusting a lora must not
                         cost a trip through the popup */}
                     <span className="chip-controls">
                        {strengthControls(name)}
                        <button type="button" title="remove from the list" onClick={() => setEntry(name, null)}>
                           ✕
                        </button>
                     </span>
                  </span>
               ))
            )}
            <button type="button" onClick={() => local.setOpen(true)}>
               {selectedNames.length === 0 ? `choose loras… (${options.length})` : 'edit…'}
            </button>
            {visibilityToggles}
         </div>

         {local.open ? (
            <div className="modal-overlay" onClick={() => local.setOpen(false)}>
               <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-head">
                     <input
                        type="text"
                        autoFocus
                        placeholder={`filter ${options.length} loras`}
                        value={local.filter}
                        onChange={(e) => local.setFilter(e.target.value)}
                     />
                     {visibilityToggles}
                     <button type="button" title="close (esc)" onClick={() => local.setOpen(false)}>
                        ✕
                     </button>
                  </div>
                  <div className="modal-body">
                     {selectedNames.length > 0 ? (
                        <div className="lora-active-section">
                           <div className="section-title">selected ({selectedNames.length})</div>
                           {selectedNames.filter(matchesFilter).map((name) => {
                              const info = local.info.get(name)
                              return (
                                 <div key={name} className={isOn(name) ? 'lora-active-row' : 'lora-active-row off'}>
                                    {thumb(name)}
                                    <div className="lora-active-text">
                                       <div className="lora-label" title={name}>
                                          {showTitles ? label(name) : '···'}
                                       </div>
                                       {typeof info === 'object' && info.triggerWords.length > 0 ? (
                                          <div className="hint">{info.triggerWords.join(', ')}</div>
                                       ) : (
                                          <div className="hint">{name}</div>
                                       )}
                                    </div>
                                    {strengthControls(name)}
                                    <button
                                       type="button"
                                       title="remove from the list"
                                       onClick={() => setEntry(name, null)}
                                    >
                                       ✕
                                    </button>
                                 </div>
                              )
                           })}
                        </div>
                     ) : null}
                     <div className="section-title">all loras</div>
                     <div className="lora-grid">
                        {cards.map((name) => (
                           <button
                              key={name}
                              type="button"
                              className="lora-card"
                              title={name}
                              onClick={() => setEntry(name, [1, 1])}
                           >
                              {thumb(name)}
                              <div className="lora-label">{showTitles ? label(name) : name.slice(0, 2) + '···'}</div>
                           </button>
                        ))}
                     </div>
                     {matches.length - selectedNames.filter(matchesFilter).length > CARD_CAP ? (
                        <div className="loras-more">
                           … {matches.length - selectedNames.filter(matchesFilter).length - CARD_CAP} more — refine the
                           filter
                        </div>
                     ) : null}
                     {matches.length === 0 ? <div className="loras-more">no lora matches '{local.filter}'</div> : null}
                  </div>
               </div>
            </div>
         ) : null}
      </div>
   )
})
