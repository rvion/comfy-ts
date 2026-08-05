// loras: the form row shows the ACTIVE loras as the same preview cards as the
// popup (image + display name + ✕); the 🖼/🏷 toggles hide images/titles on
// EVERY lora surface (NSFW screens, persisted on WebSt) and with both hidden
// the row collapses to a count. The popup owns editing: filter, active section
// with strengths + trigger words, preview-card gallery (tap ACTIVATES; the
// active section deactivates). Names come from descriptor optionLabels; the
// value keeps raw enum keys: { "<name>": [model, clip] }, replaced by copy
import { observer, useLocalObservable } from 'mobx-react-lite'
import { useEffect, type ReactNode } from 'react'
import { fetchLoraInfo, loraPreviewSrc, type LoraInfo } from 'src/cli/serve/web/api.ts'
import type { LoraStrength } from 'src/vars/ComfyVars.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const CARD_CAP = 60

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

type LocalSt = {
   open: boolean
   filter: string
   info: Map<string, LoraInfo | 'loading' | 'error'>
   previewFailed: Set<string>
   setOpen(open: boolean): void
   setFilter(raw: string): void
   noteInfo(name: string, v: LoraInfo | 'loading' | 'error'): void
   notePreviewFailed(name: string): void
}

export const LorasControl = observer(function LorasControl(p: { v: VarSt; host: string; st: WebSt }) {
   const local = useLocalObservable<LocalSt>(() => ({
      open: false,
      filter: '',
      info: new Map(),
      previewFailed: new Set(),
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
   }))
   const record = asRecord(p.v.value)
   const options = p.v.desc.options ?? []
   const labels = p.v.desc.optionLabels ?? {}
   const label = (name: string): string => labels[name] ?? name
   const isActive = (name: string): boolean => record[name] != null && record[name] !== false
   const activeNames = options.filter(isActive)
   const showImages = p.st.showLoraImages
   const showTitles = p.st.showLoraTitles

   const setEntry = (name: string, st: LoraStrength | null): void => {
      const next = { ...record }
      if (st == null) delete next[name]
      else next[name] = st
      p.v.set(next)
   }

   // trigger words for the active section load once per open (bounded: active loras only)
   const open = local.open
   const host = p.host
   const activeKey = activeNames.join('\n')
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
   const cards = matches.filter((o) => !isActive(o)).slice(0, CARD_CAP)

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
                  {activeNames.length} lora{activeNames.length === 1 ? '' : 's'} selected
               </span>
            ) : (
               activeNames.map((name) => (
                  <span key={name} className={showImages ? 'lora-chip card' : 'lora-chip'} title={name}>
                     {thumb(name)}
                     {showTitles ? <span className="chip-title">{label(name)}</span> : null}
                     <button type="button" title="remove" onClick={() => setEntry(name, null)}>
                        ✕
                     </button>
                  </span>
               ))
            )}
            <button type="button" onClick={() => local.setOpen(true)}>
               {activeNames.length === 0 ? `choose loras… (${options.length})` : 'edit…'}
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
                     {activeNames.length > 0 ? (
                        <div className="lora-active-section">
                           <div className="section-title">active ({activeNames.length})</div>
                           {activeNames.filter(matchesFilter).map((name) => {
                              const pair = strengthPair(record[name])
                              const info = local.info.get(name)
                              return (
                                 <div key={name} className="lora-active-row">
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
                                    <button type="button" title="deactivate" onClick={() => setEntry(name, null)}>
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
                     {matches.length - activeNames.filter(matchesFilter).length > CARD_CAP ? (
                        <div className="loras-more">
                           … {matches.length - activeNames.filter(matchesFilter).length - CARD_CAP} more — refine the
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
