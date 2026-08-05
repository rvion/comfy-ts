// the var rows: each kind dispatches to its matching control (the point of the
// web ui — architecture item 12) + the sticky run bar
import { observer } from 'mobx-react-lite'
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
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const VarControl = observer(function VarControl(p: { v: VarSt; host: string; st: WebSt }) {
   switch (p.v.desc.kind) {
      case 'prompt':
         return <PromptControl v={p.v} />
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

const VarRow = observer(function VarRow(p: { v: VarSt; host: string; st: WebSt }) {
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
            <VarControl v={p.v} host={p.host} st={p.st} />
         </div>
      </div>
   )
})

export const VarsForm = observer(function VarsForm(p: { st: WebSt }) {
   const form = p.st.form
   if (form == null) return null
   const duplicate = (): void => {
      const name = window.prompt('duplicate draft as…', `${form.draft} copy`)
      if (name != null) void p.st.duplicateDraft(name)
   }
   return (
      <div>
         <div className="form-head">
            <h2>
               <b>{form.moduleKey}</b> / {form.draft}
            </h2>
            <span className="hint">
               {form.saveState === 'saving' ? 'saving…' : null}
               {form.saveState === 'saved' ? 'autosaved' : null}
               {form.saveState === 'error' ? `🔴 save failed: ${form.saveError}` : null}
            </span>
            <button type="button" className="link" title="save these values as a new draft" onClick={duplicate}>
               duplicate…
            </button>
         </div>
         {form.vars.map((v) => (
            <VarRow key={v.name} v={v} host={form.host} st={p.st} />
         ))}
         <div className="runbar">
            <button
               type="button"
               className={p.st.run.isRunning ? 'primary pulse' : 'primary'}
               disabled={p.st.run.isRunning}
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
      </div>
   )
})
