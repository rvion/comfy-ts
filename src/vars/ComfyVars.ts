// Vars: the standard "tweak & re-run" contract. A workflow defined via
// host.defineWorkflow({ vars, build }) rebuilds its graph from current var
// values on every run — drivers (scripts, the TUI) edit vars between runs.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { imageMeta } from 'image-meta'
import { action, makeObservable, observable } from 'mobx'
import { basename, isAbsolute, join, resolve } from 'pathe'
import { getLoraKeyword } from 'src/vars/loraKeywords.ts'

export type VarKind = 'text' | 'int' | 'float' | 'seed' | 'toggle' | 'choice' | 'loras' | 'size' | 'image'

/**
 * full base: T is what's STORED/edited, Out what the GRAPH consumes at build
 * time. They usually coincide — extend `ComfyVar<T>` for that. PromptVar is
 * the one Out-specialized var (string in, PromptValue out); the split keeps
 * outValue() cast-free.
 */
export abstract class ComfyVarBase<T, Out> {
   abstract readonly kind: VarKind
   /** the vars-spec key, stamped by DefinedWorkflow at define time — error messages name the var with it */
   name?: string
   value: T
   constructor(
      public readonly defaultValue: T,
      public label?: string,
   ) {
      this.value = defaultValue
      // observable value: the TUI (mobx) re-renders when drivers mutate vars.
      // explicit makeObservable (not makeAutoObservable): base-class + subclass
      // combo. All mutators funnel through set()/reset()/parse() so they are
      // actions — subclass helpers call this.set(...) rather than assigning.
      makeObservable(this, { value: observable, set: action, reset: action, parse: action, loadJSON: action })
   }
   set(value: T): this {
      this.value = value
      return this
   }
   /** what drafts persist for this var (subclasses may add fields, e.g. seed mode) */
   toJSON(): unknown {
      return this.value
   }
   /** what the GRAPH consumes at build time (varValues maps these return types) */
   abstract outValue(): Out
   /**
    * restore a value produced by toJSON() (drafts). The cast is sanctioned:
    * drafts are our own round-trip, subclasses re-validate via set().
    */
   loadJSON(value: unknown): this {
      return this.set(value as T)
   }
   reset(): this {
      this.value = this.defaultValue
      return this
   }
   /** parse a raw string (TUI text input) into this var's value; returns false when invalid */
   abstract parse(raw: string): boolean
   /** how the value renders in a var list */
   display(): string {
      return String(this.value)
   }
   /** the string the inline editor starts from (round-trips through parse) */
   toEditBuffer(): string {
      return String(this.value)
   }
   /** hook run after every DefinedWorkflow.run() (default no-op; SeedVar advances) */
   afterRun(): void {}
}

/** the standard var: the graph consumes the stored value AS-IS (Out = T) */
export abstract class ComfyVar<T> extends ComfyVarBase<T, T> {
   outValue(): T {
      return this.value
   }
}

export class TextVar extends ComfyVar<string> {
   readonly kind = 'text' as const
   parse(raw: string): boolean {
      this.set(raw)
      return true
   }
}

const commentLineRe = /^\s*\/\//
const negativeLineRe = /^\s*- (.*)$/

/** what PromptVar needs from a loras var: covariant face, so LorasVar<'a'|'b'> fits */
export type ActiveLoraSource = { activeNames(): string[] }

/** what a prompt CONTRIBUTES to build: `vars.prompt.positive` / `.negative` */
export type PromptValue = { positive: string; negative: string }

/**
 * prompt text with editor comforts, all resolved at BUILD time (the editor and
 * drafts keep the raw text):
 *   - `//` lines are COMMENTS — stripped
 *   - `- ` lines are NEGATIVE prompt lines — removed from `.positive`,
 *     comma-joined into `.negative`
 *   - with `loraKeywordsFrom`, the ACTIVE loras' hand-assigned keywords
 *     (src/vars/loraKeywords.ts, ⌃K in the TUI) prefix `.positive` —
 *     `injectedKeywords()` is public so the TUI can PREVIEW the injection.
 */
