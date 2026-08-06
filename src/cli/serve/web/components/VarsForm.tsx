// the var rows: each kind dispatches to its matching control (the point of the
// web ui — architecture item 12) + the sticky run bar
import { observer } from 'mobx-react-lite'
import { useEffect } from 'react'
import {
   ChoiceControl,
   NumberControl,
   PromptControl,
   TextControl,
   ToggleControl,
} from 'src/cli/serve/web/components/controls/BasicControls.tsx'
import { ImageControl } from 'src/cli/serve/web/components/controls/ImageControl.tsx'
import { LorasControl } from 'src/cli/serve/web/components/controls/LorasControl.tsx'
import { SeedControl } from 'src/cli/serve/web/components/controls/SeedControl.tsx'
import { SizeControl } from 'src/cli/serve/web/components/controls/SizeControl.tsx'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
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
         return <LorasControl v={p.v} host={p.host} st={p.st} />
      case 'size':
         return <SizeControl v={p.v} />
      case 'image':
         return <ImageControl v={p.v} />
      default:
         // a newer server may describe a kind this bundle predates: stay usable
         return <div className="hint">unsupported var kind '{p.v.desc.kind}' — use the json api</div>
   }
})

const VarRow = observer(function VarRow(p: { v: VarSt; host: string; st: WebSt; module: string }) {
   return (
      <div className="var-row">
         <div className="var-label">
            {p.v.desc.label ?? p.v.name}
            {p.v.dirty ? (
               <button
                  type="button"
                  className="dirty-dot"
                  title="changed this session — click to restore the loaded value (autosaves)"
                  onClick={() => p.v.revert()}
               >
                  ●
               </button>
            ) : null}
            <span className="kind">{p.v.desc.kind}</span>
         </div>
         <div className="var-control">
            <VarControl v={p.v} host={p.host} st={p.st} module={p.module} />
         </div>
      </div>
   )
})

/** what is waiting on the host, and the way to drop it */
const QueuePanel = observer(function QueuePanel(p: { st: WebSt }) {
   const queue = p.st.run.queue
   if (queue.length === 0) return null
   return (
      <div className="queue">
         <div className="queue-head">
            <span>
               queue · {queue.length} prompt{queue.length === 1 ? '' : 's'}
            </span>
            {p.st.run.pendingCount > 0 ? (
               <button type="button" className="link" onClick={() => p.st.run.clearQueue()}>
                  clear {p.st.run.pendingCount} pending
               </button>
            ) : null}
         </div>
         {queue.map((e, ix) => (
            <div key={e.id} className="queue-row">
               <span className="queue-ix">{ix + 1}</span>
               <span className="queue-name">
                  {e.module}/{e.draft}
               </span>
               {e.sent ? (
                  <span className="hint">on the host — past cancelling</span>
               ) : (
                  <button type="button" title="drop this queued prompt" onClick={() => p.st.run.removeQueued(e.id)}>
                     ✕
                  </button>
               )}
            </div>
         ))}
      </div>
   )
})

