// ⌘K / ⌘J: type a few letters of any folder, workflow, draft or tag, Enter opens it.
// a workflow row (icon, path, tag chips) then its drafts indented. Modules that failed to
// load are listed under the matches, since nothing else shows them
import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { Icon, type IconName } from 'src/cli/serve/web/components/Icon.tsx'
import { entryKey, type OmniboxEntry } from 'src/cli/serve/web/state/omnibox.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

/** the first media tag picks the icon: what the workflow makes */
const ICON_BY_TAG: Record<string, IconName> = { image: 'image', audio: 'audio', video: 'video', text: 'text' }

function workflowIcon(tags: readonly string[]): IconName {
   for (const t of tags) {
      const icon = ICON_BY_TAG[t]
      if (icon != null) return icon
   }
   return 'workflow'
}

/** the tags with their own color; any other tag is a neutral chip */
const TINTED = new Set(['image', 'audio', 'video', 'text', 'llm', 'edit'])

function OmniRow(p: { entry: OmniboxEntry; sel: boolean; open: boolean; words: string[]; onPick: () => void }) {
   const e = p.entry
   const cls = ['omni-row', e.kind, p.sel ? 'sel' : '', p.open ? 'open' : ''].join(' ')
   if (e.kind === 'draft')
      return (
         <button type="button" className={cls} onClick={p.onPick}>
            <Icon name="draft" size={0.95} />
            <span className="omni-draft">{e.draft}</span>
            {p.open ? <span className="omni-open">open</span> : null}
         </button>
      )
   return (
      <button type="button" className={cls} onClick={p.onPick}>
         <span className={`omni-icon tint-${workflowIcon(e.tags)}`}>
            <Icon name={workflowIcon(e.tags)} />
         </span>
         <span className="omni-path">
            {e.folder === '' ? null : <span className="omni-folder">{e.folder} / </span>}
            <span className="omni-name">{e.module}</span>
         </span>
         <span className="omni-tags">
            {e.tags.map((t) => (
               <span
                  key={t}
                  className={['omni-tag', TINTED.has(t) ? `tint-${t}` : '', p.words.includes(t) ? 'hit' : ''].join(' ')}
               >
                  {t}
               </span>
            ))}
            <span className="omni-host">{e.host}</span>
         </span>
      </button>
   )
}

/** ⌘K and ⌘J (ctrl on other systems) from ANY focus, a text field included: it is a jump,
 * not an edit, and the prompt textarea is where the focus usually is */
export function useOmniboxShortcut(st: WebSt): void {
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
         if (e.key !== 'k' && e.key !== 'K' && e.key !== 'j' && e.key !== 'J') return
         e.preventDefault()
         st.omnibox.toggle()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [st])
}

export const Omnibox = observer(function Omnibox(p: { st: WebSt }) {
   const o = p.st.omnibox
   const listRef = useRef<HTMLDivElement>(null)
   // the lit row stays in view while arrowing through a long list
   useEffect(() => {
      listRef.current?.querySelector('.omni-row.sel')?.scrollIntoView({ block: 'nearest' })
   }, [o.cursor, o.query])
   if (!o.isOpen) return null
   const results = o.results
   const errors = Object.entries(p.st.loadErrors)
   const current = p.st.form
   const words = o.query.trim().toLowerCase().split(/\s+/)
   return (
      <div className="modal-overlay omni-overlay" onClick={() => o.close()}>
         <div className="modal omni" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
               <input
                  type="text"
                  autoFocus
                  placeholder="workflow, draft or tag (audio, image, edit…)"
                  value={o.query}
                  onChange={(e) => o.setQuery(e.target.value)}
                  onKeyDown={(e) => {
                     if (e.key === 'ArrowDown') o.move(1)
                     else if (e.key === 'ArrowUp') o.move(-1)
                     else if (e.key === 'Enter') o.pick()
                     else if (e.key === 'Escape') o.close()
                     else return
                     e.preventDefault()
                  }}
               />
            </div>
            <div className="modal-body omni-list" ref={listRef}>
               {results.length === 0 ? <div className="hint">no workflow or draft matches</div> : null}
               {results.map((entry, ix) => (
                  <OmniRow
                     key={entryKey(entry)}
                     entry={entry}
                     sel={ix === o.cursor}
                     open={
                        entry.kind === 'draft' && current?.moduleKey === entry.module && current.draft === entry.draft
                     }
                     words={words}
                     onPick={() => o.pick(entry)}
                  />
               ))}
               {errors.length > 0 ? (
                  <div className="omni-errors">
                     <div className="section-title">failed to load</div>
                     {errors.map(([file, msg]) => (
                        <div key={file}>
                           <div className="file">{file}</div>
                           <div className="msg">{msg}</div>
                        </div>
                     ))}
                  </div>
               ) : null}
            </div>
         </div>
      </div>
   )
})