export class PromptVar extends ComfyVarBase<string, PromptValue> {
   readonly kind = 'text' as const
   constructor(
      defaultValue: string,
      public promptOpts: { label?: string; loraKeywordsFrom?: ActiveLoraSource } = {},
   ) {
      super(defaultValue, promptOpts.label)
   }
   parse(raw: string): boolean {
      this.set(raw)
      return true
   }
   static isCommentLine(line: string): boolean {
      return commentLineRe.test(line)
   }
   static isNegativeLine(line: string): boolean {
      return negativeLineRe.test(line)
   }
   /** the keyword prefix the flag will inject (deduped, lora-list order) — the TUI previews this */
   injectedKeywords(): string[] {
      const src = this.promptOpts.loraKeywordsFrom
      if (src == null) return []
      return [
         ...new Set(
            src
               .activeNames()
               .map(getLoraKeyword)
               .filter((k) => k !== ''),
         ),
      ]
   }
   outValue(): PromptValue {
      const pos: string[] = []
      const neg: string[] = []
      for (const line of this.value.split('\n')) {
         if (commentLineRe.test(line)) continue
         const m = negativeLineRe.exec(line)
         if (m != null) {
            const text = (m[1] ?? '').trim()
            if (text !== '') neg.push(text)
         } else pos.push(line)
      }
      const body = pos.join('\n').trim()
      const keywords = this.injectedKeywords()
      const positive =
         keywords.length === 0 ? body : body === '' ? keywords.join(', ') : `${keywords.join(', ')}, ${body}`
      return { positive, negative: neg.join(', ') }
   }
}

export class IntVar extends ComfyVar<number> {
   readonly kind = 'int' as const
   constructor(
      defaultValue: number,
      public opts: { min?: number; max?: number; label?: string } = {},
   ) {
      super(defaultValue, opts.label)
   }
   override set(value: number): this {
      const clamped = Math.round(Math.min(this.opts.max ?? Infinity, Math.max(this.opts.min ?? -Infinity, value)))
      return super.set(clamped)
   }
   parse(raw: string): boolean {
      const n = Number(raw)
      if (Number.isNaN(n)) return false
      this.set(n)
      return true
   }
}

export class FloatVar extends ComfyVar<number> {
   readonly kind = 'float' as const
   constructor(
      defaultValue: number,
      public opts: { min?: number; max?: number; label?: string } = {},
   ) {
      super(defaultValue, opts.label)
   }
   override set(value: number): this {
      return super.set(Math.min(this.opts.max ?? Infinity, Math.max(this.opts.min ?? -Infinity, value)))
   }
   parse(raw: string): boolean {
      const n = Number(raw)
      if (Number.isNaN(n)) return false
      this.set(n)
      return true
   }
}

/** '=' fixed · '+' increment each run · '-' decrement each run · '?' reroll each run */
export type SeedMode = '=' | '+' | '-' | '?'

/**
 * a seed is a MODE + a number. `value` stays a plain number (what the graph
 * consumes); `mode` decides how it advances after each run (afterRun()):
 *   `= 12` fixed · `+ 0` auto-increment · `- 0` auto-decrement · `? 0` random.
 * The number shown is always the seed the NEXT run will use.
 */
