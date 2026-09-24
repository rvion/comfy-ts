// ⌘K / ⌘J: type a few letters of any folder, workflow or draft, Enter opens it.
// modules that failed to load are listed under the matches, since nothing else shows them
import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

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
   return (
      <div className="modal-overlay omni-overlay" onClick={() => o.close()}>
         <div className="modal omni" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
               <input
                  type="text"
                  autoFocus
                  placeholder="workflow or draft…"
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
               {results.map((entry, ix) => {
                  const open = current?.moduleKey === entry.module && current.draft === entry.draft
                  const cls = ['omni-row', ix === o.cursor ? 'sel' : '', open ? 'open' : ''].join(' ')
                  return (
                     <button
                        key={`${entry.module}/${entry.draft}`}
                        type="button"
                        className={cls}
                        onClick={() => o.pick(entry)}
                     >
                        <span className="omni-label">{entry.label}</span>
                        <span className="omni-host">{open ? 'open' : entry.host}</span>
                     </button>
                  )
               })}
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
