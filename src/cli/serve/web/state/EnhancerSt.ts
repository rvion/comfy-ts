// the prompt enhancer: LLM configs + the master-prompt library + one refine run
// (architecture item 12, web ui). Hangs off the WebSt root.
// SPLIT OF TRUTH: the LLM configs (`.comfy-ts/llm-configs/*.json`) and the master
// prompts (`.comfy-ts/prompt-enhancers/*.md`) are FILES on the server, autosaved like a
// draft, so every browser and app window shares one setup. Only the api keys and which
// entry is selected stay in a localStorage blob: the serve process never holds a key.
// normalizeSettings/nextPresetName are PURE and headless-tested.
import { makeAutoObservable, reaction, runInAction, type IReactionDisposer } from 'mobx'
import { stringMap } from 'src/utils/stringMap.ts'
import {
   deleteLlmConfig,
   deletePromptEnhancer,
   fetchLlmConfigs,
   fetchPromptEnhancers,
   saveLlmConfig,
   savePromptEnhancer,
   type PromptEnhancer,
} from 'src/cli/serve/web/api.ts'
import {
   isEffort,
   isProvider,
   normalizeLlmConfig,
   withProvider,
   type LlmConfig,
   type LlmConfigEntry,
} from 'src/cli/serve/llmConfigShape.ts'
import {
   fetchModels,
   streamRefine,
   type LlmModel,
   type ProviderId,
   type ReasoningEffort,
} from 'src/cli/serve/web/llm.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { finishRewrite, splitKeptLines } from 'src/cli/serve/web/state/keptLines.ts'
import { pushHistory, type HistoryEntry } from 'src/cli/serve/web/state/history.ts'
import { isPromptLanes, patchLane } from 'src/vars/lanes.ts'

const STORAGE_KEY = 'comfy-ts-serve-enhancer'

export const PROVIDERS: ProviderId[] = ['openrouter', 'openwebui', 'openai']

/** what stays in the browser: the keys, and which config and master prompt are selected */
export type EnhancerSettings = {
   keyByProvider: Record<string, string>
   /** selected LLM config, by FILE NAME */
   configName: string
   /** selected master prompt, by FILE NAME */
   presetName: string
   /** last preset used per module: a workflow reopens on its own refiner */
   presetByModule: Record<string, string>
}

/** stored blob → usable settings. A hand-edited or half-written localStorage entry must
 * degrade to defaults, never break the modal (same wire tolerance as every stored blob) */
export function normalizeSettings(raw: unknown): EnhancerSettings {
   const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
   return {
      keyByProvider: stringMap(o.keyByProvider),
      configName: typeof o.configName === 'string' ? o.configName : '',
      presetName: typeof o.presetName === 'string' ? o.presetName : '',
      presetByModule: stringMap(o.presetByModule),
   }
}

/** unique name for a new/duplicated entry (master prompt or config): the name IS the filename */
export function nextPresetName(base: string, taken: readonly string[]): string {
   if (!taken.includes(base)) return base
   for (let i = 2; i < 1000; i++) {
      const candidate = `${base} ${i}`
      if (!taken.includes(candidate)) return candidate
   }
   return `${base} ${taken.length + 1}`
}

/** the master prompt a workflow opens on when none was picked for it yet: the one whose name
 * shares the most words with the module (`10-anima-t2i` → `refine-anima-prompt`), the full
 * name before a `-basic` variant. null when no name shares a word */
export function guessPreset(module: string, names: readonly string[]): string | null {
   const words = (x: string): string[] =>
      x
         .toLowerCase()
         .split(/[^a-z0-9]+/)
         .filter((w) => w.length > 2 && !/^\d+$/.test(w))
   const mod = new Set(words(module))
   let best: { name: string; score: number } | null = null
   for (const name of names) {
      const score = words(name).filter((w) => mod.has(w)).length
      if (score === 0) continue
      if (best == null || score > best.score || (score === best.score && name.length < best.name.length))
         best = { name, score }
   }
   return best?.name ?? null
}

/** the text a prompt var holds: the string, or one lane's text, '' for anything else */
export function promptTextOf(value: unknown, lane: number | null): string {
   if (lane != null) return isPromptLanes(value) ? (value.lanes[lane]?.prompt ?? '') : ''
   return typeof value === 'string' ? value : ''
}

/** what the input holds when the modal opens: the previous one, or the prompt the first time */
export function openingInput(p: { previous: string; prompt: string }): string {
   return p.previous !== '' ? p.previous : p.prompt
}

function readStored(): EnhancerSettings {
   try {
      return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
   } catch {
      return normalizeSettings({})
   }
}