export class SeedVar extends ComfyVar<number> {
   readonly kind = 'seed' as const
   mode: SeedMode = '='
   constructor(defaultValue: number = 0, label?: string) {
      super(defaultValue, label)
      // subclass-owned observable field (base makeObservable already ran in super)
      makeObservable(this, { mode: observable, setMode: action, randomize: action, advance: action })
   }
   setMode(mode: SeedMode): this {
      this.mode = mode
      return this
   }
   randomize(): this {
      return this.set(Math.floor(Math.random() * 2 ** 32))
   }
   override set(value: number): this {
      // seeds are unsigned: clamp at 0 so decrement can't go negative
      return super.set(Math.max(0, Math.floor(value)))
   }
   /** move the seed to what the NEXT run should use, per mode */
   advance(): this {
      if (this.mode === '+') return this.set(this.value + 1)
      if (this.mode === '-') return this.set(this.value - 1)
      if (this.mode === '?') return this.randomize()
      return this // '=' stays fixed
   }
   override afterRun(): void {
      this.advance()
   }
   /** parse `+` `- 12` `= 5` `?` or a bare number (=> fixed). Keeps the current number when none given */
   parse(raw: string): boolean {
      const m = raw.trim().match(/^([+\-=?])?\s*(\d+)?$/)
      if (m == null) return false
      const modeChar = m[1]
      const numStr = m[2]
      if (modeChar == null && numStr == null) return false
      this.setMode(modeChar == null ? '=' : (modeChar as SeedMode))
      if (numStr != null) this.set(Number(numStr))
      return true
   }
   override display(): string {
      return `${this.mode} ${this.value}`
   }
   override toEditBuffer(): string {
      return `${this.mode} ${this.value}`
   }
   override toJSON(): unknown {
      return { mode: this.mode, value: this.value }
   }
   override loadJSON(value: unknown): this {
      if (typeof value === 'number') return this.set(value) // legacy plain-number drafts
      if (value != null && typeof value === 'object') {
         const o = value as { mode?: unknown; value?: unknown }
         if (o.mode === '=' || o.mode === '+' || o.mode === '-' || o.mode === '?') this.setMode(o.mode)
         if (typeof o.value === 'number') this.set(o.value)
      }
      return this
   }
}

export class ToggleVar extends ComfyVar<boolean> {
   readonly kind = 'toggle' as const
   toggle(): this {
      return this.set(!this.value)
   }
   parse(raw: string): boolean {
      if (raw !== 'true' && raw !== 'false') return false
      this.set(raw === 'true')
      return true
   }
   override display(): string {
      return this.value ? 'ON' : 'OFF'
   }
}

export class ChoiceVar<T extends string> extends ComfyVar<T> {
   readonly kind = 'choice' as const
   constructor(
      public readonly choices: readonly T[],
      defaultValue: T,
      label?: string,
   ) {
      super(defaultValue, label)
   }
   next(delta: number = 1): this {
      const ix = this.choices.indexOf(this.value)
      const nextIx = (ix + delta + this.choices.length) % this.choices.length
      return this.set(this.choices[nextIx] ?? this.value)
   }
   parse(raw: string): boolean {
      const hit = this.choices.find((c) => c === raw)
      if (hit == null) return false
      this.set(hit)
      return true
   }
}

/**
 * per-lora setting: false = off, true = 1/1, number = both strengths,
 * [strength_model, strength_clip] = each explicitly
 */
export type LoraStrength = boolean | number | [strengthModel: number, strengthClip: number]

export type ActiveLora<T extends string> = { lora_name: T; strength_model: number; strength_clip: number }

/** normalize a loras record into what a standard LoraLoader chain consumes */
export function activeLoras<T extends string>(loras: Partial<Record<T, LoraStrength>>): ActiveLora<T>[] {
   const out: ActiveLora<T>[] = []
   for (const [lora_name, s] of Object.entries(loras) as [T, LoraStrength | undefined][]) {
      if (s == null || s === false) continue
      const [strength_model, strength_clip] = Array.isArray(s) ? s : s === true ? [1, 1] : [s, s]
      out.push({ lora_name, strength_model, strength_clip })
   }
   return out
}

/** what LorasVar.bindHost needs — structural, so ComfyVars never imports ComfyHost */
export type LorasHost = { schema: { getLoras(filter?: RegExp): string[] } }

/**
 * multi-select lora stack over a DYNAMIC options list — a RegExp resolves
 * against the host's loras at define time (DefinedWorkflow calls bindHost),
 * or feed it host discovery (`host.schema.getLoras(regex?)`) directly; never
 * a hardcoded inventory. Selection is empty by default.
 */
