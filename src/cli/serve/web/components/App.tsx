// layout root: sidebar drawer + form column + results column (right on wide
// screens, below on narrow ones). NO title bar: the workflow head box opens the
// sidebar, so a permanent bar would only spend vertical space naming the app
import { observer } from 'mobx-react-lite'
import { Gallery } from 'src/cli/serve/web/components/Gallery.tsx'
import { Sidebar } from 'src/cli/serve/web/components/Sidebar.tsx'
import { GenerateButton, VarsForm } from 'src/cli/serve/web/components/VarsForm.tsx'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export const App = observer(function App(p: { st: WebSt }) {
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
               {/* the layout buttons drive ONE class; the width media query only applies
                   under layout-auto, so a chosen placement wins on every screen */}
               <div className={`work layout-${p.st.layout}`}>
                  <div className="form-col">
                     <VarsForm st={p.st} />
                     {/* the ComfyUI console, only while asked for (it polls) */}
                     {p.st.showLogs ? (
                        <div className="logs">
                           <div className="logs-head">
                              <span>console · {p.st.hosts.defaults[p.st.form?.moduleKey ?? ''] ?? 'host'}</span>
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
