// every key the panel binds, one popup, opened from the menu
import { observer } from 'mobx-react-lite'
import { useEffect } from 'react'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { shortcutCatalog } from 'src/cli/serve/web/state/shortcutCatalog.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export const ShortcutsModal = observer(function ShortcutsModal(p: { st: WebSt }) {
   const open = p.st.showShortcuts
   useEffect(() => {
      if (!open) return
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Escape') p.st.setShowShortcuts(false)
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [open, p.st])
   if (!open) return null
   return (
      <div className="modal-overlay top" onClick={() => p.st.setShowShortcuts(false)}>
         <div className="modal shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
               <Icon name="keyboard" />
               <span className="shortcuts-title">shortcuts</span>
               <button
                  type="button"
                  className="modal-close"
                  data-tip="close (esc)"
                  onClick={() => p.st.setShowShortcuts(false)}
               >
                  <Icon name="close" />
               </button>
            </div>
            <div className="shortcuts-body">
               {shortcutCatalog().map((g) => (
                  <section key={g.title} className="shortcuts-group">
                     <div className="menu-title">{g.title}</div>
                     {g.rows.map((r) => (
                        <div key={r.what} className="shortcuts-row">
                           <span className="shortcuts-keys">
                              {r.keys.map((k) => (
                                 <kbd key={k}>{k}</kbd>
                              ))}
                           </span>
                           <span>{r.what}</span>
                        </div>
                     ))}
                  </section>
               ))}
            </div>
         </div>
      </div>
   )
})
