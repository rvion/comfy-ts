// the var rows: each kind dispatches to its matching control (the point of the
// web ui — architecture item 12) + the sticky run bar
import { observer, useLocalObservable } from 'mobx-react-lite'
import { useEffect } from 'react'
import {
   ChoiceControl,
   NumberControl,
   PromptControl,
   TextControl,
   ToggleControl,
} from 'src/cli/serve/web/components/controls/BasicControls.tsx'
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { ImageControl } from 'src/cli/serve/web/components/controls/ImageControl.tsx'
import { LorasControl } from 'src/cli/serve/web/components/controls/LorasControl.tsx'
import { SeedControl } from 'src/cli/serve/web/components/controls/SeedControl.tsx'
import { SizeControl } from 'src/cli/serve/web/components/controls/SizeControl.tsx'
import type { FormSt, VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { LAYOUTS, type WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const VarControl = observer(function VarControl(p: { v: VarSt; host: string; st: WebSt; module: string }) {
   switch (p.v.desc.kind) {
      case 'prompt':
         return <PromptControl v={p.v} st={p.st} module={p.module} />
      case 'text':
         return <TextControl v={p.v} />
      case 'int':
      case 'float':
         return <NumberControl v={p.v} />
      case 'seed':
         return <SeedControl v={p.v} />
      case 'toggle':
         return <ToggleControl v={p.v} />
      case 'choice':
         return <ChoiceControl v={p.v} />
      case 'loras':
         // the OVERRIDE host, like every other host-scoped read: with `host` fixed at form
         // construction the previews, trigger words and details sheet came from the workflow's
         // own box while the manager link opened the one actually selected
         return <LorasControl v={p.v} host={p.st.hostFor(p.module)} st={p.st} hostUrl={p.st.hostUrlFor(p.module)} />
      case 'size':
         return <SizeControl v={p.v} />
      case 'image':
         return <ImageControl v={p.v} />
      default:
         // a newer server may describe a kind this bundle predates: stay usable
         return <div className="hint">unsupported var kind '{p.v.desc.kind}' — use the json api</div>
   }
})

const VarRow = observer(function VarRow(p: {
   v: VarSt
   host: string
   st: WebSt
   module: string
   index: number
   names: readonly string[]
}) {
   return (
      <div
         /* loras and prompts need the whole width on a phone; every other kind keeps its
            label beside the control, which is what makes the form readable at a glance */
         className={p.v.desc.kind === 'loras' || p.v.desc.kind === 'prompt' ? 'var-row wide' : 'var-row'}
         onDragOver={(e) => {
            // only a row drag: a file dropped on an image var must still reach its own handler
            if (e.dataTransfer.types.includes('application/x-comfy-var')) e.preventDefault()
         }}
         onDrop={(e) => {
            const raw = e.dataTransfer.getData('application/x-comfy-var')
            if (raw === '') return
            e.preventDefault()
            const from = Number(raw)
            if (Number.isInteger(from) && from !== p.index)
               p.st.moveVar({ module: p.module, names: p.names, from, to: p.index })
         }}
      >
         {/* the LABEL is the handle: a separate grip was one more piece of permanent chrome
             for something the label itself can carry */}
         <div
            className="var-label"
            draggable
            onDragStart={(e) => {
               e.dataTransfer.effectAllowed = 'move'
               e.dataTransfer.setData('application/x-comfy-var', String(p.index))
            }}
         >
            {/* the kind is a TOOLTIP, not a second line: printed under every label it was a
                column of noise you read past, and it only ever answers a question you ask once */}
            <span data-tip={`${p.v.desc.kind}\ndrag the label to reorder`}>{p.v.desc.label ?? p.v.name}</span>
            {p.v.dirty ? (
               <button
                  type="button"
                  className="dirty-dot"
                  data-tip="changed this session — click to restore the loaded value (autosaves)"
                  onClick={() => p.v.revert()}
               >
                  ●
               </button>
            ) : null}
         </div>
         <div className="var-control">
            <VarControl v={p.v} host={p.host} st={p.st} module={p.module} />
         </div>
      </div>
   )
})

/** the draft box: name, autosave state as its legend, and the two actions that own this draft.
 * Duplicate asks for the name INLINE — window.prompt is silently suppressed by browsers after
 * a few dialogs, which reads exactly like a dead button */
const DraftBox = observer(function DraftBox(p: { st: WebSt; form: FormSt }) {
   const local = useLocalObservable(() => ({
      /** null = showing the picker; otherwise the pending name and what it will do */
      mode: null as null | 'duplicate' | 'rename',
      name: '',
      start(mode: 'duplicate' | 'rename', from: string) {
         this.mode = mode
         this.name = mode === 'duplicate' ? `${from} copy` : from
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
               placeholder={local.mode === 'rename' ? 'new name, then enter' : 'new draft name, then enter'}
               onFocus={(e) => e.currentTarget.select()}
               onChange={(e) => local.set(e.target.value)}
               onKeyDown={(e) => {
                  if (e.key === 'Enter') confirm()
                  if (e.key === 'Escape') local.stop()
               }}
               // blur CANCELS, it does not commit: clicking another draft in the sidebar blurred
               // this input, and the rename then raced that selection — renameDraft bails when
               // the form has already moved on, leaving a duplicate instead of a rename, silently.
               // enter commits, which is the only unambiguous signal
               onBlur={() => local.stop()}
            />
         ) : (
            /* the name IS the picker: every draft of this workflow, switching selects it */
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
         )}
         <span className="head-line">
            <span className="btn-group head-group">
               <button
                  type="button"
                  data-tip="rename this draft (the file is renamed)"
                  onClick={() => (local.mode != null ? confirm() : local.start('rename', p.form.draft))}
               >
                  <Icon name="pen" />
               </button>
               <button
                  type="button"
                  data-tip="save these values as a new draft"
                  onClick={() => (local.mode != null ? confirm() : local.start('duplicate', p.form.draft))}
               >
                  <Icon name="copy-plus" />
               </button>
               <button
                  type="button"
                  className="danger"
                  data-tip="delete this draft's file (default resets to the workflow's own values)"
                  onClick={() => {
                     if (window.confirm(`delete draft '${p.form.draft}' of ${p.form.moduleKey}? the file is removed.`))
                        void p.st.deleteDraft({ module: p.form.moduleKey, draft: p.form.draft })
                  }}
               >
                  <Icon name="trash" />
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

/** EVERYTHING about running, on one line: the button, what is queued behind it, and what it
 * has produced. These were three stacked blocks (button, a queue panel listing every pending
 * prompt by name, a gallery header) saying in ~10 lines what fits in one. The per-entry queue
 * rows are gone with them: a count and one clear is the whole decision, and a prompt already
 * on the host was only ever telling you it could not be cancelled. */
export const GenerateButton = observer(function GenerateButton(p: { st: WebSt }) {
   const run = p.st.run
   return (
      <span className="run-line">
         <button
            type="button"
            className={run.isRunning ? 'primary pulse' : 'primary'}
            data-tip="⌘⏎ / ctrl+⏎ — click again to queue another"
            onClick={() => p.st.generate()}
         >
            <Icon name="play" size={0.85} />{' '}
            {run.isRunning
               ? run.progressPercent != null
                  ? `generating… ${Math.round(run.progressPercent)}%`
                  : 'generating…'
               : 'generate'}
            {/* the shortcut is SAID, not only tooltipped: nobody hovers a button they can click */}
            {run.isRunning ? null : <span className="kbd-hint">⌘⏎</span>}
         </button>
         {run.queue.length > 0 ? (
            <span className="run-chip" data-tip="prompts waiting behind this one">
               queue: {run.queue.length}
               {run.pendingCount > 0 ? (
                  <button
                     type="button"
                     className="link"
                     data-tip={`drop the ${run.pendingCount} not yet sent to the host`}
                     onClick={() => run.clearQueue()}
                  >
                     clear
                  </button>
               ) : null}
            </span>
         ) : null}
         {run.results.length > 0 ? (
            <span className="run-chip" data-tip="runs kept in this page">
               {run.results.length} result{run.results.length === 1 ? '' : 's'}
               <button
                  type="button"
                  className="link"
                  data-tip="forget every run shown here"
                  onClick={() => run.clear()}
               >
                  clear
               </button>
            </span>
         ) : null}
      </span>
   )
})

/** where the generated images go: the same row shape as a var, because it is one more knob
 * of the run. The toggle and the folder are SERVER settings, so curl sees the same choice */
const SaveRow = observer(function SaveRow(p: { st: WebSt; module: string }) {
   const on = p.st.saveToDisk
   return (
      <div className="var-row">
         <div className="var-label">
            <span data-tip="save — where this workflow's images go">output</span>
         </div>
         <div className="var-control">
            <div className="row-inline">
               <label className="row-inline" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => void p.st.toggleSaveToDisk()} />
                  <span className="hint">
                     <Icon name={on ? 'save' : 'ghost'} size={1} /> {on ? 'write to disk' : 'memory only'}
                  </span>
               </label>
               {on ? (
                  <>
                     <span className="hint">.comfy-ts/outputs/</span>
                     <input
                        type="text"
                        style={{ flex: 1, minWidth: 120 }}
                        placeholder={p.module}
                        value={p.st.savePrefixDraft(p.module)}
                        data-tip="subfolder the images land in — folder names only, a/b allowed"
                        onChange={(e) => p.st.setSavePrefix(p.module, e.target.value)}
                     />
                     <span className="hint">/…png</span>
                  </>
               ) : (
                  <span className="hint">kept in memory and shown here, lost when the server restarts</span>
               )}
            </div>
            {p.st.savingError != null ? <div className="error">🔴 {p.st.savingError}</div> : null}
         </div>
      </div>
   )
})

export const VarsForm = observer(function VarsForm(p: { st: WebSt }) {
   const form = p.st.form
   // ⌘⏎ / ctrl+⏎ submits from anywhere, textarea included
   useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
         // the enhancer modal owns ⌘⏎ while it is open (refine), so a rewrite never queues a run
         if (p.st.enhancer.isOpen) return
         if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            p.st.generate()
         }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [p.st])
   if (form == null) return null
   // YOUR order (drag), falling back to the workflow's own declaration order
   const orderedNames = p.st.orderedVars(
      form.moduleKey,
      form.vars.map((v) => v.name),
   )
   const orderedVars = orderedNames.map((n) => form.vars.find((v) => v.name === n)).filter((v) => v != null)
   return (
      <div>
         {/* the TUI header, on the web: labelled boxes for what you are editing and where it runs.
             head-shell is the QUERY CONTAINER: the boxes size themselves against the form
             column, which the results placement widens and narrows, not against the window */}
         <div className="head-shell">
            <div className="head-boxes">
               {/* the workflow name IS the way into the menu: the sidebar already holds the
                folder → workflow → draft tree, so a second dropdown would be a rival copy of it */}
               <div className="head-box">
                  <span className="head-label">workflow</span>
                  <div className="head-line">
                     <button
                        type="button"
                        className="head-value app as-link"
                        data-tip={p.st.sidebarOpen ? 'close the workflow menu' : 'browse every workflow'}
                        onClick={() => p.st.toggleSidebar()}
                     >
                        {form.moduleKey}
                     </button>
                  </div>
                  <div className="head-line">
                     <span className="btn-group">
                        <button
                           type="button"
                           data-tip={p.st.sidebarOpen ? 'close the workflow menu' : 'browse every workflow'}
                           onClick={() => p.st.toggleSidebar()}
                        >
                           <Icon name="folder" />
                        </button>
                     </span>
                     <span className="hint">{form.vars.length} vars</span>
                  </div>
               </div>
               {/* duplicate and delete act on THIS draft, so they live in the draft box */}
               <DraftBox st={p.st} form={form} />
               <div className="head-box">
                  <span className="head-label">host</span>
                  <div className="head-line">
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
                  </div>
                  {/* the TUI's host actions: they act on the box this workflow runs on */}
                  <div className="head-line">
                     <span className="btn-group">
                        <button
                           type="button"
                           data-tip="interrupt the prompt running now"
                           onClick={() => void p.st.hostAction('interrupt')}
                        >
                           <Icon name="pause" />
                        </button>
                        <button
                           type="button"
                           data-tip="drop everything still pending in the host queue"
                           onClick={() => void p.st.hostAction('clear-queue')}
                        >
                           <Icon name="trash" />
                        </button>
                        <button
                           type="button"
                           data-tip="refetch object_info from the host and rewrite sdk.d.ts (a restart of serve widens the var lists)"
                           onClick={() => void p.st.hostAction('refresh-schema')}
                        >
                           <Icon name="refresh" />
                        </button>
                        <button
                           type="button"
                           className="danger"
                           data-tip="restart ComfyUI on that host (manager reboot) — it reconnects when back"
                           onClick={() => {
                              if (window.confirm(`restart ComfyUI on '${p.st.hostFor(form.moduleKey)}'?`))
                                 void p.st.hostAction('restart')
                           }}
                        >
                           <Icon name="power" />
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
               {/* its own box beside host: on a phone, scrolling between the knobs and the image
                is the whole friction, so 📌 pins the newest one over the bottom */}
               <div className="head-box">
                  <span className="head-label">preview</span>
                  {/* first line: WHERE the results sit. second: what shows up while it runs */}
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
                  <div className="head-line">
                     <span className="btn-group">
                        <button
                           type="button"
                           className={p.st.showLatent ? 'sel' : ''}
                           data-tip={
                              p.st.showLatent ? 'hide the latent preview during a run' : 'show the latent preview'
                           }
                           onClick={() => p.st.toggleLatent()}
                        >
                           <Icon name="image" />
                        </button>
                        <button
                           type="button"
                           className={p.st.showLogs ? 'sel' : ''}
                           data-tip={p.st.showLogs ? 'hide the ComfyUI console' : 'show the ComfyUI console'}
                           onClick={() => p.st.toggleLogs()}
                        >
                           <Icon name="terminal" />
                        </button>
                     </span>
                  </div>
               </div>
            </div>
         </div>
         {/* every host action SAYS what happened: the note was computed and thrown away, which
             is precisely why restart looked like a dead button */}
         {p.st.hostError != null ? <div className="error">🔴 {p.st.hostError}</div> : null}
         {p.st.hostWatch === 'down' ? (
            <div className="host-note pulse">restarting… waiting for the host to answer again</div>
         ) : null}
         {p.st.hostNote != null && p.st.hostWatch !== 'down' ? <div className="host-note">{p.st.hostNote}</div> : null}
         {/* the autosave state is the draft box's legend now; only a FAILURE gets a line of
             its own, because that one you must not miss */}
         {form.saveState === 'error' ? <div className="error">🔴 draft save failed: {form.saveError}</div> : null}
         {/* ONE grid for every row (rows are subgrids of it), so the label column can size
             itself to the longest label instead of reserving a fixed slab of the width */}
         <div className="vars">
            {orderedVars.map((v, ix) => (
               // keyed by MODULE and DRAFT: a switch must reset per-row ui state (lora filter,
               // remembered strengths, paused set), not carry the other selection's over.
               // module matters because every workflow has a `default` draft and a `prompt`
               // var, so draft+name alone matches across workflows and react reuses the row
               <VarRow
                  key={`${form.moduleKey}/${form.draft}/${v.name}`}
                  v={v}
                  host={form.host}
                  st={p.st}
                  module={form.moduleKey}
                  index={ix}
                  names={orderedNames}
               />
            ))}
            {/* the OUTPUT is a knob like the others: a row, not a lone button in the header */}
            <SaveRow st={p.st} module={form.moduleKey} />
         </div>
         {/* side and pinned put generate INSIDE the results panel (it sits next to what it
             produces, and on a phone it stays on screen); the form keeps it otherwise. With
             neither a button nor an error there is nothing to bar: rendering it anyway left a
             sticky bordered strip holding nothing */}
         {p.st.generateInResults && p.st.run.error == null ? null : (
            <div className="runbar">
               {p.st.generateInResults ? null : <GenerateButton st={p.st} />}
               {p.st.run.error != null ? <span className="error">🔴 {p.st.run.error}</span> : null}
            </div>
         )}
      </div>
   )
})