export class LorasVar<T extends string> extends ComfyVar<Partial<Record<T, LoraStrength>>> {
   readonly kind = 'loras' as const
   /** last non-false strength per lora, so untick → re-tick restores it */
   private prev: Partial<Record<T, LoraStrength>> = {}
   /** a RegExp source resolves lazily (bindHost) — null until then */
   private resolvedOptions: readonly T[] | null = null

   constructor(
      private readonly optionsSource: readonly T[] | RegExp,
      initial: Partial<Record<T, LoraStrength>> = {},
      label?: string,
   ) {
      super(initial, label)
   }

   get options(): readonly T[] {
      if (!(this.optionsSource instanceof RegExp)) return this.optionsSource
      if (this.resolvedOptions == null)
         throw new Error(
            `v.loras(${String(this.optionsSource)}) is host-bound — it only works inside defineWorkflow({ vars }) (pass a name list otherwise)`,
         )
      return this.resolvedOptions
   }

   /** DefinedWorkflow binds the host at define time: a RegExp source resolves here.
    * cast: whitelist family 1 (agent/coding.md) — getLoras() returns the runtime
    * values of the SAME object_info enum the generated E_LoraName union comes from */
   bindHost(host: LorasHost): void {
      if (!(this.optionsSource instanceof RegExp)) return
      this.resolvedOptions = host.schema.getLoras(this.optionsSource) as T[]
   }

   get names(): T[] {
      return [...this.options]
   }

   /** loras currently ON (PromptVar keyword prefixing consumes this) */
   activeNames(): T[] {
      return this.names.filter((n) => this.isOn(n))
   }

   isOn(name: T): boolean {
      const s = this.value[name]
      return s != null && s !== false
   }

   toggleItem(name: T): this {
      const cur = this.value[name]
      if (cur == null || cur === false) return this.set({ ...this.value, [name]: this.prev[name] ?? true })
      this.prev[name] = cur
      return this.set({ ...this.value, [name]: false })
   }

   /** step both strengths by delta (true becomes 1 first); no-op when off */
   adjustItem(name: T, delta: number): this {
      const cur = this.value[name]
      if (cur == null || cur === false) return this
      const step = (n: number): number => Math.max(0, Math.round((n + delta) * 100) / 100)
      const next: LoraStrength = Array.isArray(cur) ? [step(cur[0]), step(cur[1])] : step(cur === true ? 1 : cur)
      return this.set({ ...this.value, [name]: next })
   }

   /** compact per-item strength label for lists */
   strengthLabel(name: T): string {
      const s = this.value[name]
      if (s == null || s === false) return ''
      if (s === true) return '1.00'
      if (Array.isArray(s)) return `m:${s[0].toFixed(2)} c:${s[1].toFixed(2)}`
      return s.toFixed(2)
   }

   parse(raw: string): boolean {
      try {
         const parsed: unknown = JSON.parse(raw)
         if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return false
         this.set(parsed as Partial<Record<T, LoraStrength>>)
         return true
      } catch {
         return false
      }
   }

   /** short human name: subfolder + extension stripped */
   static shortName(name: string): string {
      return (name.split(/[\\/]/).pop() ?? name).replace(/\.safetensors$/, '')
   }

   /** tick (true) or untick (false) every lora in `names` (default: all options) */
   setAll(on: boolean, names: readonly T[] = this.options): this {
      const next = { ...this.value }
      for (const name of names) {
         const cur = next[name]
         if (on) {
            if (cur == null || cur === false) next[name] = this.prev[name] ?? true
         } else {
            if (cur != null && cur !== false) this.prev[name] = cur
            next[name] = false
         }
      }
      return this.set(next)
   }

   override display(): string {
      const on = this.activeNames()
      if (on.length === 0) return `(0/${this.options.length}) none`
      return `(${on.length}/${this.options.length}) ${on.map((n) => LorasVar.shortName(n)).join(', ')}`
   }
}

export type SizeValue = { width: number; height: number }
export type SizePreset = { label: string; width: number; height: number }

