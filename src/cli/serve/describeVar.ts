// PURE var → descriptor: ONE introspection pass feeds GET /drafts (json) AND
// the startup print (renderDescriptorLine)
import { ansi } from 'src/utils/ansi.ts'
import type {
   AnyVar,
   ChoiceVar,
   FloatVar,
   ImageVar,
   IntVar,
   LorasVar,
   SeedVar,
   SizePreset,
   SizeVar,
   VarKind,
} from 'src/vars/ComfyVars.ts'

export type VarDescriptor = {
   kind: VarKind
   label?: string
   /** what a POST payload accepts for this var, human-readable */
   payload: string
   default: unknown
   choices?: readonly string[]
   /** loras: the resolved option list */
   options?: readonly string[]
   /** loras: human display names from the lora-manager mirror, keyed by option — entries only where the label differs (filled by ServeApp.describeModule, which knows the host) */
   optionLabels?: Record<string, string>
   /** prompt: the name of the loras var whose ACTIVE keywords prefix this prompt
    * (`v.prompt(…, { loraKeywordsFrom })`) — filled by ServeApp.describeModule, which is the
    * only place that knows both vars by name. The panel previews the injection from it */
   keywordsFrom?: string
   /** loras: the regex the workflow narrowed the list with (`/krea-?2/i`), when it did */
   optionsFilter?: string
   /** loras: hand-assigned keyword (or trigger words) per option, entries only where one
    * exists — what a prompt with `loraKeywordsFrom` will prepend */
   optionKeywords?: Record<string, string>
   /** loras: names the lora-manager mirror knows and ComfyUI's enum does NOT (yet). Offered in
    * the picker with a warning, because a lora present on disk usually runs even when the
    * server has not rescanned its list — filled by ServeApp.describeModule */
   managerOnlyOptions?: readonly string[]
   min?: number
   max?: number
   presets?: SizePreset[]
   extensions?: readonly string[]
}

function rangeText(opts: { min?: number; max?: number }): string {
   if (opts.min == null && opts.max == null) return ''
   return ` (${opts.min ?? '-∞'}..${opts.max ?? '∞'})`
}

export function describeVar(varDef: AnyVar): VarDescriptor {
   const base = { kind: varDef.kind, label: varDef.label, default: varDef.defaultValue }
   // kind, never instanceof: the cli bundle and the consumer's `comfy-ts` import hold
   // different copies of every class (VarKind owns the WHY). Casts are the sanctioned
   // kind-narrowing family (agent/coding.md cast whitelist 6)
   switch (varDef.kind) {
      case 'prompt':
         return { ...base, payload: 'string ("//" lines = comments, "- " lines = negative)' }
      case 'text':
         return { ...base, payload: 'string' }
      case 'int': {
         const v = varDef as IntVar
         return { ...base, payload: `integer${rangeText(v.opts)}`, min: v.opts.min, max: v.opts.max }
      }
      case 'float': {
         const v = varDef as FloatVar
         return { ...base, payload: `number${rangeText(v.opts)}`, min: v.opts.min, max: v.opts.max }
      }
      case 'seed': {
         const v = varDef as SeedVar
         return {
            ...base,
            // defaultMode, never the LIVE mode: serve's vars are shared mutable state, so a
            // run under '?' would otherwise leak its mode into every fileless draft's defaults
            // (and the web ui autosaves those defaults straight back into the draft file)
            default: { mode: v.defaultMode, value: v.defaultValue },
            payload: 'number (fixed) or {"mode":"=|+|-|?","value":number}',
         }
      }
      case 'toggle':
         return { ...base, payload: 'true or false' }
      case 'choice': {
         const v = varDef as ChoiceVar<string>
         return { ...base, payload: `one of: ${v.choices.join(' | ')}`, choices: v.choices }
      }
      case 'loras': {
         const v = varDef as LorasVar<string>
         return {
            ...base,
            payload: '{"<lora name>": false | true | strength | [model, clip]}',
            options: v.options,
            // the workflow's own narrowing, shown in the picker so the list is explainable
            optionsFilter: v.optionsFilter == null ? undefined : String(v.optionsFilter),
         }
      }
      case 'size': {
         const v = varDef as SizeVar
         return { ...base, payload: '{"width":W,"height":H} or "WxH" or a preset label', presets: v.presets }
      }
      case 'image': {
         const v = varDef as ImageVar
         return { ...base, payload: 'local file path or http(s) url', extensions: v.extensions }
      }
      default: {
         // an unknown kind CAN reach here: a globally installed cli against a project on a
         // newer comfy-ts (wire tolerance, agent/coding.md whitelist 4). The `never` binding
         // is the compile-time exhaustiveness check; the RUNTIME path must degrade, because
         // printStartup calls d.kind.padEnd() before the server ever listens
         const unknownKind: never = varDef.kind
         return { ...base, payload: `string (unrecognised kind '${String(unknownKind)}')` }
      }
   }
}

/** one aligned console line per var (startup print). Padding happens on the PLAIN text: colors are wrapped around the
 * already-padded cells, so a colored and an uncolored print line up identically */
export function renderDescriptorLine(name: string, d: VarDescriptor, nameWidth: number, color = false): string {
   const def = typeof d.default === 'string' ? JSON.stringify(truncate(d.default, 40)) : JSON.stringify(d.default)
   const cells = { name: name.padEnd(nameWidth), kind: d.kind.padEnd(6), value: truncate(def ?? 'null', 60) }
   if (!color) return `   ${cells.name} ${cells.kind} ${d.payload}  ·  default: ${cells.value}`
   return `   ${ansi.bold(cells.name)} ${ansi.yellow(cells.kind)} ${ansi.gray(d.payload)}  ${ansi.gray('·  default:')} ${cells.value}`
}

function truncate(s: string, n: number): string {
   return s.length <= n ? s : s.slice(0, n - 1) + '…'
}
