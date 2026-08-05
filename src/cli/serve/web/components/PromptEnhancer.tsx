// ✨ on a prompt row → the refine modal: openrouter key + thinking model +
// a library of named master prompts. Nothing touches the var until APPLY.
import { observer } from 'mobx-react-lite'
import { useEffect } from 'react'
import type { ReasoningEffort } from 'src/cli/serve/web/openrouter.ts'
import type { EnhancerSt } from 'src/cli/serve/web/state/EnhancerSt.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

const EFFORTS: ReasoningEffort[] = ['off', 'low', 'medium', 'high']

const Settings = observer(function Settings(p: { e: EnhancerSt }) {
   const models = p.e.visibleModels
   return (
      <div>
         <div className="section-title">openrouter · the key stays in this browser</div>
         <div className="enh-row">
            <input
               type="password"
               placeholder="sk-or-v1-… (localStorage only)"
               value={p.e.apiKey}
               onChange={(ev) => p.e.setApiKey(ev.target.value)}
               style={{ flex: 1, minWidth: 200 }}
            />
            <button type="button" onClick={() => void p.e.loadModels()} disabled={p.e.modelsState === 'loading'}>
               {p.e.modelsState === 'loading' ? 'loading…' : 'load models'}
            </button>
         </div>
         <div className="enh-row">
            {models.length > 0 ? (
               <select value={p.e.model} onChange={(ev) => p.e.setModel(ev.target.value)} style={{ flex: 1 }}>
                  {/* honest display for an id outside the loaded list (free text, or a filtered-out model) */}
                  {models.some((m) => m.id === p.e.model) ? null : (
                     <option value={p.e.model}>{p.e.model} (not in the list)</option>
                  )}
                  {models.map((m) => (
                     <option key={m.id} value={m.id}>
                        {m.id}
                     </option>
                  ))}
               </select>
            ) : (
               <input
                  type="text"
                  placeholder="model id, e.g. anthropic/claude-sonnet-5"
                  value={p.e.model}
                  onChange={(ev) => p.e.setModel(ev.target.value)}
                  style={{ flex: 1 }}
               />
            )}
            <label className="row-inline" title="only models that support reasoning">
               <input type="checkbox" checked={p.e.thinkingOnly} onChange={() => p.e.toggleThinkingOnly()} />
               <span className="hint">thinking only</span>
            </label>
            <label className="row-inline" title="reasoning effort sent to the model">
               <span className="hint">effort</span>
               <select value={p.e.effort} onChange={(ev) => p.e.setEffort(ev.target.value)}>
                  {EFFORTS.map((x) => (
                     <option key={x} value={x}>
                        {x}
                     </option>
                  ))}
               </select>
            </label>
         </div>
         {p.e.modelsError !== '' ? <div className="error">🔴 {p.e.modelsError}</div> : null}
      </div>
   )
})

const MasterPrompt = observer(function MasterPrompt(p: { e: EnhancerSt }) {
   const preset = p.e.preset
   if (preset == null) return null
   const rename = (): void => {
      const name = window.prompt('rename this master prompt', preset.name)
      if (name != null) p.e.renamePreset(name)
   }
   const create = (): void => {
      const name = window.prompt('name the new master prompt', 'refine-<model>-prompt')
      if (name != null) p.e.addPreset(name)
   }
   return (
      <div>
         <div className="section-title">master prompt · one per image model</div>
         <div className="enh-row">
            <select value={preset.id} onChange={(ev) => p.e.selectPreset(ev.target.value)} style={{ flex: 1 }}>
               {p.e.presets.map((m) => (
                  <option key={m.id} value={m.id}>
                     {m.name}
                  </option>
               ))}
            </select>
            <button type="button" onClick={create}>
               new
            </button>
            <button type="button" onClick={() => p.e.duplicatePreset()}>
               duplicate
            </button>
            <button type="button" onClick={rename}>
               rename
            </button>
            <button type="button" onClick={() => p.e.deletePreset()} title="delete this master prompt">
               ✕
            </button>
            <button
               type="button"
               className="link"
               onClick={() => p.e.restoreDefaults()}
               title="re-add the shipped ones"
            >
               restore defaults
            </button>
         </div>
         <textarea rows={8} value={preset.text} onChange={(ev) => p.e.setPresetText(ev.target.value)} />
      </div>
   )
})

const Modal = observer(function Modal(p: { e: EnhancerSt }) {
   const e = p.e
   useEffect(() => {
      const onKey = (ev: KeyboardEvent): void => {
         if (ev.key === 'Escape') e.close()
         if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            // inside the modal ⌘⏎ refines; VarsForm's generate shortcut stands down while it is open
            ev.preventDefault()
            e.run()
         }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [e])
   const running = e.phase === 'running'
   return (
      <div className="modal-overlay" onClick={() => e.close()}>
         <div className="modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-head">
               <b style={{ flex: 1 }}>✨ enhance prompt</b>
               <button type="button" onClick={() => e.close()}>
                  ✕
               </button>
            </div>
            <div className="modal-body">
               <Settings e={e} />
               <MasterPrompt e={e} />
               <div className="section-title">prompt</div>
               <div className="enh-cols">
                  <div>
                     <div className="hint">yours (edit before refining, the var is untouched)</div>
                     <textarea rows={8} value={e.original} onChange={(ev) => e.setOriginal(ev.target.value)} />
                  </div>
                  <div>
                     <div className="hint">{running ? 'rewriting…' : 'rewritten (editable before apply)'}</div>
                     <textarea
                        rows={8}
                        value={e.result}
                        placeholder="hit enhance"
                        onChange={(ev) => e.setResult(ev.target.value)}
                     />
                  </div>
               </div>
               {e.thinking !== '' ? (
                  <div>
                     <div className="section-title">thinking</div>
                     <div className="enh-think">{e.thinking}</div>
                  </div>
               ) : null}
               {e.error !== '' ? <div className="error">🔴 {e.error}</div> : null}
            </div>
            <div className="modal-foot">
               {running ? (
                  <button type="button" onClick={() => e.cancel()}>
                     stop
                  </button>
               ) : (
                  <button type="button" className="primary" onClick={() => e.run()} title="⌘⏎ / ctrl+⏎">
                     enhance
                  </button>
               )}
               <button type="button" onClick={() => e.apply()} disabled={e.result.trim() === ''}>
                  apply to prompt
               </button>
               <span className="hint" style={{ flex: 1 }}>
                  {running ? `${e.result.length} chars streamed` : 'nothing is written until you apply'}
               </span>
               <button type="button" className="link" onClick={() => e.close()}>
                  cancel
               </button>
            </div>
         </div>
      </div>
   )
})

export const PromptEnhancer = observer(function PromptEnhancer(p: { v: VarSt; st: WebSt; module: string }) {
   const e = p.st.enhancer
   return (
      <>
         <button
            type="button"
            className="link"
            title="rewrite this prompt with an llm"
            onClick={() => e.openFor({ v: p.v, module: p.module })}
         >
            ✨ enhance
         </button>
         {e.target === p.v ? <Modal e={e} /> : null}
      </>
   )
})