/** SDXL-style ~1MP buckets, multiples of 64 — safe for most latent models */
export const DEFAULT_SIZE_PRESETS: SizePreset[] = [
   { label: '1:1 square', width: 1024, height: 1024 },
   { label: '4:3 landscape', width: 1152, height: 896 },
   { label: '3:4 portrait', width: 896, height: 1152 },
   { label: '3:2 landscape', width: 1216, height: 832 },
   { label: '2:3 portrait', width: 832, height: 1216 },
   { label: '16:9 widescreen', width: 1344, height: 768 },
   { label: '9:16 tall', width: 768, height: 1344 },
]

/** width/height picker: presets + free `WxH` entry + optionally the LIVE
 * size of a linked image var (his ask 2026-07-30: the widget shows
 * `WxH  size of image '<name>'` as a pickable row) */
export class SizeVar extends ComfyVar<SizeValue> {
   readonly kind = 'size' as const
   constructor(
      defaultValue: SizeValue = { width: 1024, height: 1024 },
      public readonly presets: SizePreset[] = DEFAULT_SIZE_PRESETS,
      label?: string,
      public readonly imageVar?: ImageVar,
   ) {
      super(defaultValue, label)
   }

   /** current dimensions of the linked image var — null when no link, unset
    * path, or an unreadable/undecodable file (those errors belong to the
    * image var itself, the size row simply disappears) */
   imageSize(): { width: number; height: number; name: string } | null {
      const iv = this.imageVar
      if (iv == null || iv.value === '') return null
      try {
         const abs = iv.absPath()
         const meta = imageMeta(new Uint8Array(readFileSync(abs)))
         if (meta.width == null || meta.height == null) return null
         return { width: meta.width, height: meta.height, name: basename(abs) }
      } catch {
         return null
      }
   }

   /** accepts '1024x768' / '1024×768' / a preset label */
   parse(raw: string): boolean {
      const m = raw.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/)
      if (m != null) {
         this.set({ width: Number(m[1]), height: Number(m[2]) })
         return true
      }
      const preset = this.presets.find((p) => p.label === raw.trim())
      if (preset != null) {
         this.set({ width: preset.width, height: preset.height })
         return true
      }
      return false
   }

   override display(): string {
      const { width, height } = this.value
      const hit = this.presets.find((p) => p.width === width && p.height === height)
      return `${width}×${height}${hit ? ` (${hit.label})` : ''}`
   }
}

export type ImageVarOpts = {
   /** where the TUI picker starts browsing AND what relative values resolve against (absPath) */
   folder?: string
   /** picker listing filter, lowercase without dots; never affects the value */
   extensions?: readonly string[]
   label?: string
}

export const DEFAULT_IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif']

/** empty image var consumed at build time — typed so drivers surface it apart from real crashes */
export class ImageVarEmptyError extends Error {
   constructor(public readonly varName: string) {
      super(`image var '${varName}' is empty — pick a file (TUI: activate the var; script: .set('/path/to/image.png'))`)
   }
}

/** trim + expand a leading `~/` — every ImageVar write funnels through this */
function expandUserPath(raw: string): string {
   const trimmed = raw.trim()
   return trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed
}

/**
 * a local image path. The VALUE is a PLAIN PATH STRING — text-encodable,
 * drafts persist it verbatim (toJSON = the string), hand-editable in the
 * draft json. Empty = unset: outValue()/absPath() throw ImageVarEmptyError,
 * so a build never runs on a silent placeholder. The TUI opens the image
 * picker overlay for kind 'image'.
 */
