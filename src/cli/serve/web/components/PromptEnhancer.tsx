// ✨ on a prompt row → the refine modal: the LLM configs and the master prompts as two lists of
// vertical tabs on the left, the job (yours → rewrite) alone on the right. A tab's pen opens its
// editor over the job. Nothing touches the var until APPLY.
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, type ReactNode } from 'react'
import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'
import { HistoryButton } from 'src/cli/serve/web/components/HistoryPicker.tsx'
import type { ProviderId, ReasoningEffort } from 'src/cli/serve/web/llm.ts'
import { PROVIDERS, type EnhancerSt, type SaveState } from 'src/cli/serve/web/state/EnhancerSt.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'
import {
   ENHANCER_KEYS,
   enhancerShortcutOf,
   SHORTCUT_KEYS,
   type EnhancerShortcut,
} from 'src/cli/serve/web/state/shortcuts.ts'

const EFFORTS: ReasoningEffort[] = ['off', 'low', 'medium', 'high']

const PROVIDER_LABEL: Record<ProviderId, string> = {
   openrouter: 'openrouter (cloud)',
   openwebui: 'open webui (local)',
   openai: 'llama.cpp / ollama / vllm (openai /v1)',
}

const BASE_PLACEHOLDER: Record<ProviderId, string> = {
   openrouter: '',
   openwebui: 'http://localhost:3000',
   openai: 'http://localhost:8080/v1',
}

/** one library of named files (LLM configs, master prompts) as VERTICAL TABS: click a tab to
 * select it, its pen opens its editor over the job, `+ new` closes the list. On a narrow
 * screen the same list is a dropdown (css swaps them) */
const TabList = observer(function TabList(p: {
   title: string
   names: string[]
   selected: string
   kind: string
   newName: string
   save: SaveState
   saveError: string
   /** its editor is open over the job */
   editing: boolean
   onEdit(): void
   /** a dot before the name (the LLM's up/down), absent = none */
   status?: (name: string) => { cls: string; tip: string } | null
   onSelect(name: string): void
   onCreate(name: string): void
}) {
   const create = (): void => {
      const name = window.prompt(`name the new ${p.kind}`, p.newName)
      if (name != null) p.onCreate(name)
   }
   const dot = (name: string): ReactNode => {
      const st = p.status?.(name) ?? null
      return st == null ? null : <span className={`enh-dot ${st.cls}`} data-tip={st.tip} />
   }
   return (
      <div className="enh-tabs">
         <div className="enh-tabs-title">
            {p.title}
            {p.save === 'saving' ? <span className="enh-save">saving…</span> : null}
            {p.save === 'error' ? (
               <span className="enh-save error" data-tip={p.saveError}>
                  🔴 not saved
               </span>
            ) : null}
         </div>
         <select className="enh-tab-select" value={p.selected} onChange={(ev) => p.onSelect(ev.target.value)}>
            {p.names.map((n) => (
               <option key={n} value={n}>
                  {n}
               </option>
            ))}
         </select>
         <div className="enh-tab-list" role="tablist">
            {p.names.map((n) => (
               <div key={n} className={n === p.selected ? 'enh-tab sel' : 'enh-tab'}>
                  <button type="button" role="tab" aria-selected={n === p.selected} onClick={() => p.onSelect(n)}>
                     {dot(n)}
                     <span className="enh-tab-name">{n}</span>
                  </button>
                  {n === p.selected ? (
                     <button
                        type="button"
                        className={p.editing ? 'enh-tab-edit sel' : 'enh-tab-edit'}
                        data-tip={p.editing ? 'close the editor' : `edit this ${p.kind}`}
                        onClick={() => p.onEdit()}
                     >
                        <Icon name="pen" />
                     </button>
                  ) : null}
               </div>
            ))}
            <button type="button" className="enh-tab-new" onClick={create}>
               <Icon name="plus" /> new {p.kind}
            </button>
         </div>
      </div>
   )
})

