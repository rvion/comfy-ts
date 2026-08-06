// module → drafts navigation + module load errors, mirrors the TUI tree's job.
// A TREE: folder, then its workflows, then their drafts — the folder is part of
// what identifies a workflow, and eating it made six workflows look like a flat list
import { observer } from 'mobx-react-lite'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { groupModulesByFolder } from 'src/cli/serve/web/state/moduleTree.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export const Sidebar = observer(function Sidebar(p: { st: WebSt }) {
   const groups = groupModulesByFolder(p.st.modules)
   return (
      <div className="sidebar">
         {/* it opens from the WORKFLOW head box, which nothing announces: a way OUT that is
             visible from inside is what makes that discoverable, and it says where it is */}
         <div className="side-head">
            <span>workflows</span>
            <button
               type="button"
               data-tip="close — reopen it by clicking the workflow name"
               onClick={() => p.st.toggleSidebar()}
            >
               <Icon name="close" />
            </button>
         </div>
         {groups.map((group) => (
            <div key={group.folder} className="side-group">
               {group.folder === '' ? null : <div className="side-folder">{group.folder}/</div>}
               <div className="side-branch">
                  {group.modules.map((mod) => (
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
               </div>
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