export class ImageVar extends ComfyVar<string> {
   readonly kind = 'image' as const
   constructor(
      defaultValue: string,
      public opts: ImageVarOpts = {},
   ) {
      super(expandUserPath(defaultValue), opts.label)
   }
   /** what the picker lists (lowercase, no dots) */
   get extensions(): readonly string[] {
      return this.opts.extensions ?? DEFAULT_IMAGE_EXTENSIONS
   }
   override set(value: string): this {
      return super.set(expandUserPath(value))
   }
   parse(raw: string): boolean {
      this.set(raw)
      return true
   }
   isSet(): boolean {
      return this.value !== ''
   }
   private emptyError(): ImageVarEmptyError {
      return new ImageVarEmptyError(this.name ?? this.label ?? 'image')
   }
   /** the ONE resolution helper: absolute kept as-is, relative resolved against opts.folder, else cwd */
   absPath(): string {
      if (!this.isSet()) throw this.emptyError()
      if (isAbsolute(this.value)) return this.value
      return resolve(this.opts.folder ?? process.cwd(), this.value)
   }
   /** empty = unset: the build fails LOUD here (varValues calls outValue) */
   override outValue(): string {
      if (!this.isSet()) throw this.emptyError()
      return this.value
   }
   override display(): string {
      if (!this.isSet()) return '(unset) pick a file'
      const home = homedir()
      return this.value.startsWith(`${home}/`) ? `~${this.value.slice(home.length)}` : this.value
   }
}

/** the var constructors: v.text / v.prompt / v.int / v.float / v.seed / v.toggle / v.choice / v.loras / v.size / v.image */
export const v = {
   text: (defaultValue: string, label?: string): TextVar => new TextVar(defaultValue, label),
   prompt: (defaultValue: string, opts: { label?: string; loraKeywordsFrom?: ActiveLoraSource } = {}): PromptVar =>
      new PromptVar(defaultValue, opts),
   int: (defaultValue: number, opts: { min?: number; max?: number; label?: string } = {}): IntVar =>
      new IntVar(defaultValue, opts),
   float: (defaultValue: number, opts: { min?: number; max?: number; label?: string } = {}): FloatVar =>
      new FloatVar(defaultValue, opts),
   seed: (defaultValue: number = 0, label?: string): SeedVar => new SeedVar(defaultValue, label),
   toggle: (defaultValue: boolean, label?: string): ToggleVar => new ToggleVar(defaultValue, label),
   choice: <const T extends string>(choices: readonly T[], defaultValue: T, label?: string): ChoiceVar<T> =>
      new ChoiceVar(choices, defaultValue, label),
   loras: <T extends string = string>(
      options: readonly T[] | RegExp,
      initial: Partial<Record<T, LoraStrength>> = {},
      label?: string,
   ): LorasVar<T> => new LorasVar(options, initial, label),
   size: (defaultValue?: SizeValue, opts: { presets?: SizePreset[]; label?: string; image?: ImageVar } = {}): SizeVar =>
      new SizeVar(defaultValue, opts.presets, opts.label, opts.image),
   image: (defaultValue: string, opts: ImageVarOpts = {}): ImageVar => new ImageVar(defaultValue, opts),
}

/**
 * structural face of any var: readonly `value` keeps ComfyVar<T> assignable
 * despite T-invariance on the mutable field. VarValues re-derives the exact
 * value types via infer.
 */
export type AnyVar = {
   readonly kind: VarKind
   readonly value: unknown
   readonly label?: string
   /** the vars-spec key — DefinedWorkflow writes it at define time */
   name?: string
   parse(raw: string): boolean
   loadJSON(value: unknown): unknown
   toJSON(): unknown
   outValue(): unknown
   display(): string
   toEditBuffer(): string
   afterRun(): void
   /** host-dependent vars (LorasVar regex) resolve here — DefinedWorkflow calls it at define time */
   bindHost?(host: LorasHost): void
}

export type VarsSpec = { [key: string]: AnyVar }

export type VarValues<V extends VarsSpec> = {
   // outValue() return type, not the stored type: PromptVar stores string, contributes PromptValue
   [K in keyof V]: V[K] extends { outValue(): infer O } ? O : never
}

export function varValues<V extends VarsSpec>(vars: V): VarValues<V> {
   const out: Record<string, unknown> = {}
   // outValue, not value: PromptVar strips comments / prefixes lora keywords here
   for (const [k, varDef] of Object.entries(vars)) out[k] = varDef.outValue()
   return out as VarValues<V>
}
