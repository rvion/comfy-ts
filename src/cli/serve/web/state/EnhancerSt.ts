// the prompt enhancer: settings + one refine run (architecture item 12, web ui).
// Hangs off the WebSt root. Its own localStorage blob, the api key included —
// browser-only by design, so the serve process never sees a credential.
// normalizeSettings/nextPresetName are PURE and headless-tested.
import { makeAutoObservable, runInAction } from 'mobx'
import { fetchModels, streamRefine, type OpenRouterModel, type ReasoningEffort } from 'src/cli/serve/web/openrouter.ts'
import type { VarSt } from 'src/cli/serve/web/state/FormSt.ts'

const STORAGE_KEY = 'comfy-ts-serve-enhancer'

/** explicit model ids, never an alias: behaviour and cost stay reproducible */
const DEFAULT_MODEL = 'anthropic/claude-sonnet-5'

export type MasterPrompt = { id: string; name: string; text: string }

const KREA2_MASTER = `You rewrite image prompts for krea2 turbo, a distilled 8 step text to image model whose text encoder reads flowing natural language, not tag soup, and which is steered by adjectives rather than by negatives.

Rewrite the user's prompt into ONE dense paragraph someone could picture with their eyes closed:
- keep every noun and every named subject the user wrote, they are the point
- add what is missing to make it fun to look at: lighting, palette, material, texture, camera angle, composition, mood
- prefer concrete visual nouns over praise, never write "masterpiece", "8k", "highly detailed", "award winning"
- stay under about 80 words, no lists, no headings, no quotes around the result
- keep any "// " comment line and any "- " negative line from the input verbatim, each on its own line

Answer with the rewritten prompt and nothing else: no preamble, no explanation.`

/** shipped starting point, not a contract: a refiner is specific to the image model it feeds,
 * so the library is editable and this one is just the first entry */
export function defaultPresets(): MasterPrompt[] {
   return [{ id: 'refine-krea2-prompt', name: 'refine-krea2-prompt', text: KREA2_MASTER }]
}

export type EnhancerSettings = {
   apiKey: string
   model: string
   effort: ReasoningEffort
   thinkingOnly: boolean
   presets: MasterPrompt[]
   presetId: string
   /** last preset used per module: a workflow reopens on its own refiner */
   presetByModule: Record<string, string>
}

function str(raw: unknown, fallback: string): string {
   return typeof raw === 'string' && raw !== '' ? raw : fallback
}

function isEffort(raw: unknown): raw is ReasoningEffort {
   return raw === 'off' || raw === 'low' || raw === 'medium' || raw === 'high'
}

/** stored blob → usable settings. Same wire tolerance as every other stored blob: a hand-edited
 * or half-written localStorage entry must degrade to defaults, never break the modal */
export function normalizeSettings(raw: unknown): EnhancerSettings {
   const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
   const presets: MasterPrompt[] = []
   if (Array.isArray(o.presets)) {
      for (const entry of o.presets) {
         const p = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
         const id = str(p.id, '')
         if (id === '') continue
         presets.push({ id, name: str(p.name, id), text: typeof p.text === 'string' ? p.text : '' })
      }
   }
   // an EMPTY library means first run, so seed it; a library he emptied on purpose keeps
   // one entry anyway, because the modal needs something to send
   const library = presets.length > 0 ? presets : defaultPresets()
   const byModule: Record<string, string> = {}
   if (typeof o.presetByModule === 'object' && o.presetByModule !== null) {
      for (const [k, v] of Object.entries(o.presetByModule)) if (typeof v === 'string') byModule[k] = v
   }
   const wantedId = str(o.presetId, '')
   return {
      apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
      model: str(o.model, DEFAULT_MODEL),
      effort: isEffort(o.effort) ? o.effort : 'medium',
      thinkingOnly: o.thinkingOnly !== false,
      presets: library,
      presetId: library.some((p) => p.id === wantedId) ? wantedId : (library[0]?.id ?? ''),
      presetByModule: byModule,
   }
}

/** unique name for a new/duplicated preset — a library of three "copy" entries is unusable */
export function nextPresetName(base: string, taken: readonly string[]): string {
   if (!taken.includes(base)) return base
   for (let i = 2; i < 1000; i++) {
      const candidate = `${base} ${i}`
      if (!taken.includes(candidate)) return candidate
   }
   return `${base} ${taken.length + 1}`
}

function newId(): string {
   return `mp-${Math.random().toString(36).slice(2, 10)}`
}

function readStored(): EnhancerSettings {
   try {
      return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
   } catch {
      return normalizeSettings({})
   }
}

export class EnhancerSt {
   apiKey: string
   model: string
   effort: ReasoningEffort
   thinkingOnly: boolean
   presets: MasterPrompt[]
   presetId: string
   presetByModule: Record<string, string>

