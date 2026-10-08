// the one open confirm or text prompt (state/dialog.ts), above every modal. Enter and esc are
// caught on the window in the CAPTURE phase, so the modal under it never sees them (esc there
// would close the enhancer along with the dialog)
import { observer } from 'mobx-react-lite'
import { useEffect } from 'react'
import { dialogs } from 'src/cli/serve/web/state/dialog.ts'
import { onEscape } from 'src/cli/serve/web/state/escape.ts'

export const DialogLayer = observer(function DialogLayer() {
   const c = dialogs.current
   const open = c != null
   useEffect(() => {
      if (!open) return
      const onKey = (ev: KeyboardEvent): void => {
         const handled =
            onEscape(ev, () => dialogs.cancel()) ||
            (ev.key === 'Enter' && !ev.isComposing && (ev.preventDefault(), dialogs.accept(), true))
         if (handled) ev.stopPropagation()
      }
      window.addEventListener('keydown', onKey, true)
      return () => window.removeEventListener('keydown', onKey, true)
   }, [open])
   if (c == null) return null
   return (
      <div className="modal-overlay dialog-overlay" onClick={() => dialogs.cancel()}>
         <div className="modal dialog-modal" role="dialog" onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-body dialog-body">
               <div className="dialog-message">{c.message}</div>
               {c.kind === 'prompt' ? (
                  <input
                     type="text"
                     autoFocus
                     value={c.value}
                     onFocus={(ev) => ev.currentTarget.select()}
                     onChange={(ev) => dialogs.setValue(ev.target.value)}
                  />
               ) : null}
            </div>
            <div className="dialog-actions">
               <button type="button" onClick={() => dialogs.cancel()}>
                  cancel
               </button>
               <button
                  type="button"
                  autoFocus={c.kind === 'confirm'}
                  className={c.kind === 'confirm' && c.danger ? 'dialog-danger' : 'primary'}
                  onClick={() => dialogs.accept()}
               >
                  {c.kind === 'confirm' ? c.ok : 'ok'}
               </button>
            </div>
         </div>
      </div>
   )
})
