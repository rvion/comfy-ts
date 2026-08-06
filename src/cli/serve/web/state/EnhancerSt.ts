// the prompt enhancer: provider settings + the master-prompt library + one refine
// run (architecture item 12, web ui). Hangs off the WebSt root.
// SPLIT OF TRUTH: the master prompts are FILES on the server
// (`.comfy-ts/prompt-enhancers/*.md`, autosaved like a draft), everything else is
// browser-local in a localStorage blob — keys included, so the serve process never
// holds a credential. normalizeSettings/nextPresetName are PURE and headless-tested.
import { makeAutoObservable, reaction, runInAction, type IReactionDisposer } from 'mobx'
import { stringMap } from 'src/utils/stringMap.ts'
import {
   deletePromptEnhancer,
   fetchPromptEnhancers,
   savePromptEnhancer,
   type PromptEnhancer,
} from 'src/cli/serve/web/api.ts'
import {
   defaultBaseUrl,
   fetchModels,
   streamRefine,
   type LlmModel,
   type ProviderId,
   type ReasoningEffort,
} from 'src/cli/serve/web/llm.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'

const STORAGE_KEY = 'comfy-ts-serve-enhancer'

/** explicit model ids, never an alias: behaviour and cost stay reproducible */
const DEFAULT_MODEL: Record<ProviderId, string> = {
   openrouter: 'anthropic/claude-sonnet-5',
   openwebui: '',
}

export const PROVIDERS: ProviderId[] = ['openrouter', 'openwebui']

export type EnhancerSettings = {
   provider: ProviderId
   /** per provider, so switching one cannot send an openrouter model id to a local box */
   keyByProvider: Record<string, string>
   baseUrlByProvider: Record<string, string>
   modelByProvider: Record<string, string>
   effort: ReasoningEffort
   thinkingOnly: boolean
   /** selected master prompt, by FILE NAME */
   presetName: string
   /** last preset used per module: a workflow reopens on its own refiner */
   presetByModule: Record<string, string>
}

function isProvider(raw: unknown): raw is ProviderId {
   return raw === 'openrouter' || raw === 'openwebui'
}

function isEffort(raw: unknown): raw is ReasoningEffort {
   return raw === 'off' || raw === 'low' || raw === 'medium' || raw === 'high'
}

/** stored blob → usable settings. A hand-edited or half-written localStorage entry must
 * degrade to defaults, never break the modal (same wire tolerance as every stored blob) */
export function normalizeSettings(raw: unknown): EnhancerSettings {
   const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
   const models = stringMap(o.modelByProvider)
   const bases = stringMap(o.baseUrlByProvider)
   return {
      provider: isProvider(o.provider) ? o.provider : 'openrouter',
      keyByProvider: stringMap(o.keyByProvider),
      baseUrlByProvider: { openrouter: defaultBaseUrl('openrouter'), openwebui: defaultBaseUrl('openwebui'), ...bases },
      modelByProvider: { ...DEFAULT_MODEL, ...models },
      effort: isEffort(o.effort) ? o.effort : 'medium',
      thinkingOnly: o.thinkingOnly !== false,
      presetName: typeof o.presetName === 'string' ? o.presetName : '',
      presetByModule: stringMap(o.presetByModule),
   }
}

/** unique name for a new/duplicated master prompt — the name IS the filename */
export function nextPresetName(base: string, taken: readonly string[]): string {
   if (!taken.includes(base)) return base
   for (let i = 2; i < 1000; i++) {
      const candidate = `${base} ${i}`
      if (!taken.includes(candidate)) return candidate
   }
   return `${base} ${taken.length + 1}`
}

function readStored(): EnhancerSettings {
   try {
      return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
   } catch {
      return normalizeSettings({})
   }
}

export class EnhancerSt {
   provider: ProviderId
   keyByProvider: Record<string, string>
   baseUrlByProvider: Record<string, string>
   modelByProvider: Record<string, string>
   effort: ReasoningEffort
   thinkingOnly: boolean
   presetName: string
   presetByModule: Record<string, string>

   /** the master prompts, mirrored from the server (files) */
   presets: PromptEnhancer[] = []
   presetsState: 'idle' | 'loading' | 'error' = 'idle'
   presetsError = ''
   saveState: 'saved' | 'saving' | 'error' = 'saved'
   saveError = ''

   models: LlmModel[] = []
   modelsState: 'idle' | 'loading' | 'error' = 'idle'
   modelsError = ''

   /** the prompt var being refined — non-null IS the modal being open */
   target: VarSt | null = null
   targetModule = ''
   original = ''
   result = ''
   thinking = ''
   phase: 'idle' | 'running' | 'done' | 'error' = 'idle'
   error = ''
   private abort: AbortController | null = null
   private disposer: IReactionDisposer
   /** the preset json the server last confirmed — the autosave no-ops on it, so loading a
    * library (or switching preset) never writes the files back unchanged */
   private lastSaved = ''

