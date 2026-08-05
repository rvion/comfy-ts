// module → drafts navigation + module load errors, mirrors the TUI tree's job
import { observer } from 'mobx-react-lite'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export const Sidebar = observer(function Sidebar(p: { st: WebSt }) {
   return (
      <div className="sidebar">
         {p.st.modules.map((mod) => (
            <div key={mod.module}>
               <div className="side-module">
                  <span className="name">{mod.module}</span>
                  <span className="host">{mod.host}</span>
               </div>
               {mod.drafts.map((draft) => {
                  const sel = p.st.form?.moduleKey === mod.module && p.st.form?.draft === draft
                  return (
                     <button
                        key={draft}
                        type="button"
                        className={sel ? 'side-draft sel' : 'side-draft'}
                        onClick={() => void p.st.select({ module: mod.module, draft })}
                     >
                        {draft}
                     </button>
                  )
               })}
            </div>
         ))}
         {Object.keys(p.st.loadErrors).length > 0 ? (
            <div className="side-errors">
               <div>failed to load:</div>
               {Object.entries(p.st.loadErrors).map(([file, msg]) => (
                  <div key={file}>
                     <div className="file">{file}</div>
                     <div className="msg">{msg}</div>
                  </div>
               ))}
            </div>
         ) : null}
      </div>
   )
})
