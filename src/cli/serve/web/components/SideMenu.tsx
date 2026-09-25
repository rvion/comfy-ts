// the menu column: where you are, widest scope first (workspace, root, workflow, draft, host).
// a left Panel above 760px (collapsible to an icon rail), a drawer behind ☰ below
import { observer, useLocalObservable } from 'mobx-react-lite'
import type { ReactNode } from 'react'
import { Icon, type IconName } from 'src/cli/serve/web/components/Icon.tsx'
import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'
import { copyName } from 'src/utils/copyName.ts'
import type { PathLabel } from 'src/cli/serve/web/api.ts'
import type { FormSt } from 'src/cli/serve/web/state/FormSt.ts'
import { LAYOUTS, type WebSt } from 'src/cli/serve/web/state/WebSt.ts'

/** `new`, `new 2`, … the first name no draft of this workflow has */
function freeDraftName(drafts: readonly string[]): string {
   if (!drafts.includes('new')) return 'new'
   let n = 2
   while (drafts.includes(`new ${n}`)) n++
   return `new ${n}`
}

/** the draft box: name, autosave state as its legend, and the actions that own this draft.
 * new and duplicate ask for the name INLINE, window.prompt is silently suppressed by browsers
 * after a few dialogs, which reads exactly like a dead button */
const DraftBox = observer(function DraftBox(p: { st: WebSt; form: FormSt }) {
   const local = useLocalObservable(() => ({
      /** null = showing the picker; otherwise the pending name and what it will do */
      mode: null as null | 'duplicate' | 'rename' | 'new',
      name: '',
      start(mode: 'duplicate' | 'rename' | 'new', from: string, taken: readonly string[] = []) {
         this.mode = mode
         this.name = mode === 'duplicate' ? copyName(from, taken) : from
      },
      set(v: string) {
         this.name = v
      },
      stop() {
         this.mode = null
      },
   }))
   const drafts = p.st.moduleByKey(p.form.moduleKey)?.drafts ?? [p.form.draft]
   const confirm = (): void => {
      const name = local.name.trim()
      const mode = local.mode
      local.stop()
      if (name === '' || mode == null) return
      if (mode === 'duplicate') void p.st.duplicateDraft(name)
      else if (mode === 'new') void p.st.newDraft(name)
      else void p.st.renameDraft(name)
   }
   return (
      <div className="head-box">
         <span className="head-label">
            draft
            <span className={p.form.saveState === 'error' ? 'save-state error' : 'save-state'}>
               {p.form.saveState === 'saving' ? '· saving' : null}
               {p.form.saveState === 'saved' ? '· saved' : null}
               {p.form.saveState === 'error' ? '· NOT SAVED' : null}
            </span>
         </span>
         {local.mode != null ? (
            <input
               type="text"
               autoFocus
               className="head-input"
               value={local.name}
               // enter is the ONLY commit now, so it has to be said
               placeholder={
                  local.mode === 'rename'
                     ? 'new name, then enter'
                     : local.mode === 'new'
                       ? 'name of the new draft (workflow defaults), then enter'
                       : 'new draft name, then enter'
               }
               onFocus={(e) => e.currentTarget.select()}
               onChange={(e) => local.set(e.target.value)}
               onKeyDown={(e) => {
                  if (e.key === 'Enter') confirm()
                  if (e.key === 'Escape') local.stop()
               }}
               // blur CANCELS, it does not commit: picking another draft blurs this input, and a
               // rename committed on blur raced that selection, renameDraft bails when the form
               // has already moved on, leaving a duplicate instead of a rename, silently. enter
               // commits, which is the only unambiguous signal
               onBlur={() => local.stop()}
            />
         ) : (
            /* the name IS the picker: every draft of this workflow, switching selects it. Rename
               sits before it and delete after it: the two actions ON this name, around it */
            <span className="head-line draft-line">
               <button
                  type="button"
                  className="head-icon"
                  data-tip="rename this draft (the file is renamed)"
                  onClick={() => local.start('rename', p.form.draft)}
               >
                  <Icon name="pen" />
               </button>
               <select
                  className="head-select draft"
                  value={p.form.draft}
                  data-tip="switch draft"
                  onChange={(e) => void p.st.select({ module: p.form.moduleKey, draft: e.target.value })}
               >
                  {drafts.map((d) => (
                     <option key={d} value={d}>
                        {d}
                     </option>
                  ))}
               </select>
               <button
                  type="button"
                  className="head-icon danger"
                  data-tip="delete this draft's file (default resets to the workflow's own values)"
                  onClick={() => {
                     if (window.confirm(`delete draft '${p.form.draft}' of ${p.form.moduleKey}? the file is removed.`))
                        void p.st.deleteDraft({ module: p.form.moduleKey, draft: p.form.draft })
                  }}
               >
                  <Icon name="trash" />
               </button>
            </span>
         )}
         <span className="head-line">
            {/* the two ways to MAKE a draft, side by side: from the workflow's defaults, or from
                what is on screen */}
            <span className="btn-group">
               <button
                  type="button"
                  className="accent"
                  data-tip="new draft with the workflow's own default values"
                  onClick={() => (local.mode != null ? confirm() : local.start('new', freeDraftName(drafts)))}
               >
                  <Icon name="plus" /> new
               </button>
               <button
                  type="button"
                  className="accent"
                  data-tip="save these values as a new draft"
                  onClick={() => (local.mode != null ? confirm() : local.start('duplicate', p.form.draft, drafts))}
               >
                  <Icon name="copy-plus" /> copy
               </button>
            </span>
            {/* FAR RIGHT of the same line, outside the group: inside it, the broom appeared and
                vanished with the dirty count and shoved the other buttons sideways */}
            {p.form.dirtyCount > 0 ? (
               <button
                  type="button"
                  className="dirty head-right"
                  data-tip={`${p.form.dirtyCount} var${p.form.dirtyCount > 1 ? 's' : ''} changed this session — revert to the values this draft loaded with`}
                  onClick={() => p.form.revertAll()}
               >
                  <Icon name="broom" />
               </button>
            ) : null}
         </span>
      </div>
   )
})

