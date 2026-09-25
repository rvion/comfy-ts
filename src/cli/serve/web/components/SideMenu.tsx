// the menu column: where you are, widest scope first (workspace, workflow, host, preview).
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

/** the draft rows: the picker with rename and delete, then new, copy and the autosave state.
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
   const saveNote =
      p.form.saveState === 'saving'
         ? 'saving…'
         : p.form.saveState === 'saved'
           ? 'saved'
           : p.form.saveState === 'error'
             ? 'NOT SAVED'
             : ''
   return (
      <>
         {local.mode != null ? (
            <div className="menu-row">
               <Icon name="draft" />
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
                          ? 'new draft name, then enter'
                          : 'copy name, then enter'
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
            </div>
         ) : (
            /* the name IS the picker; rename and delete act ON it, so they sit at its end */
            <div className="menu-row">
               <Icon name="draft" />
               <select
                  className="menu-select draft"
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
               <span className="menu-row-actions">
                  <button
                     type="button"
                     className="head-icon"
                     data-tip="rename this draft (the file is renamed)"
                     onClick={() => local.start('rename', p.form.draft)}
                  >
                     <Icon name="pen" />
                  </button>
                  <button
                     type="button"
                     className="head-icon danger"
                     data-tip="delete this draft's file (default resets to the workflow's own values)"
                     onClick={() => {
                        if (
                           window.confirm(`delete draft '${p.form.draft}' of ${p.form.moduleKey}? the file is removed.`)
                        )
                           void p.st.deleteDraft({ module: p.form.moduleKey, draft: p.form.draft })
                     }}
                  >
                     <Icon name="trash" />
                  </button>
               </span>
            </div>
         )}
         <div className="menu-row menu-buttons">
            {/* the two ways to MAKE a draft: from the workflow's defaults, or from what is on screen */}
            <button
               type="button"
               data-tip="new draft with the workflow's own default values"
               onClick={() => (local.mode != null ? confirm() : local.start('new', freeDraftName(drafts)))}
            >
               <Icon name="plus" /> new
            </button>
            <button
               type="button"
               data-tip="save these values as a new draft"
               onClick={() => (local.mode != null ? confirm() : local.start('duplicate', p.form.draft, drafts))}
            >
               <Icon name="copy-plus" /> copy
            </button>
            {p.form.dirtyCount > 0 ? (
               <button
                  type="button"
                  className="dirty"
                  data-tip={`${p.form.dirtyCount} var${p.form.dirtyCount > 1 ? 's' : ''} changed this session — revert to the values this draft loaded with`}
                  onClick={() => p.form.revertAll()}
               >
                  <Icon name="broom" />
               </button>
            ) : null}
            <span className={p.form.saveState === 'error' ? 'menu-note error' : 'menu-note'}>{saveNote}</span>
         </div>
      </>
   )
})

/** a titled block of rows; `actions` sit at the right end of the title */
function Section(p: { title: string; actions?: ReactNode; children: ReactNode }): ReactNode {
   return (
      <section className="menu-section">
         <div className="menu-title">
            <span>{p.title}</span>
            {p.actions == null ? null : <span className="menu-title-actions">{p.actions}</span>}
         </div>
         {p.children}
      </section>
   )
}

/** read-only for now: the label fits the row, a click copies the full path */
function PathRow(p: { what: string; icon: IconName; value: PathLabel | null }): ReactNode {
   if (p.value == null) return null
   const value = p.value
   return (
      <button
         type="button"
         className="menu-row path-row"
         data-tip={`${p.what}: ${value.path} (click to copy)`}
         onClick={() => void navigator.clipboard.writeText(value.path)}
      >
         <Icon name={p.icon} />
         {/* rtl cuts a long path at its START; the bdi keeps the path itself left to right, or rtl
             reorders the neutral `~` and `/` and `~/dev/x` reads `dev/x/~` */}
         <span className="path-text">
            <bdi>{value.label}</bdi>
         </span>
      </button>
   )
}

/** ☰ + the name. ☰ folds the column (⌘B), in the drawer it closes it */
export function MenuHead(p: { onBurger: () => void; tip: string }): ReactNode {
   return (
      <div className="menu-head">
         <button type="button" className="head-icon" data-tip={p.tip} aria-label="menu" onClick={p.onBurger}>
            <Icon name="menu" />
         </button>
         <span className="menu-brand">comfy-ts</span>
      </div>
   )
}