/** where a library's save stands, shown beside its bar */
export type SaveState = 'saved' | 'saving' | 'error'

export class EnhancerSt {
   keyByProvider: Record<string, string>
   configName: string
   presetName: string
   presetByModule: Record<string, string>

   /** the LLM configs, mirrored from the server (files) */
   configs: LlmConfigEntry[] = []
   configsState: 'idle' | 'loading' | 'error' = 'idle'
   configsError = ''
   configSaveState: SaveState = 'saved'
   configSaveError = ''

   /** the master prompts, mirrored from the server (files) */
   presets: PromptEnhancer[] = []
   presetsState: 'idle' | 'loading' | 'error' = 'idle'
   presetsError = ''
   saveState: SaveState = 'saved'
   saveError = ''

   /** per config name: does its endpoint answer the model list right now */
   configStatus = new Map<string, 'checking' | 'up' | 'down'>()
   configStatusError = new Map<string, string>()

   models: LlmModel[] = []
   modelsState: 'idle' | 'loading' | 'error' = 'idle'
   modelsError = ''

   /** the editor open over the job: the selected LLM's settings, or the master prompt's text.
    * null = the modal shows only yours → rewrite */
   editing: 'llm' | 'preset' | null = null

   /** every text an enhance started from, for the history picker (this page only) */
   inputHistory: HistoryEntry<string>[] = []

   /** the prompt var being refined — non-null IS the modal being open */
   target: VarSt | null = null
   /** in lanes mode, the lane being refined; null = the whole prompt */
   targetLane: number | null = null
   targetModule = ''
   original = ''
   result = ''
   thinking = ''
   phase: 'idle' | 'running' | 'done' | 'error' = 'idle'
   error = ''
   private abort: AbortController | null = null
   private disposers: IReactionDisposer[]
   /** the json the server last confirmed, per library — the autosave no-ops on it, so loading a
    * library (or switching entry) never writes the file back unchanged */
   private lastSaved = ''
   private lastSavedConfig = ''

   constructor() {
      const s = readStored()
      this.keyByProvider = s.keyByProvider
      this.configName = s.configName
      this.presetName = s.presetName
      this.presetByModule = s.presetByModule
      makeAutoObservable<EnhancerSt, 'abort' | 'disposers' | 'lastSaved' | 'lastSavedConfig'>(this, {
         abort: false,
         disposers: false,
         lastSaved: false,
         lastSavedConfig: false,
      })
      // both libraries autosave to their file, the live-drafts model (the json is change
      // detector AND payload, the house persistence idiom)
      this.disposers = [
         reaction(
            () => {
               const p = this.preset
               return p == null ? null : JSON.stringify(p)
            },
            (encoded) => {
               if (encoded == null || encoded === this.lastSaved) return
               void this.savePresetNow(JSON.parse(encoded) as PromptEnhancer)
            },
            { delay: 600 },
         ),
         reaction(
            () => {
               const c = this.configEntry
               return c == null ? null : JSON.stringify(c)
            },
            (encoded) => {
               if (encoded == null || encoded === this.lastSavedConfig) return
               void this.saveConfigNow(JSON.parse(encoded) as LlmConfigEntry)
            },
            { delay: 600 },
         ),
      ]
   }

   dispose(): void {
      for (const d of this.disposers) d()
   }

   // #region llm configs (server files) ----------------------------------------
   get configEntry(): LlmConfigEntry | null {
      return this.configs.find((c) => c.name === this.configName) ?? this.configs[0] ?? null
   }

   /** the active config; before any exists, the defaults (nothing is written for them) */
   get config(): LlmConfig {
      return this.configEntry?.config ?? normalizeLlmConfig({})
   }

   get provider(): ProviderId {
      return this.config.provider
   }

   get apiKey(): string {
      return this.keyByProvider[this.provider] ?? ''
   }

   get baseUrl(): string {
      return this.config.baseUrl
   }

   get model(): string {
      return this.config.model
   }

   get effort(): ReasoningEffort {
      return this.config.effort
   }