/** read-only for now: the label fits the card, a click copies the full path */
function PathCard(p: { label: string; icon: IconName; value: PathLabel | null }): ReactNode {
   if (p.value == null) return null
   const value = p.value
   return (
      <div className="head-box">
         <span className="head-label">{p.label}</span>
         <button
            type="button"
            className="head-value path-value as-link"
            data-tip={`${value.path} (click to copy)`}
            onClick={() => void navigator.clipboard.writeText(value.path)}
         >
            <Icon name={p.icon} /> <span className="path-text">{value.label}</span>
         </button>
      </div>
   )
}

/** where the results sit: page layout, so it belongs with the other where-am-I cards */
const PreviewCard = observer(function PreviewCard(p: { st: WebSt }) {
   return (
      <div className="head-box">
         <span className="head-label">preview</span>
         <div className="head-line">
            <span className="btn-group">
               {LAYOUTS.map((l) => (
                  <button
                     key={l.id}
                     type="button"
                     className={p.st.layout === l.id ? 'sel' : ''}
                     data-tip={l.title}
                     onClick={() => p.st.setLayout(l.id)}
                  >
                     <Icon name={l.icon} />
                  </button>
               ))}
            </span>
         </div>
      </div>
   )
})

export const MenuCards = observer(function MenuCards(p: { st: WebSt }) {
   const form = p.st.form
   return (
      <div className="menu-cards">
         <PathCard label="workspace" icon="folder" value={p.st.workspace} />
         <PathCard label="root" icon="folder-tree" value={p.st.root} />
         {form == null ? null : (
            <>
               {/* the workflow name IS the way into the omnibox, and so is ⌘K / ⌘J */}
               <div className="head-box">
                  <span className="head-label">workflow</span>
                  <div className="head-line">
                     <button
                        type="button"
                        className="head-value app as-link"
                        data-tip="search every workflow and draft (⌘K or ⌘J)"
                        onClick={() => p.st.omnibox.open()}
                     >
                        {form.moduleKey}
                     </button>
                  </div>
                  <div className="head-line">
                     <span className="btn-group">
                        <button
                           type="button"
                           data-tip="search every workflow and draft (⌘K or ⌘J)"
                           onClick={() => p.st.omnibox.open()}
                        >
                           <Icon name="search" /> search <span className="kbd-hint">{MOD_KEY}K</span>
                        </button>
                     </span>
                     {Object.keys(p.st.loadErrors).length > 0 ? (
                        <button
                           type="button"
                           className="link load-errors"
                           data-tip="some workflows failed to load: the list is at the bottom of the search"
                           onClick={() => p.st.omnibox.open()}
                        >
                           <Icon name="warn" /> {Object.keys(p.st.loadErrors).length} failed
                        </button>
                     ) : null}
                  </div>
               </div>
               {/* duplicate and delete act on THIS draft, so they live in the draft box */}
               <DraftBox st={p.st} form={form} />
               <div className="head-box">
                  {/* a restart shows HERE, as the card's legend like the draft's `· saving`: a line
                      under the cards moved the whole form and read as unrelated to the host */}
                  <span className="head-label">
                     host
                     {p.st.hostWatch === 'down' ? <span className="save-state pulse">· restarting…</span> : null}
                     {p.st.hostWatch === 'back' ? <span className="save-state">· back up</span> : null}
                  </span>
                  {/* the box itself, like the draft: its name, with the two actions ON the box
                      around it. The ones on the RUNNING work sit on the line below, in words */}
                  <div className="head-line draft-line">
                     {/* the ONE refresh: models, nodes and the lora list. It also runs by itself when
                         the host changes, pulsing while it works */}
                     <button
                        type="button"
                        className={p.st.refreshing ? 'head-icon pulse' : 'head-icon'}
                        data-tip={
                           p.st.refreshing
                              ? 'refreshing what the host has…'
                              : 'refresh what the host has (models, nodes, loras). It also refreshes by itself when something new appears'
                        }
                        onClick={() => void p.st.refreshHost()}
                     >
                        <Icon name="refresh" />
                     </button>
                     {/* pick where this workflow RUNS (the TUI's host override), remembered per module */}
                     {p.st.hosts.hosts.length > 1 ? (
                        <select
                           className="head-select"
                           value={p.st.hostFor(form.moduleKey)}
                           data-tip="run this workflow on another host"
                           onChange={(e) => void p.st.setModuleHost({ module: form.moduleKey, host: e.target.value })}
                        >
                           {p.st.hosts.hosts.map((h) => (
                              <option key={h.id} value={h.id}>
                                 {h.id === (p.st.hosts.defaults[form.moduleKey] ?? '') ? `${h.id} (its own)` : h.id}
                              </option>
                           ))}
                        </select>
                     ) : (
                        <span className="head-value host">{p.st.hostFor(form.moduleKey) || form.host}</span>
                     )}
                     <button
                        type="button"
                        className="head-icon danger"
                        data-tip="restart ComfyUI on that host (manager reboot) — it reconnects when back"
                        onClick={() => {
                           if (window.confirm(`restart ComfyUI on '${p.st.hostFor(form.moduleKey)}'?`))
                              void p.st.hostAction('restart')
                        }}
                     >
                        <Icon name="power" />
                     </button>
                  </div>
                  <div className="head-line">
                     {/* two separate buttons: stopping the run and emptying the queue are different
                         decisions, and the destructive one wears its warning color */}
                     <span className="btn-group">
                        <button
                           type="button"
                           data-tip="interrupt the prompt running now"
                           onClick={() => void p.st.hostAction('interrupt')}
                        >
                           <Icon name="pause" /> stop
                        </button>
                     </span>
                     <span className="btn-group">
                        <button
                           type="button"
                           className="quiet-danger"
                           data-tip="drop everything still pending in the host queue"
                           onClick={() => void p.st.hostAction('clear-queue')}
                        >
                           <Icon name="trash" /> clear queue
                        </button>
                     </span>
                     {/* the console is the HOST's output, so it opens from the host box */}
                     <span className="btn-group">
                        <button
                           type="button"
                           className={p.st.showLogs ? 'sel' : ''}
                           data-tip={
                              p.st.showLogs ? 'hide the ComfyUI console' : 'show the ComfyUI console of this host'
                           }
                           onClick={() => p.st.toggleLogs()}
                        >
                           <Icon name="terminal" /> console
                        </button>
                     </span>
                     {p.st.isHostOverridden(form.moduleKey) ? (
                        <button
                           type="button"
                           className="link"
                           data-tip={`runs on an override — back to ${p.st.hosts.defaults[form.moduleKey] ?? 'its own host'}`}
                           onClick={() => void p.st.setModuleHost({ module: form.moduleKey, host: null })}
                        >
                           <Icon name="swap" /> reset
                        </button>
                     ) : null}
                  </div>
               </div>
            </>
         )}
         <PreviewCard st={p.st} />
         {/* a host action that FAILS says so right under the host card */}
         {p.st.hostError != null ? <div className="error">🔴 {p.st.hostError}</div> : null}
      </div>
   )
})

