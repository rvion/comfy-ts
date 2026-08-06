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
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { logWebError } from 'src/cli/serve/web/logWeb.ts'
import { observer, useLocalObservable } from 'mobx-react-lite'
import { useEffect, useRef, type ReactNode } from 'react'
import { fetchLoraAbout, fetchLoraInfo, loraPreviewSrc, type LoraAbout, type LoraInfo } from 'src/cli/serve/web/api.ts'
import type { LoraStrength } from 'src/vars/ComfyVars.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'
import {
   loraIsOn,
   paletteOrder,
   reorderLoras,
   loraStrengthPair,
   setLoraEnabled,
   setLoraStrength,
   type LoraStrengthPair,
} from 'src/cli/serve/web/state/payload.ts'

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
   /** the lora whose details panel is open, null when none */
   details: string | null
   setDetails(name: string | null): void
   /** model and clip shown APART, per lora. Absent = follow whether they already differ */
   split: Map<string, boolean>
   isSplit(name: string, whenUnset: boolean): boolean
   setSplit(name: string, split: boolean): void
}

export const LorasControl = observer(function LorasControl(p: {
   v: VarSt
   host: string
   st: WebSt
   hostUrl: string | null
}) {
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
      details: null,
      setDetails(name: string | null) {
         this.details = name
      },
      split: new Map(),
      isSplit(name: string, whenUnset: boolean) {
         return this.split.get(name) ?? whenUnset
      },
      setSplit(name: string, split: boolean) {
         this.split.set(name, split)
      },
   }))
   const record = asRecord(p.v.value)
   const options = p.v.desc.options ?? []
   const labels = p.v.desc.optionLabels ?? {}
   const label = (name: string): string => labels[name] ?? name
   // the PALETTE is what the row shows: the loras that are ON, plus the ones paused in this
   // session. It is NOT "every key in the record" — LorasVar writes `false` for every lora
   // ever unticked, so that reading put the whole catalog in the row (a real draft
   // with 35 keys and 2 on). A paused lora leaves the record entirely and lives here instead
   const isOn = (name: string): boolean => loraIsOn(record[name])
   const isInPalette = (name: string): boolean => isOn(name) || local.paused.has(name)
   // NEWEST FIRST: the record keeps insertion order, so the lora you just added is the last
   // key — reversed, it lands where you are looking instead of at the end of the row
   const selectedNames = paletteOrder({ record, options, paused: local.paused })
   /** known to the lora manager, absent from ComfyUI's own enum: usually still runs, since the
    * file is on disk and only the server's list is stale — so it is offered, not hidden */
   const managerOnly = new Set(p.v.desc.managerOnlyOptions ?? [])
   const MANAGER_ONLY_TIP = 'only according to the lora manager, not yet listed by comfy itself'
   const warnBadge = (name: string): ReactNode =>
      managerOnly.has(name) ? (
         <span className="lora-warn" data-tip={MANAGER_ONLY_TIP}>
            <Icon name="warn" size={0.9} />
         </span>
      ) : null
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

   /** ONE slider by default, labelled `m+c`: model and clip are the same number in almost every
    * lora, and two sliders for one decision is noise. Clicking the label splits them, and a lora
    * whose values already differ opens split — its setting is someone's work, not a default */
   const strengthInputs = (name: string): ReactNode => {
      const pair = isOn(name) ? loraStrengthPair(record[name]) : (local.prevStrength.get(name) ?? { model: 1, clip: 1 })
      const split = local.isSplit(name, pair.model !== pair.clip)
      const write = (which: 'model' | 'clip' | 'both', raw: number): void => {
         if (!Number.isFinite(raw)) return
         const n = Math.round(raw * 100) / 100
         if (which === 'both') return setStrength(name, { model: n, clip: n })
         setStrength(name, which === 'model' ? { model: n, clip: pair.clip } : { model: pair.model, clip: n })
      }
      const line = (which: 'model' | 'clip' | 'both', value: number, text: string, tip: string): ReactNode => (
         <div className="st-line">
            <button type="button" className="st-label" data-tip={tip} onClick={() => local.setSplit(name, !split)}>
               {text}
            </button>
            <input
               type="range"
               min={-1}
               max={2}
               step={0.05}
               value={value}
               onChange={(e) => write(which, parseFloat(e.target.value))}
            />
            <input type="number" step={0.05} value={value} onChange={(e) => write(which, parseFloat(e.target.value))} />
         </div>
      )
      if (!split) return line('both', pair.model, 'm+c', 'model and clip together — click to set them apart')
      return (
         <>
            {line('model', pair.model, 'm', 'model strength — click to tie them back together')}
            {line('clip', pair.clip, 'c', 'clip strength — click to tie them back together')}
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
   const cardCap = p.st.loraCap
   const cards = matches.filter((o) => !isInPalette(o)).slice(0, cardCap)
   /** the enum value IS a path (`krea2\styles\x.safetensors`, separators vary by host and by
    * where the name came from), so the folder is everything before the last separator */
   const folderOf = (name: string): string => {
      const parts = name.split(/[\\/]+/)
      return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
   }
   const groupedCards = (() => {
      const byFolder = new Map<string, string[]>()
      for (const name of cards) {
         const folder = folderOf(name)
         const list = byFolder.get(folder)
         if (list == null) byFolder.set(folder, [name])
         else list.push(name)
      }
      return [...byFolder.entries()]
         .map(([folder, names]) => ({ folder, names }))
         .sort((a, b) => a.folder.localeCompare(b.folder))
   })()

   // opening the popup puts you IN the filter with the previous needle SELECTED, so typing
   // replaces it instead of appending to it (the field keeps its text between opens)
   const filterRef = useRef<HTMLInputElement>(null)
   useEffect(() => {
      if (!open) return
      const input = filterRef.current
      if (input == null) return
      input.focus()
      input.select()
   }, [open])

   /** enter takes the FIRST card, the one the eye lands on. The popup stays open with the
    * needle reselected, so adding three loras is type-enter-type-enter, and the new entry
    * is visible at once in the palette section above */
   const addFirstMatch = (): void => {
      const first = cards[0]
      if (first == null) return
      // the SAME call the card's own click makes, so enter and a tap cannot drift apart
      setEntry(first, [1, 1])
      filterRef.current?.select()
   }

   const thumb = (name: string): ReactNode => {
      if (!showImages) return null
      return local.previewFailed.has(name) ? (
         <div className="lora-thumb none">no preview</div>
      ) : (
         <img
            key={name}
            className={p.st.loraFill ? 'lora-thumb fill' : 'lora-thumb'}
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
            data-tip={showImages ? 'hide lora images' : 'show lora images'}
            onClick={() => p.st.toggleLoraImages()}
         >
            <Icon name="image" />
         </button>
         <button
            type="button"
            className={showTitles ? 'mode sel' : 'mode'}
            data-tip={showTitles ? 'hide lora titles' : 'show lora titles'}
            onClick={() => p.st.toggleLoraTitles()}
         >
            <Icon name="tag" />
         </button>
         {/* cover vs contain: a style lora's art crops beautifully and a character sheet does
             not, so which one is right is per collection, not something to decide here */}
         {showImages ? (
            <button
               type="button"
               className={p.st.loraFill ? 'mode sel' : 'mode'}
               data-tip={p.st.loraFill ? 'fit the whole preview inside the card' : 'fill the card with the preview'}
               onClick={() => p.st.toggleLoraFill()}
            >
               <Icon name={p.st.loraFill ? 'shrink' : 'expand'} />
            </button>
         ) : null}
      </>
   )

   return (
      <div>
         {/* the controls sit ABOVE the palette, left aligned: after a row of cards they read as
             an afterthought, and a centred trio of buttons has nothing to align with */}
         <div className="lora-actions">
            <button type="button" className="field-height" onClick={() => local.setOpen(true)}>
               <Icon name="plus" /> {selectedNames.length === 0 ? `add loras (${options.length})` : 'add'}
            </button>
            <span className="btn-group field-height">{visibilityToggles}</span>
            {/* the host's OWN lora manager: where you tag, rename and re-scan them. Same host
                the runs go to, so the page you open is the one that owns these files */}
            <button
               type="button"
               className="field-height"
               disabled={p.st.loraSyncing}
               data-tip="re-download the lora metadata from the lora manager on this host (names, trigger words, previews)"
               onClick={() => void p.st.refreshLoras()}
            >
               <Icon name="refresh" /> {p.st.loraSyncing ? 'syncing…' : 'sync'}
            </button>
            {p.hostUrl == null ? null : (
               <a
                  className="button-link field-height"
                  href={`${p.hostUrl}/loras`}
                  target="_blank"
                  rel="noreferrer"
                  data-tip="open the lora manager of this host in a new tab"
               >
                  <Icon name="external" /> manager
               </a>
            )}
            {selectedNames.length > 0 ? (
               <span className="hint">
                  {selectedNames.length} in the palette · {selectedNames.filter(isOn).length} on
               </span>
            ) : null}
            {/* the workflow's own narrowing, said out loud: a picker that shows 200 loras when
                the var asked for krea2 ones is not explainable */}
            {p.v.desc.optionsFilter == null ? null : (
               <span
                  className="hint"
                  data-tip="this workflow declared v.loras(<regex>) — only matching loras are offered"
               >
                  filter {p.v.desc.optionsFilter}
               </span>
            )}
         </div>
         <div className="row-inline">
            {!showImages && !showTitles ? (
               <span className="hint">
                  {selectedNames.length} lora{selectedNames.length === 1 ? '' : 's'} in the palette
               </span>
            ) : (
               selectedNames.map((name, ix) => (
                  <span
                     key={name}
                     className={`${showImages ? 'lora-chip card' : 'lora-chip'}${isOn(name) ? '' : ' off'}`}
                     draggable
                     onMouseDown={(e) => {
                        // the WHOLE card drags, so the browser hands it the pointer before any
                        // control below sees it, and a slider drag would only reorder the card.
                        // Disarm for this gesture when it starts on an input: recomputed on every
                        // mousedown, so there is no armed/disarmed state to leak
                        const from = e.target as HTMLElement
                        // buttons too (✕, the m+c label): a press that drifts a pixel would
                        // otherwise start a reorder instead of firing the click
                        e.currentTarget.draggable = from.closest('input, label, button, select, a') == null
                     }}
                     // re-arm once the gesture is over, so the grab cursor comes back the
                     // moment you leave the slider
                     onMouseUp={(e) => {
                        e.currentTarget.draggable = true
                     }}
                     onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        // the index travels in the drag itself: no drag state to leak or reset
                        e.dataTransfer.setData('text/plain', String(ix))
                     }}
                     onDragOver={(e) => e.preventDefault()}
                     onDrop={(e) => {
                        e.preventDefault()
                        const from = Number(e.dataTransfer.getData('text/plain'))
                        if (Number.isInteger(from) && from !== ix)
                           p.v.set(reorderLoras({ record, displayed: selectedNames, from, to: ix }))
                     }}
                  >
                     {/* the ✕ is a child of the PICTURE's own box, never of the card: its
                         containing block is then this wrapper whatever else is positioned
                         around it, so it cannot take a row of flow nor escape the card */}
                     <span className="chip-media">
                        {/* the CARD opens what this lora is; only the switch turns it on and off,
                            so reading about a lora can never change what the graph runs */}
                        <button
                           type="button"
                           className="lora-toggle"
                           data-tip={`${name}\nclick for its details`}
                           onClick={() => local.setDetails(name)}
                        >
                           {thumb(name)}
                        </button>
                        <button
                           type="button"
                           className="chip-remove"
                           data-tip="remove from the palette (the popup adds it back)"
                           onClick={() => setEntry(name, null)}
                        >
                           <Icon name="close" size={1.05} />
                        </button>
                     </span>
                     {/* the switch sits WITH the title: state and name read as one line */}
                     <span className="chip-head">
                        <label className="switch" data-tip={isOn(name) ? 'pause this lora' : 'resume this lora'}>
                           <input
                              type="checkbox"
                              checked={isOn(name)}
                              onChange={(e) => toggleOn(name, e.target.checked)}
                           />
                           <span className="track" />
                        </label>
                        {showTitles ? (
                           <button
                              type="button"
                              className="chip-title as-text"
                              data-tip={`${name}\nclick for its details`}
                              onClick={() => local.setDetails(name)}
                           >
                              {label(name)}
                           </button>
                        ) : null}
                        {warnBadge(name)}
                     </span>
                     <span className="chip-controls">{strengthInputs(name)}</span>
                  </span>
               ))
            )}
         </div>

         {local.details == null ? null : (
            <LoraDetails
               name={local.details}
               host={p.host}
               hostUrl={p.hostUrl}
               label={label(local.details)}
               showImage={showImages}
               keyword={(p.v.desc.optionKeywords ?? {})[local.details] ?? null}
               managerOnly={managerOnly.has(local.details)}
               onClose={() => local.setDetails(null)}
            />
         )}
         {local.open ? (
            <div className="modal-overlay" onClick={() => local.setOpen(false)}>
               <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-head">
                     <input
                        ref={filterRef}
                        type="text"
                        placeholder={`search ${options.length} loras${p.v.desc.optionsFilter == null ? '' : ` matching ${p.v.desc.optionsFilter}`} — enter adds the first`}
                        value={local.filter}
                        onChange={(e) => local.setFilter(e.target.value)}
                        onKeyDown={(e) => {
                           if (e.key !== 'Enter') return
                           e.preventDefault()
                           addFirstMatch()
                        }}
                     />
                     {visibilityToggles}
                     <button type="button" data-tip="close (esc)" onClick={() => local.setOpen(false)}>
                        <Icon name="close" />
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
                                       <div className="lora-label" data-tip={name}>
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
                                       data-tip={isOn(name) ? 'pause (stays in the palette)' : 'resume'}
                                       onChange={(e) => toggleOn(name, e.target.checked)}
                                    />
                                    {strengthInputs(name)}
                                    <button
                                       type="button"
                                       className="chip-remove"
                                       data-tip="remove from the list"
                                       onClick={() => setEntry(name, null)}
                                    >
                                       <Icon name="close" size={0.9} />
                                    </button>
                                 </div>
                              )
                           })}
                        </div>
                     ) : null}
                     <div className="section-title">all loras — tap to add to the palette</div>
                     {groupedCards.map((group) => (
                        <div key={group.folder}>
                           <div className="section-title">
                              {group.folder === '' ? 'loose (no folder)' : `${group.folder}/`} · {group.names.length}
                           </div>
                           <div className="lora-grid">
                              {group.names.map((name) => (
                                 <button
                                    key={name}
                                    type="button"
                                    className="lora-card"
                                    data-tip={name}
                                    onClick={() => setEntry(name, [1, 1])}
                                 >
                                    {thumb(name)}
                                    <div className="lora-label">
                                       {showTitles ? label(name) : name.slice(0, 2) + '···'}
                                       {warnBadge(name)}
                                    </div>
                                 </button>
                              ))}
                           </div>
                        </div>
                     ))}
                     {matches.length - selectedNames.filter(matchesFilter).length > cardCap ? (
                        <div className="loras-more">
                           … {matches.length - selectedNames.filter(matchesFilter).length - cardCap} more — refine the
                           filter, or draw
                           <input
                              type="number"
                              min={1}
                              max={2000}
                              value={cardCap}
                              data-tip="how many cards this popup draws — each one is an image request, so the right number depends on your collection and your box. Kept in this browser"
                              onChange={(e) => p.st.setLoraCap(parseInt(e.target.value, 10))}
                           />
                           at once
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

/** what a lora IS, from the lora-manager mirror: clicking a card opens this instead of
 * silently toggling the graph. Everything shown comes from the mirror, so an unsynced lora
 * says so rather than rendering an empty sheet */
const LoraDetails = observer(function LoraDetails(p: {
   name: string
   host: string
   hostUrl: string | null
   label: string
   showImage: boolean
   keyword: string | null
   managerOnly: boolean
   onClose(): void
}) {
   const local = useLocalObservable<{
      info: LoraInfo | 'loading' | 'error'
      about: LoraAbout | null
      aboutError: string | null
      set(v: LoraInfo | 'loading' | 'error'): void
      setAbout(v: LoraAbout | null): void
      setAboutError(msg: string): void
   }>(() => ({
      info: 'loading',
      about: null,
      aboutError: null,
      set(v) {
         this.info = v
      },
      setAbout(v) {
         this.about = v
         this.aboutError = null
      },
      setAboutError(msg: string) {
         this.about = null
         this.aboutError = msg
      },
   }))
   const { name, host } = p
   useEffect(() => {
      // the panel is ONE instance reused across loras, and /lora-about is a live host round
      // trip: without this guard, opening A then B within A's latency painted A's description
      // and example images under B's title
      let current = true
      local.set('loading')
      local.setAbout(null)
      fetchLoraInfo({ host, name })
         .then((i) => {
            if (current) local.set(i)
         })
         .catch((e: unknown) => {
            if (current) local.set('error')
            logWebError(`lora info for ${name}`, e)
         })
      // the LIVE half (civitai description + example images) arrives second: the mirror data
      // must not wait on a host round trip to render
      fetchLoraAbout({ host, name })
         .then((a) => {
            if (current) local.setAbout(a)
         })
         .catch((e: unknown) => {
            // an empty sheet reads as "this lora has nothing to say", which is a different
            // fact from "the extension did not answer"
            if (current) local.setAboutError(e instanceof Error ? e.message : String(e))
            logWebError(`lora details for ${name}`, e)
         })
      return () => {
         current = false
      }
   }, [host, name, local])
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Escape') p.onClose()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [p])
   const info = local.info
   const row = (k: string, v: ReactNode): ReactNode =>
      v == null || v === '' ? null : (
         <div className="detail-row">
            <span className="detail-key">{k}</span>
            <span className="detail-val">{v}</span>
         </div>
      )
   return (
      <div className="modal-overlay" onClick={() => p.onClose()}>
         <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
               <b style={{ flex: 1 }}>{p.label}</b>
               <button type="button" data-tip="close (esc)" onClick={() => p.onClose()}>
                  <Icon name="close" />
               </button>
            </div>
            <div className="modal-body">
               {info === 'loading' ? <div className="hint">reading the mirror…</div> : null}
               {info === 'error' ? <div className="error">🔴 could not read this lora's metadata</div> : null}
               {typeof info === 'object' ? (
                  <div className="lora-details">
                     {p.showImage ? (
                        <img className="detail-thumb" src={loraPreviewSrc({ host, name })} alt={p.label} />
                     ) : null}
                     <div className="detail-list">
                        {info.known === false ? (
                           <div className="hint">
                              not in the lora manager mirror — run sync, or this file is unknown to it
                           </div>
                        ) : null}
                        {p.managerOnly ? <div className="hint">⚠ only the lora manager lists it, not comfy</div> : null}
                        {row('file', name)}
                        {row('base model', info.baseModel)}
                        {row('folder', info.folder)}
                        {row('trigger words', info.triggerWords.join(', '))}
                        {row('prompt keyword', p.keyword)}
                        {row('tags', (info.tags ?? []).join(', '))}
                        {row('notes', info.notes)}
                        {row('size', info.fileSize == null ? null : `${(info.fileSize / 1e9).toFixed(2)} GB`)}
                        {row('path', info.filePath)}
                        {local.about?.description == null ? null : (
                           <div className="detail-desc">{local.about.description}</div>
                        )}
                        {row(
                           'civitai',
                           info.civitaiUrl == null ? null : (
                              <a href={info.civitaiUrl} target="_blank" rel="noreferrer">
                                 {info.civitaiVersion ?? 'model page'} ↗
                              </a>
                           ),
                        )}
                        {local.about != null && local.about.examples.length > 0 ? (
                           <div>
                              <div className="section-title">examples ({local.about.examples.length})</div>
                              <div className="detail-examples">
                                 {local.about.examples.slice(0, 8).map((src) => (
                                    <img key={src} src={src} alt="" loading="lazy" />
                                 ))}
                              </div>
                           </div>
                        ) : null}
                        {local.about?.examplesReason == null ? null : (
                           <div className="hint">no example images: {local.about.examplesReason}</div>
                        )}
                        {/* an empty sheet reads as "this lora has nothing to say"; that the
                            extension never answered is a different fact and must be said */}
                        {local.aboutError == null ? null : (
                           <div className="error">🔴 the lora manager did not answer: {local.aboutError}</div>
                        )}
                        {p.hostUrl == null ? null : (
                           <a className="button-link" href={`${p.hostUrl}/loras`} target="_blank" rel="noreferrer">
                              <Icon name="external" /> open in the lora manager
                           </a>
                        )}
                     </div>
                  </div>
               ) : null}
            </div>
         </div>
      </div>
   )
})
