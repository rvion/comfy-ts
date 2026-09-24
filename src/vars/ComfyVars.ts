// Vars: the standard "tweak & re-run" contract. A workflow defined via
// host.defineWorkflow({ vars, build }) rebuilds its graph from current var
// values on every run — drivers (scripts, the TUI) edit vars between runs.
import { imageMeta } from 'image-meta'
import { action, makeObservable, observable } from 'mobx'
import { basename, isAbsolute, join, resolve } from 'pathe'
import { getComfyStorage } from 'src/storage/ComfyStorage.ts'
import { getLoraKeyword } from 'src/vars/loraKeywords.ts'
import {
   flattenLoras,
   isLorasInput,
   isPromptLanes,
   promptLanesFromText,
   promptLanesToText,
   promptText,
   updateLora,
   type LoraRecord,
   type LorasInput,
   type PromptInput,
} from 'src/vars/lanes.ts'
import { keptKeyword, loraIsOn, loraMuted, loraStrengths, withLora, type LoraStrength } from 'src/vars/loraEntry.ts'
import { logError } from 'src/utils/log.ts'
import { toPresetList, type VarPreset, type VarPresetSpec } from 'src/vars/presets.ts'

/**
 * the var's CLASS, and the only safe way to discriminate one: `instanceof` compares class
 * OBJECTS, and the published package hands the same class out twice — a consumer's
 * `.cflow.ts` imports `comfy-ts` (dist/index.js) while `comfy-ts serve`/`tui` run from the
 * cli bundle, so every `instanceof XVar` across that boundary is false (observed
 * in a consumer app: "var 'prompt' has unsupported kind 'text'", for EVERY kind). A string tag
 * crosses bundles; a class identity does not.
 */
export type VarKind = 'text' | 'prompt' | 'int' | 'float' | 'seed' | 'toggle' | 'choice' | 'loras' | 'size' | 'image'

/**
 * full base: T is what's STORED/edited, Out what the GRAPH consumes at build
 * time. They usually coincide — extend `ComfyVar<T>` for that. PromptVar is
 * the one Out-specialized var (string in, PromptValue out); the split keeps
 * outValue() cast-free.
 */
/** how a var LOOKS in the panel, set by the workflow: `v.int(8).ui({ icon, color, description })`.
 * Every slot is optional, a color is any css color */
export type VarUi = {
   /** shown as a (?) after the label, the text is its tooltip */
   description?: string
   /** a 24×24 svg path drawn in the icon color, or a whole `<svg …>` string */
   icon?: string
   /** the icon's color */
   color?: string
   labelColor?: string
   /** the whole row, drawn without moving anything in it */
   background?: string
   /** vars that go together: consecutive vars with the same group share one tinted block */
   group?: string
   /** the block's tint, read from the first var of the group that sets it */
   groupColor?: string
   border?: string
   /** choice vars: a look per option, keyed by the option value. The lit option is filled
    * with its own color */
   options?: Record<string, { icon?: string; color?: string }>
   /** the field is shown but disabled unless every named var holds one of the listed values:
    * `{ model: ['aesthetic', 'base'] }`. Checked against the var names when the workflow loads.
    * Display only: a disabled var's value still reaches the build */
   activeWhen?: Record<string, readonly (string | number | boolean)[]>
}