   models: OpenRouterModel[] = []
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

   constructor() {
      const s = readStored()
      this.apiKey = s.apiKey
      this.model = s.model
      this.effort = s.effort
      this.thinkingOnly = s.thinkingOnly
      this.presets = s.presets
      this.presetId = s.presetId
      this.presetByModule = s.presetByModule
      makeAutoObservable<EnhancerSt, 'abort'>(this, { abort: false })
   }

   get preset(): MasterPrompt | null {
      return this.presets.find((p) => p.id === this.presetId) ?? this.presets[0] ?? null
   }

   get isOpen(): boolean {
      return this.target != null
   }

   /** the list the selector shows: thinking models only unless the toggle is off */
   get visibleModels(): OpenRouterModel[] {
      return this.thinkingOnly ? this.models.filter((m) => m.reasoning) : this.models
   }

   openFor(p: { v: VarSt; module: string }): void {
      this.target = p.v
      this.targetModule = p.module
      this.original = typeof p.v.value === 'string' ? p.v.value : ''
      this.result = ''
      this.thinking = ''
      this.error = ''
      this.phase = 'idle'
      const remembered = this.presetByModule[p.module]
      if (remembered != null && this.presets.some((x) => x.id === remembered)) this.presetId = remembered
   }

   close(): void {
      this.cancel()
      this.target = null
      this.targetModule = ''
   }

   settingsJSON(): EnhancerSettings {
      return {
         apiKey: this.apiKey,
         model: this.model,
         effort: this.effort,
         thinkingOnly: this.thinkingOnly,
         presets: this.presets,
         presetId: this.presetId,
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

   setApiKey(v: string): void {
      this.apiKey = v.trim()
      this.persist()
   }

   setModel(v: string): void {
      this.model = v
      this.persist()
   }

   /** takes the raw select value: validating here keeps the component cast-free */
   setEffort(v: string): void {
      if (!isEffort(v)) return
      this.effort = v
      this.persist()
   }

   /** the rewrite is editable before it is applied */
   setResult(v: string): void {
      this.result = v
   }

   /** what gets SENT is editable too: sharpen the sketch, then refine, without closing the modal.
    * It stays a copy — only apply() writes the var */
   setOriginal(v: string): void {
      this.original = v
   }

   toggleThinkingOnly(): void {
      this.thinkingOnly = !this.thinkingOnly
      this.persist()
   }

   selectPreset(id: string): void {
      if (!this.presets.some((p) => p.id === id)) return
      this.presetId = id
      if (this.targetModule !== '') this.presetByModule[this.targetModule] = id
      this.persist()
   }

   private replacePreset(next: MasterPrompt): void {
      this.presets = this.presets.map((p) => (p.id === next.id ? next : p))
      this.persist()
   }

   setPresetText(text: string): void {
      const p = this.preset
      if (p != null) this.replacePreset({ ...p, text })
   }

   renamePreset(name: string): void {
      const p = this.preset
      const clean = name.trim()
      if (p == null || clean === '') return
      this.replacePreset({
         ...p,
         name: nextPresetName(
            clean,
            this.presets.filter((x) => x.id !== p.id).map((x) => x.name),
         ),
      })
   }

   addPreset(name: string, text = ''): void {
      const clean = name.trim()
      if (clean === '') return
      const entry: MasterPrompt = {
         id: newId(),
         name: nextPresetName(
            clean,
            this.presets.map((p) => p.name),
         ),
         text,
      }
      this.presets = [...this.presets, entry]
      this.selectPreset(entry.id)
   }

   duplicatePreset(): void {
      const p = this.preset
      if (p != null) this.addPreset(`${p.name} copy`, p.text)
   }

   deletePreset(): void {
      const p = this.preset
      if (p == null) return
      const rest = this.presets.filter((x) => x.id !== p.id)
      this.presets = rest.length > 0 ? rest : defaultPresets()
      this.presetId = this.presets[0]?.id ?? ''
      // a deleted preset must not stay pinned to a module
      for (const [k, v] of Object.entries(this.presetByModule)) if (v === p.id) delete this.presetByModule[k]
      this.persist()
   }

   /** put the shipped library back WITHOUT dropping the ones written since */
   restoreDefaults(): void {
      const mine = this.presets.filter((p) => !defaultPresets().some((d) => d.id === p.id))
      this.presets = [...defaultPresets(), ...mine]
      this.presetId = this.presets[0]?.id ?? ''
      this.persist()
   }

   async loadModels(): Promise<void> {
      runInAction(() => {
         this.modelsState = 'loading'
         this.modelsError = ''
      })
      try {
         const models = await fetchModels({ key: this.apiKey })
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
            key: this.apiKey,
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