   constructor() {
      const s = readStored()
      this.provider = s.provider
      this.keyByProvider = s.keyByProvider
      this.baseUrlByProvider = s.baseUrlByProvider
      this.modelByProvider = s.modelByProvider
      this.effort = s.effort
      this.thinkingOnly = s.thinkingOnly
      this.presetName = s.presetName
      this.presetByModule = s.presetByModule
      makeAutoObservable<EnhancerSt, 'abort' | 'disposer' | 'lastSaved'>(this, {
         abort: false,
         disposer: false,
         lastSaved: false,
      })
      // the master prompt autosaves to its file, the live-drafts model (the values json is
      // change-detector AND payload — the house persistence idiom)
      this.disposer = reaction(
         () => {
            const p = this.preset
            return p == null ? null : JSON.stringify(p)
         },
         (encoded) => {
            if (encoded == null || encoded === this.lastSaved) return
            void this.savePresetNow(JSON.parse(encoded) as PromptEnhancer)
         },
         { delay: 600 },
      )
   }

   dispose(): void {
      this.disposer()
   }

   // #region settings ---------------------------------------------------------
   get apiKey(): string {
      return this.keyByProvider[this.provider] ?? ''
   }

   get baseUrl(): string {
      return this.baseUrlByProvider[this.provider] ?? defaultBaseUrl(this.provider)
   }

   get model(): string {
      return this.modelByProvider[this.provider] ?? ''
   }

   get endpoint(): { provider: ProviderId; baseUrl: string; key: string } {
      return { provider: this.provider, baseUrl: this.baseUrl, key: this.apiKey }
   }

   /** the list the selector shows. A model whose capability is UNKNOWN (open webui reports
    * none) stays visible: only an explicit "no reasoning" is filtered out */
   get visibleModels(): LlmModel[] {
      return this.thinkingOnly ? this.models.filter((m) => m.reasoning !== false) : this.models
   }

   get preset(): PromptEnhancer | null {
      return this.presets.find((p) => p.name === this.presetName) ?? this.presets[0] ?? null
   }

   get isOpen(): boolean {
      return this.target != null
   }

   settingsJSON(): EnhancerSettings {
      return {
         provider: this.provider,
         keyByProvider: this.keyByProvider,
         baseUrlByProvider: this.baseUrlByProvider,
         modelByProvider: this.modelByProvider,
         effort: this.effort,
         thinkingOnly: this.thinkingOnly,
         presetName: this.presetName,
         presetByModule: this.presetByModule,
      }
   }