export const VarsForm = observer(function VarsForm(p: { st: WebSt }) {
   const form = p.st.form
   // ⌘⏎ / ctrl+⏎ submits from anywhere, textarea included (his ask)
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
   const duplicate = (): void => {
      const name = window.prompt('duplicate draft as…', `${form.draft} copy`)
      if (name != null) void p.st.duplicateDraft(name)
   }
   return (
      <div>
         {/* the TUI header, on the web: labelled boxes for what you are editing and where it runs */}
         <div className="head-boxes">
            <div className="head-box">
               <span className="head-label">workflow</span>
               <span className="head-value app">{form.moduleKey}</span>
            </div>
            <div className="head-box">
               <span className="head-label">draft</span>
               <span className="head-value draft">{form.draft}</span>
            </div>
            <div className="head-box">
               <span className="head-label">host</span>
               {/* pick where this workflow RUNS (the TUI's host override), remembered per module */}
               {p.st.hosts.hosts.length > 1 ? (
                  <select
                     className="head-select"
                     value={p.st.hostFor(form.moduleKey)}
                     title="run this workflow on another host"
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
               {p.st.isHostOverridden(form.moduleKey) ? (
                  <button
                     type="button"
                     className="link"
                     title={`runs on an override — back to ${p.st.hosts.defaults[form.moduleKey] ?? 'its own host'}`}
                     onClick={() => void p.st.setModuleHost({ module: form.moduleKey, host: null })}
                  >
                     ⇄ reset
                  </button>
               ) : null}
            </div>
            {/* its own box beside host: on a phone, scrolling between the knobs and the image
                is the whole friction, so 📌 pins the newest one over the bottom */}
            <div className="head-box">
               <span className="head-label">preview</span>
               <span className="btn-group">
                  {LAYOUTS.map((l) => (
                     <button
                        key={l.id}
                        type="button"
                        className={p.st.layout === l.id ? 'sel' : ''}
                        title={`${l.title}${p.st.layout === l.id ? ' — click again for the automatic placement' : ''}`}
                        onClick={() => p.st.setLayout(l.id)}
                     >
                        {l.label}
                     </button>
                  ))}
               </span>
            </div>
         </div>
         {p.st.hostError != null ? <div className="error">🔴 {p.st.hostError}</div> : null}
         <div className="head-actions">
            <button type="button" title="save these values as a new draft" onClick={duplicate}>
               duplicate…
            </button>
            <button
               type="button"
               className="danger"
               title="delete this draft's file (default resets to the workflow's own values)"
               onClick={() => {
                  if (window.confirm(`delete draft '${form.draft}' of ${form.moduleKey}? the file is removed.`))
                     void p.st.deleteDraft({ module: form.moduleKey, draft: form.draft })
               }}
            >
               delete
            </button>
            {/* where the OUTPUTS go: a server setting, so curl and the TUI see the same choice */}
            <button
               type="button"
               className={p.st.saveToDisk ? 'mode sel' : 'mode'}
               title={
                  p.st.saveToDisk
                     ? 'outputs are written under .comfy-ts/outputs/ — click to keep them in memory only'
                     : 'outputs stay in memory and are lost when the server restarts — click to save them to disk'
               }
               onClick={() => void p.st.toggleSaveToDisk()}
            >
               {p.st.saveToDisk ? '💾 saving to disk' : '🕶 memory only'}
            </button>
            <span className="hint">
               {form.saveState === 'saving' ? 'saving…' : null}
               {form.saveState === 'saved' ? 'autosaved' : null}
               {form.saveState === 'error' ? `🔴 save failed: ${form.saveError}` : null}
               {p.st.savingError != null ? ` 🔴 ${p.st.savingError}` : null}
            </span>
         </div>
         {form.vars.map((v) => (
            // keyed by DRAFT too: a draft switch must reset per-row ui state (lora filter,
            // remembered strengths), not carry the other draft's over
            <VarRow key={`${form.draft}/${v.name}`} v={v} host={form.host} st={p.st} module={form.moduleKey} />
         ))}
         <div className="runbar">
            <button
               type="button"
               className={p.st.run.isRunning ? 'primary pulse' : 'primary'}
               title="⌘⏎ / ctrl+⏎ — click again to queue another"
               onClick={() => p.st.generate()}
            >
               {p.st.run.isRunning
                  ? p.st.run.progressPercent != null
                     ? `generating… ${Math.round(p.st.run.progressPercent)}%`
                     : 'generating…'
                  : 'generate'}
            </button>
            <span className="status">
               {form.dirtyCount === 0
                  ? 'draft values'
                  : `${form.dirtyCount} var${form.dirtyCount > 1 ? 's' : ''} changed this session`}
            </span>
            {form.dirtyCount > 0 ? (
               <button type="button" className="link" onClick={() => form.revertAll()}>
                  revert all
               </button>
            ) : null}
            {p.st.run.error != null ? <span className="error">🔴 {p.st.run.error}</span> : null}
         </div>
         <QueuePanel st={p.st} />
      </div>
   )
})
