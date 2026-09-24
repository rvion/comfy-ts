// ✨ on a prompt row → the refine modal: the LLM configs and the master prompts as two lists of
// vertical tabs on the left, the job (yours → rewrite) first on the right, then the selected
// LLM's settings and master prompt text. Nothing touches the var until APPLY.
import { Icon } from 'src/cli/serve/web/components/Icon.tsx'
import { observer } from 'mobx-react-lite'
import { useEffect, type ReactNode } from 'react'
import { MenuButton, MenuItem } from 'src/cli/serve/web/components/MenuButton.tsx'
import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'
import type { ProviderId, ReasoningEffort } from 'src/cli/serve/web/llm.ts'
import { PROVIDERS, type EnhancerSt, type SaveState } from 'src/cli/serve/web/state/EnhancerSt.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

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
 * select it, its ⋯ holds duplicate / rename / delete, `+ new` closes the list. On a narrow
 * screen the same list is a dropdown (css swaps them) */
const TabList = observer(function TabList(p: {
   title: string
   names: string[]
   selected: string
   kind: string
   newName: string
   save: SaveState
   saveError: string
   /** a dot before the name (the LLM's up/down), absent = none */
   status?: (name: string) => { cls: string; tip: string } | null
   onSelect(name: string): void
   onCreate(name: string): void
   onDuplicate(): void
   onRename(name: string): void
   onDelete(): void
}) {
   const create = (): void => {
      const name = window.prompt(`name the new ${p.kind}`, p.newName)
      if (name != null) p.onCreate(name)
   }
   const rename = (): void => {
      const name = window.prompt(`rename this ${p.kind} (renames the file)`, p.selected)
      if (name != null) p.onRename(name)
   }
   const remove = (): void => {
      if (window.confirm(`delete ${p.kind} '${p.selected}'? its file is removed.`)) p.onDelete()
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
                     <MenuButton tip={`${p.kind}: duplicate, rename, delete`}>
                        {(close) => (
                           <>
                              <MenuItem
                                 label="duplicate"
                                 onClick={() => {
                                    close()
                                    p.onDuplicate()
                                 }}
                              />
                              <MenuItem
                                 label="rename"
                                 onClick={() => {
                                    close()
                                    rename()
                                 }}
                              />
                              <MenuItem
                                 label="delete"
                                 onClick={() => {
                                    close()
                                    remove()
                                 }}
                              />
                           </>
                        )}
                     </MenuButton>
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
               <div className="enh-empty">no llm config yet: set one up on the right, it is saved as you type</div>
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
               onCreate={(n) => e.addConfig(n)}
               onDuplicate={() => e.duplicateConfig()}
               onRename={(n) => void e.renameConfig(n)}
               onDelete={() => void e.deleteConfig()}
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
               onSelect={(n) => e.selectPreset(n)}
               onCreate={(n) => e.addPreset(n)}
               onDuplicate={() => e.duplicatePreset()}
               onRename={(n) => void e.renamePreset(n)}
               onDelete={() => void e.deletePreset()}
            />
         )}
      </nav>
   )
})

/** a numbered section with a title you can read from across the room */
function Section(p: { n: number; title: ReactNode; tip?: string; children: ReactNode }): ReactNode {
   return (
      <section className="enh-section">
         <h3 className="enh-h" data-tip={p.tip}>
            <span className="enh-num">{p.n}</span>
            {p.title}
         </h3>
         {p.children}
      </section>
   )
}

const LlmSettings = observer(function LlmSettings(p: { e: EnhancerSt }) {
   const e = p.e
   const models = e.visibleModels
   const local = e.provider !== 'openrouter'
   const entry = e.configEntry
   return (
      <Section
         n={2}
         title={
            <>
               llm <span className="enh-h-name">{entry?.name ?? 'new'}</span>
            </>
         }
         tip={
            entry == null
               ? 'any edit creates the config file'
               : `.comfy-ts/llm-configs/${entry.name}.json, saved as you type`
         }
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
      </Section>
   )
})

const MasterPrompt = observer(function MasterPrompt(p: { e: EnhancerSt }) {
   const preset = p.e.preset
   return (
      <Section
         n={3}
         title={
            <>
               master prompt <span className="enh-h-name">{preset?.name ?? ''}</span>
            </>
         }
         tip={preset == null ? undefined : `.comfy-ts/prompt-enhancers/${preset.name}.md, saved as you type`}
      >
         {preset == null ? (
            <div className="enh-empty">
               {p.e.presetsState === 'loading' ? 'loading…' : 'no master prompt yet: add one on the left'}
            </div>
         ) : (
            <textarea
               className="enh-text"
               rows={10}
               value={preset.text}
               onChange={(ev) => p.e.setPresetText(ev.target.value)}
            />
         )}
         {p.e.presetsError !== '' ? <div className="error">🔴 {p.e.presetsError}</div> : null}
      </Section>
   )
})

const Job = observer(function Job(p: { e: EnhancerSt }) {
   const e = p.e
   const running = e.phase === 'running'
   return (
      <Section n={1} title="your prompt → rewrite">
         <div className="enh-cols">
            <div>
               <div className="enh-label">yours, what gets sent (the form is untouched)</div>
               <textarea
                  className="enh-text"
                  rows={8}
                  value={e.original}
                  onChange={(ev) => e.setOriginal(ev.target.value)}
               />
            </div>
            <div>
               <div className="enh-label">
                  {running ? `rewriting… ${e.result.length} chars` : 'rewrite, editable before you apply'}
               </div>
               <textarea
                  className="enh-text enh-result"
                  rows={8}
                  value={e.result}
                  placeholder="press enhance"
                  onChange={(ev) => e.setResult(ev.target.value)}
               />
            </div>
         </div>
         <div className="enh-actions">
            {running ? (
               <button type="button" className="enh-big" onClick={() => e.cancel()}>
                  stop
               </button>
            ) : (
               <button type="button" className="primary enh-big" onClick={() => e.run()}>
                  <Icon name="sparkle" /> enhance <span className="kbd-hint">{MOD_KEY}⏎</span>
               </button>
            )}
            <button
               type="button"
               className="accent enh-big"
               onClick={() => e.apply()}
               disabled={e.result.trim() === ''}
            >
               apply to prompt
            </button>
         </div>
         {e.error !== '' ? <div className="error">🔴 {e.error}</div> : null}
         {e.thinking !== '' ? (
            <details className="enh-think-box">
               <summary>thinking ({e.thinking.length} chars)</summary>
               <div className="enh-think">{e.thinking}</div>
            </details>
         ) : null}
      </Section>
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
               <div className="modal-body enh-main">
                  <Job e={e} />
                  <LlmSettings e={e} />
                  <MasterPrompt e={e} />
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
         </button>
         {e.target === p.v && e.targetLane === (p.lane ?? null) ? <Modal e={e} /> : null}
      </>
   )
})