/** the collapsed rail: one icon per card, a click expands the column */
export const MenuRail = observer(function MenuRail(p: { st: WebSt; onExpand: () => void }) {
   const items: { icon: IconName; tip: string }[] = [
      { icon: 'folder', tip: `workspace: ${p.st.workspace?.label ?? '?'}` },
      { icon: 'folder-tree', tip: `root: ${p.st.root?.label ?? '?'}` },
      { icon: 'workflow', tip: `workflow: ${p.st.form?.moduleKey ?? 'none'}` },
      { icon: 'draft', tip: `draft: ${p.st.form?.draft ?? 'none'}` },
      { icon: 'server', tip: `host: ${p.st.hostFor(p.st.form?.moduleKey ?? '') || 'none'}` },
      {
         icon: LAYOUTS.find((l) => l.id === p.st.layout)?.icon ?? 'panel-side',
         tip: `preview: ${LAYOUTS.find((l) => l.id === p.st.layout)?.title ?? p.st.layout}`,
      },
   ]
   return (
      <div className="menu-rail">
         <button
            type="button"
            className="head-icon"
            data-tip={`search (${MOD_KEY}K)`}
            onClick={() => p.st.omnibox.open()}
         >
            <Icon name="search" />
         </button>
         {items.map((it) => (
            <button key={it.icon} type="button" className="head-icon" data-tip={it.tip} onClick={p.onExpand}>
               <Icon name={it.icon} />
            </button>
         ))}
      </div>
   )
})