const Side = observer(function Side(p: { e: EnhancerSt }) {
   const e = p.e
   const entry = e.configEntry
   const preset = e.preset
   return (
      <nav className="enh-side">
         {entry == null ? (
            <div className="enh-tabs">
               <div className="enh-tabs-title">llm</div>
               <button type="button" className="enh-tab-new" onClick={() => e.setEditing('llm')}>
                  <Icon name="plus" /> set up an llm
               </button>
            </div>
         ) : (
            <TabList
               title="llm"
               names={e.configs.map((c) => c.name)}
               selected={entry.name}
               kind="llm"
               newName="my-llm"
               save={e.configSaveState}
               saveError={e.configSaveError}
               editing={e.editing === 'llm'}
               onEdit={() => e.setEditing(e.editing === 'llm' ? null : 'llm')}
               status={(name) => {
                  const st = e.configStatus.get(name)
                  if (st == null) return null
                  const err = e.configStatusError.get(name)
                  return {
                     cls: st,
                     tip: st === 'up' ? 'answers' : st === 'checking' ? 'checking…' : `does not answer: ${err ?? ''}`,
                  }
               }}
               onSelect={(n) => e.selectConfig(n)}
               onCreate={(n) => {
                  e.addConfig(n)
                  e.setEditing('llm')
               }}
            />
         )}
         {preset == null ? (
            <div className="enh-tabs">
               <div className="enh-tabs-title">master prompt</div>
               <button type="button" className="enh-tab-new" onClick={() => e.addPreset('refine-prompt')}>
                  <Icon name="plus" /> new master prompt
               </button>
            </div>
         ) : (
            <TabList
               title="master prompt"
               names={e.presets.map((m) => m.name)}
               selected={preset.name}
               kind="master prompt"
               newName="refine-<model>-prompt"
               save={e.saveState}
               saveError={e.saveError}
               editing={e.editing === 'preset'}
               onEdit={() => e.setEditing(e.editing === 'preset' ? null : 'preset')}
               onSelect={(n) => e.selectPreset(n)}
               onCreate={(n) => {
                  e.addPreset(n)
                  e.setEditing('preset')
               }}
            />
         )}
      </nav>
   )
})

/** the editor over the job: a title with the entry's name, its file actions, its fields */
function EditPanel(p: {
   kind: string
   name: string | null
   tip?: string
   onRename(name: string): void
   onDuplicate(): void
   onDelete(): void
   onClose(): void
   children: ReactNode
}): ReactNode {
   const rename = (): void => {
      if (p.name == null) return
      const name = window.prompt(`rename this ${p.kind} (renames the file)`, p.name)
      if (name != null) p.onRename(name)
   }
   const remove = (): void => {
      if (p.name == null) return
      if (window.confirm(`delete ${p.kind} '${p.name}'? its file is removed.`)) p.onDelete()
   }
   return (
      <section className="enh-edit">
         <div className="enh-edit-head">
            <h3 className="enh-h" data-tip={p.tip}>
               {p.kind} <span className="enh-h-name">{p.name ?? 'new'}</span>
            </h3>
            {p.name == null ? null : (
               <span className="btn-group">
                  <button type="button" onClick={() => p.onDuplicate()}>
                     duplicate
                  </button>
                  <button type="button" onClick={rename}>
                     rename
                  </button>
                  <button type="button" className="quiet-danger" onClick={remove}>
                     <Icon name="trash" /> delete
                  </button>
               </span>
            )}
            <button
               type="button"
               className="enh-edit-close"
               data-tip="done (esc), everything is already saved"
               onClick={() => p.onClose()}
            >
               done
            </button>
         </div>
         <div className="enh-edit-body">{p.children}</div>
      </section>
   )
}

