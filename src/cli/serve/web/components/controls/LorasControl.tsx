// loras as a PALETTE. The row shows only the loras you put in it; clicking a
// card PAUSES or RESUMES it in place, so you can run a few images with a lora
// and a few without, never reopening the popup to add it back. Model/clip
// strengths sit on the card too. The popup is the only place that lists ALL
// loras: tap one there to add it to the palette, ✕ on a card removes it.
// The PALETTE is derived, never read off the draft: loras that are ON, plus the
// ones paused in this session. Reading "every key in the record" was the bug —
// LorasVar writes `false` for every lora ever unticked, so a real draft with 35
// keys and 2 on showed all 35. A pause removes the key (and remembers the
// strength), so a draft only ever lists what is actually on. The 🖼/🏷
// toggles hide images/titles on every lora surface (NSFW screens, persisted on
// WebSt); with both hidden the row collapses to a count. Names come from
// descriptor optionLabels; the value keeps raw enum keys, replaced by copy
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
   /** strength of a PAUSED lora, so resuming restores it (LorasVar.prev) */
   prevStrength: Map<string, LoraStrengthPair>
   /** loras paused in THIS session: they leave the draft record but stay in the palette,
    * which is what makes "a few images with, a few without" one click each way */
   paused: Set<string>
   setOpen(open: boolean): void
   setFilter(raw: string): void
   noteInfo(name: string, v: LoraInfo | 'loading' | 'error'): void
   notePreviewFailed(name: string): void
   notePrevStrength(name: string, pair: LoraStrengthPair): void
   setPaused(name: string, paused: boolean): void
}

export const LorasControl = observer(function LorasControl(p: { v: VarSt; host: string; st: WebSt }) {
   const local = useLocalObservable<LocalSt>(() => ({
      open: false,
      filter: '',
      info: new Map(),
      previewFailed: new Set(),
      prevStrength: new Map(),
      paused: new Set(),
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
      setPaused(name: string, paused: boolean) {
         if (paused) this.paused.add(name)
         else this.paused.delete(name)
      },
   }))
   const record = asRecord(p.v.value)
   const options = p.v.desc.options ?? []
   const labels = p.v.desc.optionLabels ?? {}
   const label = (name: string): string => labels[name] ?? name
   // the PALETTE is what the row shows: the loras that are ON, plus the ones paused in this
   // session. It is NOT "every key in the record" — LorasVar writes `false` for every lora
   // ever unticked, so that reading put the whole catalog in the row (his repro: a draft
   // with 35 keys and 2 on). A paused lora leaves the record entirely and lives here instead
   const isOn = (name: string): boolean => loraIsOn(record[name])
   const isInPalette = (name: string): boolean => isOn(name) || local.paused.has(name)
   const selectedNames = options.filter(isInPalette)
   const showImages = p.st.showLoraImages
   const showTitles = p.st.showLoraTitles

   /** add to the palette (a strength) or REMOVE from it entirely (null) */
   const setEntry = (name: string, st: LoraStrength | null): void => {
      local.setPaused(name, false)
      const next = { ...record }
      if (st == null) delete next[name]
      else next[name] = st
      p.v.set(next)
   }
   const toggleOn = (name: string, on: boolean): void => {
      if (!on) local.notePrevStrength(name, loraStrengthPair(record[name]))
      local.setPaused(name, !on)
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

   /** model/clip inputs. A PAUSED lora still edits its strengths — they are what comes back */
   const strengthInputs = (name: string): ReactNode => {
      const pair = isOn(name) ? loraStrengthPair(record[name]) : (local.prevStrength.get(name) ?? { model: 1, clip: 1 })
      return (
         <>
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
   const cards = matches.filter((o) => !isInPalette(o)).slice(0, CARD_CAP)

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
                  {selectedNames.length} lora{selectedNames.length === 1 ? '' : 's'} in the palette
               </span>
            ) : (
               selectedNames.map((name) => (
                  <span
                     key={name}
                     className={`${showImages ? 'lora-chip card' : 'lora-chip'}${isOn(name) ? '' : ' off'}`}
                  >
                     {/* THE palette gesture: the card itself pauses and resumes, so trying a
                         few images with a lora and a few without never opens the popup */}
                     <button
                        type="button"
                        className="lora-toggle"
                        title={isOn(name) ? `${name}\nclick to pause` : `${name}\npaused — click to resume`}
                        onClick={() => toggleOn(name, !isOn(name))}
                     >
                        {thumb(name)}
                        {showTitles ? <span className="chip-title">{label(name)}</span> : null}
                        <span className="chip-state">{isOn(name) ? '● on' : '⏸ paused'}</span>
                     </button>
                     <span className="chip-controls">
                        {strengthInputs(name)}
                        <button
                           type="button"
                           title="remove from the palette (the popup adds it back)"
                           onClick={() => setEntry(name, null)}
                        >
                           ✕
                        </button>
                     </span>
                  </span>
               ))
            )}
            <button type="button" onClick={() => local.setOpen(true)}>
               {selectedNames.length === 0 ? `add loras… (${options.length})` : '+ add…'}
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
                           <div className="section-title">your palette ({selectedNames.length})</div>
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
                                    <input
                                       type="checkbox"
                                       checked={isOn(name)}
                                       title={isOn(name) ? 'pause (stays in the palette)' : 'resume'}
                                       onChange={(e) => toggleOn(name, e.target.checked)}
                                    />
                                    {strengthInputs(name)}
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
                     <div className="section-title">all loras — tap to add to the palette</div>
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