export const MenuCards = observer(function MenuCards(p: { st: WebSt }) {
   const form = p.st.form
   const failed = Object.keys(p.st.loadErrors).length
   return (
      <div className="menu-sections">
         <Section title="workspace">
            <PathRow what="workspace (where .comfy-ts/ lives)" icon="folder" value={p.st.workspace} />
            <PathRow what="root (the folder serve scans)" icon="folder-tree" value={p.st.root} />
         </Section>
         {form == null ? null : (
            <>
               <Section
                  title="workflow"
                  actions={
                     <>
                        {failed > 0 ? (
                           <button
                              type="button"
                              className="link load-errors"
                              data-tip="some workflows failed to load: the list is at the bottom of the search"
                              onClick={() => p.st.omnibox.open()}
                           >
                              <Icon name="warn" /> {failed}
                           </button>
                        ) : null}
                        <button
                           type="button"
                           className="head-icon"
                           data-tip={`search every workflow and draft (${MOD_KEY}K or ${MOD_KEY}J)`}
                           onClick={() => p.st.omnibox.open()}
                        >
                           <Icon name="search" /> <span className="kbd-hint">{MOD_KEY}K</span>
                        </button>
                     </>
                  }
               >
                  {/* the workflow name IS the way into the omnibox, and so is ⌘K / ⌘J */}
                  <button
                     type="button"
                     className="menu-row workflow-row"
                     data-tip={`search every workflow and draft (${MOD_KEY}K)`}
                     onClick={() => p.st.omnibox.open()}
                  >
                     <Icon name="workflow" />
                     <span className="menu-value">{form.moduleKey}</span>
                  </button>
                  <DraftBox st={p.st} form={form} />
               </Section>
               <Section
                  title={
                     p.st.hostWatch === 'down'
                        ? 'host · restarting…'
                        : p.st.hostWatch === 'back'
                          ? 'host · back up'
                          : 'host'
                  }
                  actions={
                     <>
                        {/* the ONE refresh: models, nodes and the lora list. It also runs by itself
                            when the host changes, pulsing while it works */}
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
                     </>
                  }
               >
                  <div className="menu-row">
                     <Icon name="server" />
                     {/* pick where this workflow RUNS (the TUI's host override), remembered per module */}
                     {p.st.hosts.hosts.length > 1 ? (
                        <select
                           className="menu-select host"
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
                        <span className="menu-value host">{p.st.hostFor(form.moduleKey) || form.host}</span>
                     )}
                     {p.st.isHostOverridden(form.moduleKey) ? (
                        <span className="menu-row-actions">
                           <button
                              type="button"
                              className="head-icon"
                              data-tip={`runs on an override — back to ${p.st.hosts.defaults[form.moduleKey] ?? 'its own host'}`}
                              onClick={() => void p.st.setModuleHost({ module: form.moduleKey, host: null })}
                           >
                              <Icon name="swap" />
                           </button>
                        </span>
                     ) : null}
                  </div>
                  {/* stopping the run and emptying the queue are different decisions, and the
                      destructive one wears its warning color */}
                  <div className="menu-row menu-buttons">
                     <button
                        type="button"
                        data-tip="interrupt the prompt running now"
                        onClick={() => void p.st.hostAction('interrupt')}
                     >
                        <Icon name="pause" /> stop
                     </button>
                     <button
                        type="button"
                        className="quiet-danger"
                        data-tip="drop everything still pending in the host queue"
                        onClick={() => void p.st.hostAction('clear-queue')}
                     >
                        <Icon name="trash" /> clear
                     </button>
                     {/* the console is the HOST's output, so it opens from here */}
                     <button
                        type="button"
                        className={p.st.showLogs ? 'sel' : ''}
                        data-tip={p.st.showLogs ? 'hide the ComfyUI console' : 'show the ComfyUI console of this host'}
                        onClick={() => p.st.toggleLogs()}
                     >
                        <Icon name="terminal" /> console
                     </button>
                  </div>
                  {p.st.hostError != null ? <div className="error menu-error">🔴 {p.st.hostError}</div> : null}
               </Section>
            </>
         )}
         {/* where the results sit: page layout, so it is here rather than in the preview head */}
         <Section title="preview">
            <div className="menu-row">
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
         </Section>
      </div>
   )
})

/** the folded rail: ☰, search, then one icon per row, a click unfolds the column */
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
            data-tip={`unfold the menu (${MOD_KEY}B)`}
            aria-label="menu"
            onClick={p.onExpand}
         >
            <Icon name="menu" />
         </button>
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