const LlmSettings = observer(function LlmSettings(p: { e: EnhancerSt }) {
   const e = p.e
   const models = e.visibleModels
   const local = e.provider !== 'openrouter'
   const entry = e.configEntry
   return (
      <EditPanel
         kind="llm"
         name={entry?.name ?? null}
         tip={
            entry == null
               ? 'any edit creates the config file'
               : `.comfy-ts/llm-configs/${entry.name}.json, saved as you type`
         }
         onRename={(n) => void e.renameConfig(n)}
         onDuplicate={() => e.duplicateConfig()}
         onDelete={() => void e.deleteConfig()}
         onClose={() => e.setEditing(null)}
      >
         <div className="enh-grid">
            <label>provider</label>
            <select value={e.provider} onChange={(ev) => e.setProvider(ev.target.value)}>
               {PROVIDERS.map((id) => (
                  <option key={id} value={id}>
                     {PROVIDER_LABEL[id]}
                  </option>
               ))}
            </select>
            {local ? (
               <>
                  <label>address</label>
                  <input
                     type="text"
                     placeholder={BASE_PLACEHOLDER[e.provider]}
                     value={e.baseUrl}
                     onChange={(ev) => e.setBaseUrl(ev.target.value)}
                  />
               </>
            ) : null}
            <label data-tip="kept in this browser only, never in a file">api key</label>
            <input
               type="password"
               placeholder={local ? 'blank if none' : 'sk-or-v1-…'}
               value={e.apiKey}
               onChange={(ev) => e.setApiKey(ev.target.value)}
            />
            <label>model</label>
            <div className="enh-inline">
               {models.length > 0 ? (
                  <select value={e.model} onChange={(ev) => e.setModel(ev.target.value)}>
                     {models.some((m) => m.id === e.model) ? null : (
                        <option value={e.model}>{e.model} (not in the list)</option>
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
                     placeholder={local ? 'e.g. qwen3:8b' : 'e.g. anthropic/claude-sonnet-5'}
                     value={e.model}
                     onChange={(ev) => e.setModel(ev.target.value)}
                  />
               )}
               <button type="button" onClick={() => void e.loadModels()} disabled={e.modelsState === 'loading'}>
                  {e.modelsState === 'loading' ? 'asking…' : 'list models'}
               </button>
            </div>
            {e.provider === 'openwebui' ? null : (
               <>
                  <label
                     data-tip={
                        local
                           ? 'off = no thinking (chat template switch), anything else = think first'
                           : 'reasoning effort sent to the model'
                     }
                  >
                     thinking
                  </label>
                  <div className="enh-inline">
                     <span className="btn-group">
                        {EFFORTS.map((x) => (
                           <button
                              key={x}
                              type="button"
                              className={e.effort === x ? 'mode sel' : 'mode'}
                              onClick={() => e.setEffort(x)}
                           >
                              {x}
                           </button>
                        ))}
                     </span>
                     <label className="row-inline" data-tip="hide models that report no reasoning support">
                        <input type="checkbox" checked={e.thinkingOnly} onChange={() => e.toggleThinkingOnly()} />
                        thinking models only
                     </label>
                  </div>
               </>
            )}
         </div>
         {e.modelsError !== '' ? <div className="error">🔴 {e.modelsError}</div> : null}
         {e.configsError !== '' ? <div className="error">🔴 {e.configsError}</div> : null}
      </EditPanel>
   )
})

const MasterPrompt = observer(function MasterPrompt(p: { e: EnhancerSt }) {
   const preset = p.e.preset
   return (
      <EditPanel
         kind="master prompt"
         name={preset?.name ?? null}
         tip={preset == null ? undefined : `.comfy-ts/prompt-enhancers/${preset.name}.md, saved as you type`}
         onRename={(n) => void p.e.renamePreset(n)}
         onDuplicate={() => p.e.duplicatePreset()}
         onDelete={() => void p.e.deletePreset()}
         onClose={() => p.e.setEditing(null)}
      >
         {preset == null ? (
            <div className="enh-empty">
               {p.e.presetsState === 'loading' ? 'loading…' : 'no master prompt yet: add one on the left'}
            </div>
         ) : (
            <textarea
               className="enh-text enh-master"
               rows={18}
               value={preset.text}
               onChange={(ev) => p.e.setPresetText(ev.target.value)}
            />
         )}
         {p.e.presetsError !== '' ? <div className="error">🔴 {p.e.presetsError}</div> : null}
      </EditPanel>
   )
})

/** the job, top to bottom: the actions, then yours, then the rewrite. The two boxes share the
 * height the modal has, so nothing scrolls and nothing below the buttons ever moves them */
const Job = observer(function Job(p: { e: EnhancerSt; st: WebSt }) {
   const e = p.e
   const running = e.phase === 'running'
   // opening the enhancer puts you IN the input, the cursor after its last character: the next
   // thing you do is type or press ⌘E
   const inputRef = useRef<HTMLTextAreaElement>(null)
   useEffect(() => {
      const el = inputRef.current
      if (el == null) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
   }, [])
   const act = actions(e)
   const kbd = (s: EnhancerShortcut): ReactNode => (
      <span className="kbd-hint">
         {MOD_KEY}
         {ENHANCER_KEYS[s]}
      </span>
   )
   const noResult = e.result.trim() === ''
   return (
      <section className="enh-job">
         <div className="enh-actions">
            {/* one width for enhance and stop, so the swap never moves apply */}
            {running ? (
               <button type="button" className="enh-big enh-go" onClick={() => e.cancel()}>
                  stop
               </button>
            ) : (
               <button type="button" className="primary enh-big enh-go" onClick={act.enhance}>
                  <Icon name="sparkle" /> enhance {kbd('enhance')}
               </button>
            )}
            <button
               type="button"
               className="enh-big"
               data-tip="generate the draft with this rewrite in place of the prompt: the prompt itself is not changed"
               onClick={() => p.st.generate(e.tryOverride)}
               disabled={noResult}
            >
               <Icon name="play" size={0.85} /> try it <span className="kbd-hint">{MOD_KEY}⏎</span>
            </button>
            <button
               type="button"
               className="accent enh-big"
               data-tip="write this rewrite into the prompt and close"
               onClick={act.apply}
               disabled={noResult}
            >
               apply to prompt {kbd('apply')}
            </button>
            <span className="run-error" data-tip={e.error === '' ? undefined : e.error}>
               {e.error === '' ? '' : `🔴 ${e.error}`}
            </span>
         </div>
         <div className="enh-label enh-label-row">
            <span>yours, what gets sent (the form is untouched)</span>
            <span className="row-inline">
               <button
                  type="button"
                  className="mini"
                  data-tip="replace this text with the prompt you opened the enhancer from"
                  onClick={() => e.usePrompt()}
               >
                  use the prompt
               </button>
               <HistoryButton entries={e.inputHistory} what="enhance input" onPick={(h) => e.setOriginal(h.value)} />
            </span>
         </div>
         <textarea
            ref={inputRef}
            className="enh-text enh-box"
            value={e.original}
            onChange={(ev) => e.setOriginal(ev.target.value)}
         />
         <div className="enh-label">
            {running ? `rewriting… ${e.result.length} chars` : 'rewrite, editable before you apply'}
            {e.thinking === '' ? null : (
               <span className="enh-think-tip" data-tip={e.thinking}>
                  · thinking ({e.thinking.length} chars)
               </span>
            )}
         </div>
         <textarea
            className="enh-text enh-box enh-result"
            value={e.result}
            placeholder="press enhance"
            onChange={(ev) => e.setResult(ev.target.value)}
         />
      </section>
   )
})

/** the enhancer's own actions, shared by the buttons and the keys so they cannot drift apart.
 * try is the global ⌘⏎ (VarsForm), through EnhancerSt.tryOverride like its button */
function actions(e: EnhancerSt): Record<EnhancerShortcut, () => void> {
   return {
      enhance: () => (e.phase === 'running' ? undefined : e.run()),
      apply: () => e.apply(),
   }
}

const Modal = observer(function Modal(p: { e: EnhancerSt; st: WebSt }) {
   const e = p.e
   const st = p.st
   useEffect(() => {
      const onKey = (ev: KeyboardEvent): void => {
         // esc closes the editor first, the modal only when nothing is open over the job
         if (ev.key === 'Escape') {
            if (e.editing != null) e.setEditing(null)
            else e.close()
            return
         }
         const s = enhancerShortcutOf(ev)
         if (s == null) return
         ev.preventDefault()
         actions(e)[s]()
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
   }, [e, st])
   return (
      <div className="modal-overlay top" onClick={() => e.close()}>
         <div className="modal enh-modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-head">
               <b className="enh-title">
                  <Icon name="sparkle" /> enhance prompt
               </b>
               <button
                  type="button"
                  className="modal-close"
                  data-tip="close (esc), nothing is applied"
                  onClick={() => e.close()}
               >
                  <Icon name="close" />
               </button>
            </div>
            <div className="enh-layout">
               <Side e={e} />
               <div className="enh-right">
                  <div className="modal-body enh-main">
                     <Job e={e} st={st} />
                  </div>
                  {/* over the job, never beside it: the job keeps its place and size */}
                  {e.editing === 'llm' ? <LlmSettings e={e} /> : null}
                  {e.editing === 'preset' ? <MasterPrompt e={e} /> : null}
               </div>
            </div>
         </div>
      </div>
   )
})

export const PromptEnhancer = observer(function PromptEnhancer(p: {
   v: VarSt
   st: WebSt
   module: string
   /** in lanes mode: refine this lane only */
   lane?: number
   /** the icon alone, for a lane's bar */
   compact?: boolean
   /** ⌘E opens THIS one (the first prompt): say so on the button */
   shortcut?: boolean
}) {
   const e = p.st.enhancer
   return (
      <>
         <button
            type="button"
            className={p.compact === true ? 'link' : 'mini'}
            data-tip="rewrite this prompt with an llm"
            onClick={() => e.openFor({ v: p.v, module: p.module, lane: p.lane })}
         >
            <Icon name="sparkle" />
            {p.compact === true ? null : ' enhance'}
            {p.shortcut === true ? (
               <span className="kbd-hint">
                  {MOD_KEY}
                  {SHORTCUT_KEYS['open-enhancer']}
               </span>
            ) : null}
         </button>
         {e.target === p.v && e.targetLane === (p.lane ?? null) ? <Modal e={e} st={p.st} /> : null}
      </>
   )
})
