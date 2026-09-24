// the history picker: every value submitted this page, searchable. Two columns: the matches on
// the left (first line, how long ago, where from), the FULL text of the highlighted one on the
// right, so arrowing down previews exactly what a pick writes. Enter or a click picks
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { searchHistory, timeAgo, type HistoryEntry } from 'src/cli/serve/web/state/history.ts'

/** the button that opens it: always there, disabled while nothing was submitted yet. Plain (not
 * an observer) to stay generic: the observer parent reads the list and passes it down */
export function HistoryButton<V>(p: {
   entries: readonly HistoryEntry<V>[]
   what: string
   onPick(entry: HistoryEntry<V>): void
   compact?: boolean
}): ReactNode {
   const [open, setOpen] = useState(false)
   const n = p.entries.length
   return (
      <>
         <button
            type="button"
            className={p.compact === true ? 'link' : 'mini'}
            disabled={n === 0}
            data-tip={
               n === 0
                  ? `every ${p.what} you submit shows here, until you close the page`
                  : `${n} past ${p.what}s: search, preview, restore`
            }
            onClick={() => setOpen(true)}
         >
            <Icon name="history" />
            {p.compact === true ? null : ' history'}
         </button>
         {open ? (
            <HistoryPicker
               entries={p.entries}
               what={p.what}
               onPick={(e) => {
                  setOpen(false)
                  p.onPick(e)
               }}
               onClose={() => setOpen(false)}
            />
         ) : null}
      </>
   )
}

function HistoryPicker<V>(p: {
   entries: readonly HistoryEntry<V>[]
   what: string
   onPick(entry: HistoryEntry<V>): void
   onClose(): void
}): ReactNode {
   const [query, setQuery] = useState('')
   const [cursor, setCursor] = useState(0)
   const [now, setNow] = useState(() => Date.now())
   const listRef = useRef<HTMLDivElement>(null)
   const matches = searchHistory(p.entries, query)
   const sel = matches[Math.min(cursor, Math.max(0, matches.length - 1))] ?? null
   // "3 min ago" keeps being true while the picker stays open
   useEffect(() => {
      const t = setInterval(() => setNow(Date.now()), 10_000)
      return () => clearInterval(t)
   }, [])
   // esc closes THIS, never the modal under it (the enhancer listens on window too): a capture
   // listener runs first and stops the event there
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         if (e.key !== 'Escape') return
         e.stopImmediatePropagation()
         p.onClose()
      }
      window.addEventListener('keydown', onKey, true)
      return () => window.removeEventListener('keydown', onKey, true)
   }, [p])
   useEffect(() => {
      listRef.current?.querySelector('.hist-row.sel')?.scrollIntoView({ block: 'nearest' })
   }, [cursor, query])
   const move = (delta: number): void => setCursor((c) => Math.max(0, Math.min(matches.length - 1, c + delta)))
   return (
      <div className="modal-overlay top hist-overlay" onClick={() => p.onClose()}>
         <div className="modal hist-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
               <Icon name="history" />
               <input
                  type="text"
                  autoFocus
                  placeholder={`search ${p.entries.length} past ${p.what}s, every word must match`}
                  value={query}
                  onChange={(e) => {
                     setQuery(e.target.value)
                     setCursor(0)
                  }}
                  onKeyDown={(e) => {
                     if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        move(1)
                     } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        move(-1)
                     } else if (e.key === 'Enter') {
                        e.preventDefault()
                        if (sel != null) p.onPick(sel)
                     }
                  }}
               />
               <button type="button" className="modal-close" data-tip="close (esc)" onClick={() => p.onClose()}>
                  <Icon name="close" />
               </button>
            </div>
            <div className="hist-cols">
               <div className="hist-list" ref={listRef}>
                  {matches.length === 0 ? <div className="hist-empty">nothing matches '{query}'</div> : null}
                  {matches.map((e, ix) => (
                     <button
                        key={e.text}
                        type="button"
                        className={e === sel ? 'hist-row sel' : 'hist-row'}
                        onMouseEnter={() => setCursor(ix)}
                        onClick={() => p.onPick(e)}
                     >
                        <span className="hist-first">{e.text.split('\n')[0]}</span>
                        <span className="hist-meta">
                           {timeAgo(e.at, now)}
                           {e.count > 1 ? ` · ${e.count}×` : ''}
                           {e.source === '' ? '' : ` · ${e.source}`}
                        </span>
                     </button>
                  ))}
               </div>
               <div className="hist-preview">
                  {sel == null ? null : (
                     <>
                        <pre className="hist-text">{sel.text}</pre>
                        <div className="hist-foot">
                           <span className="hint">↑↓ to preview, enter or click to restore</span>
                           <button type="button" className="primary" onClick={() => p.onPick(sel)}>
                              restore this {p.what}
                           </button>
                        </div>
                     </>
                  )}
               </div>
            </div>
         </div>
      </div>
   )
}