   get thinkingOnly(): boolean {
      return this.config.thinkingOnly
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
         keyByProvider: this.keyByProvider,
         configName: this.configName,
         presetName: this.presetName,
         presetByModule: this.presetByModule,
      }
   }

   private persist(): void {
      try {
         localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settingsJSON()))
      } catch {
         // storage full/blocked: the selection just won't survive the reload
      }
   }

   async loadConfigs(): Promise<void> {
      runInAction(() => {
         this.configsState = 'loading'
         this.configsError = ''
      })
      try {
         const reply = await fetchLlmConfigs()
         runInAction(() => {
            this.configs = reply.configs
            this.configsState = 'idle'
            if (!this.configs.some((c) => c.name === this.configName)) this.configName = this.configs[0]?.name ?? ''
            this.lastSavedConfig = JSON.stringify(this.configEntry)
         })
         void this.probeConfigs()
      } catch (e) {
         runInAction(() => {
            this.configsState = 'error'
            this.configsError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   private async saveConfigNow(entry: LlmConfigEntry): Promise<void> {
      runInAction(() => {
         this.configSaveState = 'saving'
         this.lastSavedConfig = JSON.stringify(entry)
      })
      try {
         const reply = await saveLlmConfig(entry)
         runInAction(() => {
            // the local copy of the saved entry wins over the server's normalized one: a base url
            // cleared to be retyped must not snap back to its default mid-typing
            this.configs = reply.configs.map((c) => this.configs.find((x) => x.name === c.name) ?? c)
            this.configSaveState = 'saved'
            this.configSaveError = ''
         })
      } catch (e) {
         runInAction(() => {
            this.configSaveState = 'error'
            this.configSaveError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   /** ask every config's endpoint for its model list, in parallel: the tabs show which ones
    * answer, and the selected one's list fills the model picker without a click */
   async probeConfigs(): Promise<void> {
      const entries = this.configs.map((c) => ({ name: c.name, config: c.config }))
      await Promise.all(
         entries.map(async (c) => {
            runInAction(() => this.configStatus.set(c.name, 'checking'))
            const endpoint = {
               provider: c.config.provider,
               baseUrl: c.config.baseUrl,
               key: this.keyByProvider[c.config.provider] ?? '',
            }
            try {
               const models = await fetchModels(endpoint)
               runInAction(() => {
                  this.configStatus.set(c.name, 'up')
                  this.configStatusError.delete(c.name)
                  if (c.name === this.configEntry?.name && this.models.length === 0) {
                     this.models = models
                     this.modelsState = 'idle'
                  }
               })
            } catch (e) {
               runInAction(() => {
                  this.configStatus.set(c.name, 'down')
                  this.configStatusError.set(c.name, e instanceof Error ? e.message : String(e))
               })
            }
         }),
      )
   }

   selectConfig(name: string): void {
      if (!this.configs.some((c) => c.name === name)) return
      this.configName = name
      this.lastSavedConfig = JSON.stringify(this.configEntry)
      // the loaded list belongs to the other config's endpoint
      this.clearModels()
      this.persist()
      if (this.configStatus.get(name) === 'up') void this.loadModels()
   }

   /** create (or duplicate): a new FILE, saved immediately so it exists on disk */
   addConfig(name: string, config: LlmConfig = normalizeLlmConfig({})): void {
      if (name.trim() === '') return
      const clean = nextPresetName(
         name.trim(),
         this.configs.map((c) => c.name),
      )
      this.configs = [...this.configs, { name: clean, config }]
      this.configName = clean
      this.clearModels()
      this.persist()
      void this.saveConfigNow({ name: clean, config })
   }

   duplicateConfig(): void {
      const c = this.configEntry
      if (c != null) this.addConfig(`${c.name} copy`, c.config)
   }

   /** rename = write the new file, delete the old one (the filename IS the identity) */
   async renameConfig(rawName: string): Promise<void> {
      const c = this.configEntry
      const clean = nextPresetName(
         rawName.trim(),
         this.configs.filter((x) => x.name !== c?.name).map((x) => x.name),
      )
      if (c == null || clean === '' || clean === c.name) return
      await this.saveConfigNow({ name: clean, config: c.config })
      runInAction(() => {
         this.configName = clean
         this.persist()
      })
      await this.removeConfigFile(c.name)
   }

   async deleteConfig(): Promise<void> {
      const c = this.configEntry
      if (c == null) return
      await this.removeConfigFile(c.name)
      runInAction(() => {
         if (!this.configs.some((x) => x.name === this.configName)) this.configName = this.configs[0]?.name ?? ''
         this.lastSavedConfig = JSON.stringify(this.configEntry)
         this.persist()
      })
   }

   private async removeConfigFile(name: string): Promise<void> {
      try {
         const reply = await deleteLlmConfig({ name })
         runInAction(() => {
            this.configs = reply.configs
         })
      } catch (e) {
         runInAction(() => {
            this.configSaveState = 'error'
            this.configSaveError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   /** every edit replaces the ENTRY, so the autosave reaction sees a change. With no config yet,
    * the first edit creates one: a setting typed into an empty modal is never dropped */
   private patchConfig(patch: (c: LlmConfig) => LlmConfig): void {
      const c = this.configEntry
      if (c == null) {
         this.addConfig('default', patch(this.config))
         return
      }
      this.configs = this.configs.map((x) => (x.name === c.name ? { name: x.name, config: patch(x.config) } : x))
   }

   private clearModels(): void {
      this.models = []
      this.modelsState = 'idle'
      this.modelsError = ''
   }

   setProvider(v: string): void {
      if (!isProvider(v)) return
      this.patchConfig((c) => withProvider(c, v))
      // the loaded list belongs to the OTHER provider: showing it would offer models this
      // endpoint has never heard of
      this.clearModels()
   }

   setApiKey(v: string): void {
      this.keyByProvider[this.provider] = v.trim()
      this.persist()
   }

   setBaseUrl(v: string): void {
      this.patchConfig((c) => ({ ...c, baseUrl: v.trim() }))
   }

   setModel(v: string): void {
      this.patchConfig((c) => ({ ...c, model: v }))
   }

   setEffort(v: string): void {
      if (!isEffort(v)) return
      this.patchConfig((c) => ({ ...c, effort: v }))
   }

   toggleThinkingOnly(): void {
      this.patchConfig((c) => ({ ...c, thinkingOnly: !c.thinkingOnly }))
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
   openFor(p: { v: VarSt; module: string; lane?: number }): void {
      this.target = p.v
      this.targetLane = p.lane ?? null
      this.targetModule = p.module
      // the input and the last rewrite stay across opens: iterating on one sketch must not mean
      // retyping it. `use the prompt` copies the prompt in on demand
      this.original = openingInput({ previous: this.original, prompt: promptTextOf(p.v.value, p.lane ?? null) })
      this.error = ''
      const remembered = this.presetByModule[p.module]
      if (remembered != null) this.presetName = remembered
      if (this.presets.length === 0) void this.loadPresets().then(() => this.guessFor(p.module))
      else this.guessFor(p.module)
      // re-read every open: a config edited in another window or by hand is picked up
      void this.loadConfigs()
   }

   /** no preset picked for this workflow yet: take the one its name points at */
   private guessFor(module: string): void {
      if (this.presetByModule[module] != null) return
      const guess = guessPreset(
         module,
         this.presets.map((x) => x.name),
      )
      if (guess == null) return
      this.presetName = guess
      this.lastSaved = JSON.stringify(this.preset)
   }

   setEditing(v: 'llm' | 'preset' | null): void {
      this.editing = v
   }

   /** the input becomes the prompt being refined (its lane in lanes mode) */
   usePrompt(): void {
      if (this.target == null) return
      this.original = promptTextOf(this.target.value, this.targetLane)
   }

   close(): void {
      this.editing = null
      this.cancel()
      this.target = null
      this.targetLane = null
      this.targetModule = ''
   }

   setResult(v: string): void {
      this.result = v
   }

   /** what gets SENT is editable too: sharpen the sketch, then refine, without closing the
    * modal. It stays a copy, only apply() writes the var */
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
            const name = this.configEntry?.name
            if (name != null) this.configStatus.set(name, 'up')
         })
      } catch (e) {
         runInAction(() => {
            this.modelsState = 'error'
            this.modelsError = e instanceof Error ? e.message : String(e)
            const name = this.configEntry?.name
            if (name != null) this.configStatus.set(name, 'down')
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
      // the negatives and comments never go to the model: they come back verbatim, on their own
      // lines, once it is done (keptLines.ts owns why)
      const split = splitKeptLines(this.original)
      this.inputHistory = pushHistory(this.inputHistory, {
         text: this.original,
         value: this.original,
         at: Date.now(),
         source: this.targetModule,
      })
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
            user: split.body,
            effort: this.effort,
            signal: controller.signal,
            onDelta: (d) =>
               runInAction(() => {
                  this.result += d.content
                  this.thinking += d.reasoning
               }),
         })
         runInAction(() => {
            this.result = finishRewrite(this.result, split.kept)
            this.phase = 'done'
         })
      } catch (e) {
         // an abort is a user gesture, not a failure to shout about
         const aborted = controller.signal.aborted
         runInAction(() => {
            if (aborted && this.result !== '') this.result = finishRewrite(this.result, split.kept)
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
      const value = this.target.value
      const lane = this.targetLane
      // a lane rewrite replaces that lane's text only, the others and their order stay
      if (lane != null && isPromptLanes(value))
         this.target.set({ lanes: patchLane(value.lanes, lane, { prompt: text }) })
      else this.target.set(text)
      this.close()
   }
}