export abstract class ComfyVarBase<T, Out> {
   abstract readonly kind: VarKind
   /** the vars-spec key, stamped by DefinedWorkflow at define time — error messages name the var with it */
   name?: string
   /** panel looks, see VarUi. Never part of the value, never in a draft */
   uiOpts: VarUi = {}
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
   /** chainable: `v.choice([...], 'a').ui({ icon: 'M4 12h16', color: '#e0af68' })` */
   ui(p: VarUi): this {
      this.uiOpts = { ...this.uiOpts, ...p }
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

export type TextVarOpts = {
   label?: string
   /** render as a box you can write paragraphs in, not a one-line field. Some text IS long by
    * nature (an llm instruction, a system prompt) and a single line hides all but its start */
   multiline?: boolean
   /** named starting texts, `{ label: text }`. The TUI and the web panel offer them behind one
    * button and picking one REPLACES the value, so a preset is a shortcut, never a mode */
   presets?: VarPresetSpec
}

export class TextVar extends ComfyVar<string> {
   readonly kind = 'text' as const
   /** normalized `opts.presets`, in authored order */
   readonly presets: VarPreset[]
   readonly opts: TextVarOpts
   /** a bare label string was the whole second parameter before opts existed: a published
    * consumer passing one must keep working, exactly as SeedVar does */
   constructor(defaultValue: string, opts: string | TextVarOpts = {}) {
      const o = typeof opts === 'string' ? { label: opts } : opts
      super(defaultValue, o.label)
      this.opts = o
      this.presets = toPresetList(o.presets)
   }
   parse(raw: string): boolean {
      this.set(raw)
      return true
   }
}

const commentLineRe = /^\s*\/\//
const negativeLineRe = /^\s*- (.*)$/

/** what PromptVar needs from a loras var: covariant face, so LorasVar<'a'|'b'> fits.
 * `hostId` scopes the keyword lookup: the same file name on two hosts is often a
 * different model, and injecting the other host's trigger words is a silently
 * wrong generation. */
export type ActiveLoraSource = {
   activeNames(): string[]
   hostId?: string
   /** the parts of a lora's keyword left out of the prompt (LorasVar: the `mute` list) */
   mutedWords?(name: string): string[]
}

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
export class PromptVar extends ComfyVarBase<PromptInput, PromptValue> {
   readonly kind = 'prompt' as const
   /** normalized `promptOpts.presets`, in authored order (TextVarOpts.presets owns the WHY) */
   readonly presets: VarPreset[]
   constructor(
      defaultValue: PromptInput,
      public promptOpts: {
         label?: string
         loraKeywordsFrom?: ActiveLoraSource
         presets?: VarPresetSpec
      } = {},
   ) {
      super(defaultValue, promptOpts.label)
      this.presets = toPresetList(promptOpts.presets)
   }
   /** in lanes mode the text carries `# name` headers, so a lane survives a round trip */
   parse(raw: string): boolean {
      this.set(isPromptLanes(this.value) ? promptLanesFromText(raw) : raw)
      return true
   }
   override toEditBuffer(): string {
      return isPromptLanes(this.value) ? promptLanesToText(this.value) : this.value
   }
   /** a var list shows the lanes by name, the inactive ones in parentheses */
   override display(): string {
      if (!isPromptLanes(this.value)) return super.display()
      return `${this.value.lanes.length} lanes: ${this.value.lanes.map((l) => (l.active ? l.name : `(${l.name})`)).join(', ')}`
   }
   /** the text the build reads: the plain string, or the active lanes joined in order */
   get text(): string {
      return promptText(this.value)
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
               .map((name) => keptKeyword(getLoraKeyword(name, src.hostId), src.mutedWords?.(name) ?? []))
               .filter((k) => k !== ''),
         ),
      ]
   }
   outValue(): PromptValue {
      const pos: string[] = []
      const neg: string[] = []
      for (const line of this.text.split('\n')) {
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
   mode: SeedMode
   /** the mode a reset() restores — the SPEC default, never the live one (introspection
    * reads this: a running mode must not masquerade as the var's default) */
   readonly defaultMode: SeedMode
   /** `opts` is the modern shape; a bare label string stays accepted, since that was the
    * signature before a workflow could declare the mode it wants to run in */
   constructor(defaultValue: number = 0, opts: string | { label?: string; mode?: SeedMode } = {}) {
      const o = typeof opts === 'string' ? { label: opts } : opts
      super(defaultValue, o.label)
      this.mode = o.mode ?? '='
      this.defaultMode = this.mode
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
   /** mode is part of the seed's state: a reset must not keep a caller's `?`/`+` alive
    * ('=' is the construction default; drafts restore their own mode via loadJSON) */
   override reset(): this {
      this.setMode(this.defaultMode)
      return super.reset()
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

/** how many options a choice holds: exactly one (the default), one or none, or any number */
export type ChoiceSelect = 'one' | 'zero-or-one' | 'many'

export class ChoiceVar<T extends string> extends ComfyVar<T> {
   readonly kind = 'choice' as const
   readonly select = 'one' as const
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

/** one option or none: `null` is "nothing picked", clicking the lit option clears it */
export class OptionalChoiceVar<T extends string> extends ComfyVar<T | null> {
   readonly kind = 'choice' as const
   readonly select = 'zero-or-one' as const
   constructor(
      public readonly choices: readonly T[],
      defaultValue: T | null,
      label?: string,
   ) {
      super(defaultValue, label)
   }
   /** pick `c`, or clear it when it is already the one picked */
   toggle(c: T): this {
      return this.set(this.value === c ? null : c)
   }
   /** the TUI text form: a choice, or an empty line for none */
   parse(raw: string): boolean {
      if (raw.trim() === '') {
         this.set(null)
         return true
      }
      const hit = this.choices.find((c) => c === raw.trim())
      if (hit == null) return false
      this.set(hit)
      return true
   }
   override toEditBuffer(): string {
      return this.value ?? ''
   }
   /** a draft from when this was a many choice holds a list: its first known option */
   override loadJSON(value: unknown): this {
      const one = Array.isArray(value) ? value[0] : value
      return this.set(this.choices.find((c) => c === one) ?? null)
   }
   override display(): string {
      return this.value ?? 'none'
   }
}

/** any number of options, kept in the order the choices list them */
export class MultiChoiceVar<T extends string> extends ComfyVar<T[]> {
   readonly kind = 'choice' as const
   readonly select = 'many' as const
   constructor(
      public readonly choices: readonly T[],
      defaultValue: readonly T[],
      label?: string,
   ) {
      super([...defaultValue], label)
   }
   toggle(c: T): this {
      const on = this.value.includes(c)
      return this.set(this.choices.filter((x) => (x === c ? !on : this.value.includes(x))))
   }
   /** the TUI text form: `a, b` */
   parse(raw: string): boolean {
      const wanted = raw
         .split(',')
         .map((w) => w.trim())
         .filter((w) => w !== '')
      const picked = this.choices.filter((c) => wanted.includes(c))
      if (picked.length !== new Set(wanted).size) return false
      this.set(picked)
      return true
   }
   override toEditBuffer(): string {
      return this.value.join(', ')
   }
   /** a draft from when this was a single choice holds one value: a list of one. Unknown
    * options are dropped, the list comes back in the choices order */
   override loadJSON(value: unknown): this {
      const listed: unknown[] = Array.isArray(value) ? value : value == null ? [] : [value]
      return this.set(this.choices.filter((c) => listed.includes(c)))
   }
   override display(): string {
      return this.value.length === 0 ? 'none' : this.value.join(', ')
   }
}

/** the three choice shapes, told apart by `select` */
export type AnyChoiceVar<T extends string = string> = ChoiceVar<T> | OptionalChoiceVar<T> | MultiChoiceVar<T>

type ChoiceOpts<S extends ChoiceSelect> = { label?: string; select: S }

/** Array.isArray does not narrow a READONLY array out of a union, this does */
function isChoiceList<T extends string>(v: T | null | readonly T[]): v is readonly T[] {
   return Array.isArray(v)
}

function choice<const T extends string>(
   choices: readonly T[],
   defaultValue: T,
   label?: string | { label?: string; select?: 'one' },
): ChoiceVar<T>
function choice<const T extends string>(
   choices: readonly T[],
   defaultValue: T | null,
   opts: ChoiceOpts<'zero-or-one'>,
): OptionalChoiceVar<T>
function choice<const T extends string>(
   choices: readonly T[],
   defaultValue: readonly T[],
   opts: ChoiceOpts<'many'>,
): MultiChoiceVar<T>
function choice<const T extends string>(
   choices: readonly T[],
   defaultValue: T | null | readonly T[],
   opts?: string | { label?: string; select?: ChoiceSelect },
): AnyChoiceVar<T> {
   const o = typeof opts === 'string' ? { label: opts } : (opts ?? {})
   const select = o.select ?? 'one'
   if (select === 'many') {
      if (!isChoiceList(defaultValue))
         throw new Error(`a 'many' choice takes a list as its default, got ${String(defaultValue)}`)
      return new MultiChoiceVar(choices, defaultValue, o.label)
   }
   if (isChoiceList(defaultValue)) throw new Error(`a '${select}' choice takes one value as its default, not a list`)
   if (select === 'zero-or-one') return new OptionalChoiceVar(choices, defaultValue, o.label)
   if (defaultValue == null) throw new Error("a 'one' choice needs a default: use { select: 'zero-or-one' } for none")
   return new ChoiceVar(choices, defaultValue, o.label)
}

/** per-lora setting, every spelling documented in src/vars/loraEntry.ts */
export type { LoraStrength } from 'src/vars/loraEntry.ts'

export type ActiveLora<T extends string> = { lora_name: T; strength_model: number; strength_clip: number }

/** normalize a loras record into what a standard LoraLoader chain consumes */
export function activeLoras<T extends string>(loras: LorasInput<T>): ActiveLora<T>[] {
   const out: ActiveLora<T>[] = []
   for (const [lora_name, s] of Object.entries(flattenLoras(loras).record) as [T, LoraStrength | undefined][]) {
      // a paused lora ({ off: true }) is in the palette, never in the graph
      if (!loraIsOn(s)) continue
      const [strength_model, strength_clip] = loraStrengths(s)
      out.push({ lora_name, strength_model, strength_clip })
   }
   return out
}

/** what LorasVar.bindHost needs — structural, so ComfyVars never imports ComfyHost */
export type LorasHost = { data?: { id?: string }; schema: { getLoras(filter?: RegExp): string[] } }

/**
 * multi-select lora stack over a DYNAMIC options list — a RegExp resolves
 * against the host's loras at define time (DefinedWorkflow calls bindHost),
 * or feed it host discovery (`host.schema.getLoras(regex?)`) directly; never
 * a hardcoded inventory. Selection is empty by default.
 */
/**
 * the value is EITHER a plain record OR `{ lanes: [...] }` (src/vars/lanes.ts): named groups the
 * build merges in listed order, skipping inactive ones. Every method reads the merged record and
 * writes into the lane that holds the lora, so the TUI never needs to know lanes exist
 */
export class LorasVar<T extends string> extends ComfyVarBase<LorasInput<T>, LoraRecord<T>> {
   readonly kind = 'loras' as const
   /** last non-false strength per lora, so untick → re-tick restores it */
   private prev: Partial<Record<T, LoraStrength>> = {}
   /** a RegExp source resolves lazily (bindHost) — null until then */
   private resolvedOptions: readonly T[] | null = null
   /** which host these loras live on, so their metadata is read from ITS mirror */
   hostId: string | undefined = undefined

   constructor(
      private readonly optionsSource: readonly T[] | RegExp,
      initial: LorasInput<T> = {},
      label?: string,
   ) {
      super(initial, label)
   }

   /** the filter the workflow declared, when it declared one (`v.loras(/krea-?2/i)`). Public so
    * a UI can SHOW it, and so serve applies the same narrowing to loras only its lora-manager
    * mirror knows, an unfiltered union would put the whole catalog back in a filtered picker */
   get optionsFilter(): RegExp | null {
      return this.optionsSource instanceof RegExp ? this.optionsSource : null
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
      this.hostId = host.data?.id
      if (!(this.optionsSource instanceof RegExp)) return
      this.resolvedOptions = host.schema.getLoras(this.optionsSource) as T[]
   }

   get names(): T[] {
      return [...this.options]
   }

   /** the loras the build reads: the plain record, or the active lanes merged in order */
   get record(): LoraRecord<T> {
      return flattenLoras(this.value).record
   }

   /** what the graph consumes. A lora in two active lanes runs once, with its FIRST setting */
   outValue(): LoraRecord<T> {
      const flat = flattenLoras(this.value)
      if (flat.duplicates.length > 0)
         logError(
            `loras var '${this.name ?? this.label ?? '?'}': ${flat.duplicates.join(', ')} sit in two active lanes, the first lane's setting is used`,
         )
      return flat.record
   }

   /** rewrite one lora wherever it lives: the plain record, or the lane that holds it */
   private write(name: T, next: LoraStrength | null): this {
      return this.set(updateLora(this.value, name, next))
   }

   /** the parts of this lora's prompt keyword left out of the prompt */
   mutedWords(name: string): string[] {
      return loraMuted(this.record[name as T])
   }

   /** loras currently ON (PromptVar keyword prefixing consumes this) */
   activeNames(): T[] {
      return this.names.filter((n) => this.isOn(n))
   }

   isOn(name: T): boolean {
      return loraIsOn(this.record[name])
   }

   toggleItem(name: T): this {
      const cur = this.record[name]
      if (cur == null || cur === false) return this.write(name, this.prev[name] ?? true)
      // a paused palette entry resumes in place, strengths kept
      if (!loraIsOn(cur)) return this.write(name, withLora(cur, { on: true }))
      this.prev[name] = cur
      return this.write(name, false)
   }

   /** step both strengths by delta (true becomes 1 first); no-op when off */
   adjustItem(name: T, delta: number): this {
      const cur = this.record[name]
      if (!loraIsOn(cur)) return this
      const step = (n: number): number => Math.max(0, Math.round((n + delta) * 100) / 100)
      // the short spellings stay short: only a palette entry needs the object form
      const next: LoraStrength =
         typeof cur === 'number' || cur === true
            ? step(cur === true ? 1 : cur)
            : Array.isArray(cur)
              ? [step(cur[0]), step(cur[1])]
              : withLora(cur, { strength: [step(loraStrengths(cur)[0]), step(loraStrengths(cur)[1])] })
      return this.write(name, next)
   }

   /** compact per-item strength label for lists */
   strengthLabel(name: T): string {
      const s = this.record[name]
      if (!loraIsOn(s)) return ''
      const [m, c] = loraStrengths(s)
      return m === c ? m.toFixed(2) : `m:${m.toFixed(2)} c:${c.toFixed(2)}`
   }

   parse(raw: string): boolean {
      try {
         const parsed: unknown = JSON.parse(raw)
         if (!isLorasInput(parsed)) return false
         // cast: whitelist family 1, the names are this host's lora enum, checked by the build
         this.set(parsed as LorasInput<T>)
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
      const record = this.record
      let next = this.value
      for (const name of names) {
         const cur = record[name]
         if (on) {
            if (cur == null || cur === false) next = updateLora(next, name, this.prev[name] ?? true)
            // a paused palette entry resumes in place, strengths kept
            else if (!loraIsOn(cur)) next = updateLora(next, name, withLora(cur, { on: true }))
         } else {
            if (loraIsOn(cur)) this.prev[name] = cur
            next = updateLora(next, name, false)
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

/** the same aspect ratios around 512, for SD1.5-era models trained at ~0.25MP */
export const SD15_SIZE_PRESETS: SizePreset[] = [
   { label: '1:1 square', width: 512, height: 512 },
   { label: '4:3 landscape', width: 576, height: 448 },
   { label: '3:4 portrait', width: 448, height: 576 },
   { label: '3:2 landscape', width: 576, height: 384 },
   { label: '2:3 portrait', width: 384, height: 576 },
   { label: '16:9 widescreen', width: 704, height: 384 },
   { label: '9:16 tall', width: 384, height: 704 },
]

/** starred presets are one click away in the panel, before the full list */
export const DEFAULT_STARRED_SIZES = ['1:1 square', '3:4 portrait', '4:3 landscape']

/** the family that matches a workflow's own default: a 512×512 workflow is an SD1.5-era one,
 * and offering it 1024 buckets would be offering sizes it was never trained at */
export function sizePresetsFor(defaultValue: SizeValue | undefined): SizePreset[] {
   if (defaultValue == null) return DEFAULT_SIZE_PRESETS
   return defaultValue.width * defaultValue.height <= 600 * 600 ? SD15_SIZE_PRESETS : DEFAULT_SIZE_PRESETS
}

/** width/height picker: presets + free `WxH` entry + optionally the LIVE
 * size of a linked image var (the widget shows
 * `WxH  size of image '<name>'` as a pickable row) */
export class SizeVar extends ComfyVar<SizeValue> {
   readonly kind = 'size' as const
   constructor(
      defaultValue: SizeValue = { width: 1024, height: 1024 },
      public readonly presets: SizePreset[] = DEFAULT_SIZE_PRESETS,
      label?: string,
      public readonly imageVar?: ImageVar,
      /** preset LABELS starred by default; a user's own stars live in the panel */
      public readonly starred: readonly string[] = DEFAULT_STARRED_SIZES,
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
         const meta = imageMeta(getComfyStorage().readBytes(abs))
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
   /** picker listing filter, lowercase without dots; never affects the value. NOT a security
    * boundary: `comfy-ts serve` keeps its own floor of image types it will read off the disk
    * and upload, which this list may NARROW but never widen (emptying it changes the picker,
    * not what the api accepts) */
   extensions?: readonly string[]
   label?: string
}

export const DEFAULT_IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif']

/** empty image var consumed at build time — typed so drivers surface it apart from real crashes */
export class ImageVarEmptyError extends Error {
   /** name, not instanceof: the cli bundle and dist/index.js each define this class */
   override readonly name = 'ImageVarEmptyError'
   constructor(public readonly varName: string) {
      super(`image var '${varName}' is empty — pick a file (TUI: activate the var; script: .set('/path/to/image.png'))`)
   }
}

/** trim + expand a leading `~/` — every ImageVar write funnels through this */
function expandUserPath(raw: string): string {
   const trimmed = raw.trim()
   return trimmed.startsWith('~/') ? join(getComfyStorage().homedir(), trimmed.slice(2)) : trimmed
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
      return resolve(this.opts.folder ?? getComfyStorage().cwd(), this.value)
   }
   /** empty = unset: the build fails LOUD here (varValues calls outValue) */
   override outValue(): string {
      if (!this.isSet()) throw this.emptyError()
      return this.value
   }
   override display(): string {
      if (!this.isSet()) return '(unset) pick a file'
      const home = getComfyStorage().homedir()
      return this.value.startsWith(`${home}/`) ? `~${this.value.slice(home.length)}` : this.value
   }
}

/** the var constructors: v.text / v.prompt / v.int / v.float / v.seed / v.toggle / v.choice / v.loras / v.size / v.image */
export const v = {
   // the old `v.text(x, 'label')` form still works: a bare string IS the label
   text: (defaultValue: string, opts: TextVarOpts | string = {}): TextVar =>
      new TextVar(defaultValue, typeof opts === 'string' ? { label: opts } : opts),
   prompt: (
      /** a string, or `{ lanes: [{ name, prompt, active }] }` merged in listed order */
      defaultValue: PromptInput,
      opts: { label?: string; loraKeywordsFrom?: ActiveLoraSource; presets?: VarPresetSpec } = {},
   ): PromptVar => new PromptVar(defaultValue, opts),
   int: (defaultValue: number, opts: { min?: number; max?: number; label?: string } = {}): IntVar =>
      new IntVar(defaultValue, opts),
   float: (defaultValue: number, opts: { min?: number; max?: number; label?: string } = {}): FloatVar =>
      new FloatVar(defaultValue, opts),
   /** `mode` is the SPEC default the workflow runs in: `'+'` makes every run step the seed,
    * which is what a tuning session wants, and reset()/revert come back to it */
   seed: (defaultValue: number = 0, opts: string | { label?: string; mode?: SeedMode } = {}): SeedVar =>
      new SeedVar(defaultValue, opts),
   toggle: (defaultValue: boolean, label?: string): ToggleVar => new ToggleVar(defaultValue, label),
   /** exactly one option (the default), `{ select: 'zero-or-one' }` for one or none (value
    * `T | null`), `{ select: 'many' }` for any number (value `T[]`) */
   choice,
   loras: <T extends string = string>(
      options: readonly T[] | RegExp,
      /** a record, or `{ lanes: [{ name, active, loras }] }` merged in listed order */
      initial: LorasInput<T> = {},
      label?: string,
   ): LorasVar<T> => new LorasVar(options, initial, label),
   size: (
      defaultValue?: SizeValue,
      opts: { presets?: SizePreset[]; starred?: readonly string[]; label?: string; image?: ImageVar } = {},
   ): SizeVar =>
      new SizeVar(defaultValue, opts.presets ?? sizePresetsFor(defaultValue), opts.label, opts.image, opts.starred),
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
   readonly defaultValue: unknown
   readonly label?: string
   /** the vars-spec key — DefinedWorkflow writes it at define time */
   name?: string
   readonly uiOpts: VarUi
   parse(raw: string): boolean
   loadJSON(value: unknown): unknown
   reset(): unknown
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
