// layout root: sidebar drawer + form column + results column (right on wide
// screens, below on narrow ones). NO title bar: the workflow head box opens the
// sidebar, so a permanent bar would only spend vertical space naming the app
import { observer } from 'mobx-react-lite'
import { useEffect } from 'react'
import { Gallery } from 'src/cli/serve/web/components/Gallery.tsx'
import { Sidebar } from 'src/cli/serve/web/components/Sidebar.tsx'
import { GenerateButton, VarsForm } from 'src/cli/serve/web/components/VarsForm.tsx'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

/** ⌘A / ctrl+A selects the field you are in. The browser does this on its own until something
 * on the page consumes the event, and this panel has several window-level key handlers plus a
 * drag layer over the rows, rather than hunt which one wins on which browser, the select is
 * performed explicitly. It runs ONLY when focus is already in a text field, so the
 * whole-page select-all everywhere else is untouched. */
function useSelectAllInFields(): void {
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         if (e.key !== 'a' && e.key !== 'A') return
         if (!e.metaKey && !e.ctrlKey) return
         if (e.altKey) return
         const el = document.activeElement
         const editable =
            el instanceof HTMLInputElement
               ? // a number/checkbox input has no text to select
                 el.type === 'text' || el.type === 'search' || el.type === 'password' || el.type === 'url'
               : el instanceof HTMLTextAreaElement
         if (!editable) return
         e.preventDefault()
         ;(el as HTMLInputElement | HTMLTextAreaElement).select()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [])
}

export const App = observer(function App(p: { st: WebSt }) {
   useSelectAllInFields()
   if (p.st.phase === 'loading') return <div className="center">loading…</div>
   if (p.st.phase === 'error')
      return (
         <div className="center">
            <div className="error">🔴 {p.st.bootError}</div>
         </div>
      )
   return (
      <div className="app">
         <div className="cols">
            {p.st.sidebarOpen ? <div className="backdrop" onClick={() => p.st.toggleSidebar()} /> : null}
            {p.st.sidebarOpen ? <Sidebar st={p.st} /> : null}
            <div className="main">
               {p.st.formError != null ? <div className="center error">🔴 {p.st.formError}</div> : null}
               {p.st.formLoading && p.st.form == null ? <div className="center">loading draft…</div> : null}
               {p.st.modules.length === 0 ? <div className="center">no workflow modules loaded</div> : null}
               {/* the layout buttons drive ONE class, and it is the whole truth: the selected
                   button always names where the panel is */}
               <div className={`work layout-${p.st.layout}`}>
                  <div className="form-col">
                     <VarsForm st={p.st} />
                     {/* the ComfyUI console, only while asked for (it polls) */}
                     {p.st.showLogs ? (
                        <div className="logs">
                           <div className="logs-head">
                              {/* the host the lines actually come from (pullLogs uses hostFor),
                                  not the module's declared default */}
                              <span>console · {p.st.hostFor(p.st.form?.moduleKey ?? '') || 'host'}</span>
                              <button type="button" className="link" onClick={() => p.st.toggleLogs()}>
                                 hide
                              </button>
                           </div>
                           {p.st.logsError != null ? <div className="error">🔴 {p.st.logsError}</div> : null}
                           <pre>{p.st.logLines.join('\n')}</pre>
                        </div>
                     ) : null}
                  </div>
                  {p.st.layout === 'off' ? null : (
                     <div className="results-col">
                        {p.st.generateInResults ? (
                           <div className="results-run">
                              <GenerateButton st={p.st} />
                              {p.st.run.error != null ? <span className="error">🔴 {p.st.run.error}</span> : null}
                           </div>
                        ) : null}
                        <Gallery st={p.st} compact={p.st.layout === 'pinned'} />
                     </div>
                  )}
               </div>
            </div>
         </div>
      </div>
   )
})