   private persist(): void {
      try {
         localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settingsJSON()))
      } catch {
         // storage full/blocked: settings just won't survive the reload
      }
   }

   setProvider(v: string): void {
      if (!isProvider(v)) return
      this.provider = v
      // the loaded list belongs to the OTHER provider: showing it would offer models this
      // endpoint has never heard of
      this.models = []
      this.modelsState = 'idle'
      this.modelsError = ''
      this.persist()
   }

   setApiKey(v: string): void {
      this.keyByProvider[this.provider] = v.trim()
      this.persist()
   }

   setBaseUrl(v: string): void {
      this.baseUrlByProvider[this.provider] = v.trim()
      this.persist()
   }

   setModel(v: string): void {
      this.modelByProvider[this.provider] = v
      this.persist()
   }

   setEffort(v: string): void {
      if (!isEffort(v)) return
      this.effort = v
      this.persist()
   }

   toggleThinkingOnly(): void {
      this.thinkingOnly = !this.thinkingOnly
      this.persist()
   }

   // #region master prompts (server files) -------------------------------------
   async loadPresets(): Promise<void> {
      runInAction(() => {
         this.presetsState = 'loading'
         this.presetsError = ''
      })
      try {
         const reply = await fetchPromptEnhancers()
         runInAction(() => {
            this.presets = reply.enhancers
            this.presetsState = 'idle'
            if (!this.presets.some((p) => p.name === this.presetName)) this.presetName = this.presets[0]?.name ?? ''
            this.lastSaved = JSON.stringify(this.preset)
         })
      } catch (e) {
         runInAction(() => {
            this.presetsState = 'error'
            this.presetsError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   private async savePresetNow(entry: PromptEnhancer): Promise<void> {
      runInAction(() => {
         this.saveState = 'saving'
         this.lastSaved = JSON.stringify(entry)
      })
      try {
         const reply = await savePromptEnhancer(entry)
         runInAction(() => {
            this.presets = reply.enhancers
            this.saveState = 'saved'
            this.saveError = ''
         })
      } catch (e) {
         runInAction(() => {
            this.saveState = 'error'
            this.saveError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   selectPreset(name: string): void {
      if (!this.presets.some((p) => p.name === name)) return
      this.presetName = name
      this.lastSaved = JSON.stringify(this.preset)
      if (this.targetModule !== '') this.presetByModule[this.targetModule] = name
      this.persist()
   }

   setPresetText(text: string): void {
      const p = this.preset
      if (p == null) return
      // replace the ENTRY, so the autosave reaction sees a change (the array is observable)
      this.presets = this.presets.map((x) => (x.name === p.name ? { ...x, text } : x))
   }

   /** create (or duplicate): a new FILE, saved immediately so it exists on disk */
   addPreset(name: string, text = ''): void {
      if (name.trim() === '') return
      const clean = nextPresetName(
         name.trim(),
         this.presets.map((p) => p.name),
      )
      this.presets = [...this.presets, { name: clean, text }]
      this.presetName = clean
      this.persist()
      void this.savePresetNow({ name: clean, text })
   }

   duplicatePreset(): void {
      const p = this.preset
      if (p != null) this.addPreset(`${p.name} copy`, p.text)
   }

   /** rename = write the new file, delete the old one (the filename IS the identity) */
   async renamePreset(rawName: string): Promise<void> {
      const p = this.preset
      const clean = nextPresetName(
         rawName.trim(),
         this.presets.filter((x) => x.name !== p?.name).map((x) => x.name),
      )
      if (p == null || clean === '' || clean === p.name) return
      await this.savePresetNow({ name: clean, text: p.text })
      runInAction(() => {
         this.presetName = clean
         this.persist()
      })
      await this.removePresetFile(p.name)
   }

   async deletePreset(): Promise<void> {
      const p = this.preset
      if (p == null) return
      await this.removePresetFile(p.name)
      runInAction(() => {
         // a deleted preset must not stay pinned to a module
         for (const [k, v] of Object.entries(this.presetByModule)) if (v === p.name) delete this.presetByModule[k]
         if (!this.presets.some((x) => x.name === this.presetName)) this.presetName = this.presets[0]?.name ?? ''
         this.persist()
      })
   }

   private async removePresetFile(name: string): Promise<void> {
      try {
         const reply = await deletePromptEnhancer({ name })
         runInAction(() => {
            this.presets = reply.enhancers
         })
      } catch (e) {
         runInAction(() => {
            this.saveState = 'error'
            this.saveError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   // #region the run ----------------------------------------------------------
   openFor(p: { v: VarSt; module: string }): void {
      this.target = p.v
      this.targetModule = p.module
      this.original = typeof p.v.value === 'string' ? p.v.value : ''
      this.result = ''
      this.thinking = ''
      this.error = ''
      this.phase = 'idle'
      const remembered = this.presetByModule[p.module]
      if (remembered != null) this.presetName = remembered
      if (this.presets.length === 0) void this.loadPresets()
   }

   close(): void {
      this.cancel()
      this.target = null
      this.targetModule = ''
   }

   setResult(v: string): void {
      this.result = v
   }

   /** what gets SENT is editable too: sharpen the sketch, then refine, without closing the
    * modal. It stays a copy — only apply() writes the var */
   setOriginal(v: string): void {
      this.original = v
   }

   async loadModels(): Promise<void> {
      runInAction(() => {
         this.modelsState = 'loading'
         this.modelsError = ''
      })
      try {
         const models = await fetchModels(this.endpoint)
         runInAction(() => {
            this.models = models
            this.modelsState = 'idle'
         })
      } catch (e) {
         runInAction(() => {
            this.modelsState = 'error'
            this.modelsError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   cancel(): void {
      this.abort?.abort()
      this.abort = null
      if (this.phase === 'running') this.phase = this.result === '' ? 'idle' : 'done'
   }

   run(): void {
      void this.runNow()
   }

   private async runNow(): Promise<void> {
      const preset = this.preset
      if (preset == null || this.phase === 'running') return
      const controller = new AbortController()
      this.abort = controller
      runInAction(() => {
         this.phase = 'running'
         this.error = ''
         this.result = ''
         this.thinking = ''
      })
      try {
         await streamRefine({
            endpoint: this.endpoint,
            model: this.model,
            system: preset.text,
            user: this.original,
            effort: this.effort,
            signal: controller.signal,
            onDelta: (d) =>
               runInAction(() => {
                  this.result += d.content
                  this.thinking += d.reasoning
               }),
         })
         runInAction(() => {
            this.phase = 'done'
         })
      } catch (e) {
         // an abort is a user gesture, not a failure to shout about
         const aborted = controller.signal.aborted
         runInAction(() => {
            this.phase = aborted ? (this.result === '' ? 'idle' : 'done') : 'error'
            if (!aborted) this.error = e instanceof Error ? e.message : String(e)
         })
      } finally {
         if (this.abort === controller) this.abort = null
      }
   }

   /** the ONLY write into the form: nothing lands on the var until this is clicked */
   apply(): void {
      const text = this.result.trim()
      if (this.target == null || text === '') return
      this.target.set(text)
      this.close()
   }
}
