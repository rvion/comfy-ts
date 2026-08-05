// layout root: topbar, sidebar, form + gallery
import { observer } from 'mobx-react-lite'
import { Gallery } from 'src/cli/serve/web/components/Gallery.tsx'
import { Sidebar } from 'src/cli/serve/web/components/Sidebar.tsx'
import { VarsForm } from 'src/cli/serve/web/components/VarsForm.tsx'
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
         <div className="topbar">
            <h1>comfy-ts serve</h1>
            <span className="dim">
               {p.st.modules.length} workflow{p.st.modules.length === 1 ? '' : 's'} · drafts are the base, edits
               override per run
            </span>
         </div>
         <div className="cols">
            <Sidebar st={p.st} />
            <div className="main">
               {p.st.formError != null ? <div className="center error">🔴 {p.st.formError}</div> : null}
               {p.st.formLoading && p.st.form == null ? <div className="center">loading draft…</div> : null}
               {p.st.modules.length === 0 ? <div className="center">no workflow modules loaded</div> : null}
               <VarsForm st={p.st} />
               <Gallery st={p.st} />
            </div>
         </div>
      </div>
   )
})
