// PURE var → descriptor: ONE introspection pass feeds GET /drafts (json) AND
// the startup print (renderDescriptorLine)
import { ansi } from 'src/utils/ansi.ts'
import type {
   AnyVar,
   AnyChoiceVar,
   ChoiceSelect,
   FloatVar,
   ImageVar,
   IntVar,
   LorasVar,
   PromptVar,
   SeedVar,
   SizePreset,
   SizeVar,
   TextVar,
   VarKind,
   VarUi,
} from 'src/vars/ComfyVars.ts'
import type { VarPreset } from 'src/vars/presets.ts'
import type { LoraTriggers } from 'src/host/loraInfoCache.ts'

export type VarDescriptor = {
   kind: VarKind
   label?: string
   /** what a POST payload accepts for this var, human-readable */
   payload: string
   default: unknown
   /** choice vars: exactly one, one or none (value may be null), or many (value is a list) */
   select?: ChoiceSelect
   /** how the workflow wants this var to look (VarUi): icon, colors, description */
   ui?: VarUi
   choices?: readonly string[]
   /** loras: the resolved option list */
   options?: readonly string[]
   /** loras: human display names from the lora-manager mirror, keyed by option — entries only where the label differs (filled by ServeApp.describeModule, which knows the host) */
   optionLabels?: Record<string, string>
   /** prompt: the name of the loras var whose ACTIVE keywords prefix this prompt
    * (`v.prompt(…, { loraKeywordsFrom })`), filled by ServeApp.describeModule, which is the
    * only place that knows both vars by name. The panel previews the injection from it */
   keywordsFrom?: string
   /** loras: the regex the workflow narrowed the list with (`/krea-?2/i`), when it did */
   optionsFilter?: string
   /** loras: hand-assigned keyword (or trigger words) per option, entries only where one
    * exists, what a prompt with `loraKeywordsFrom` will prepend */
   optionKeywords?: Record<string, string>
   /** loras: names the lora-manager mirror knows and ComfyUI's enum does NOT (yet). Offered in
    * the picker with a warning, because a lora present on disk usually runs even when the
    * server has not rescanned its list, filled by ServeApp.describeModule */
   managerOnlyOptions?: readonly string[]
   /** loras: when each file landed on the host (epoch seconds, the lora manager's date), entries
    * only where the mirror has one. The popup's `date added` sort reads it */
   optionAddedAt?: Record<string, number>
   /** loras: trigger words per option as the mirror knows them (words, fetched and empty, or
    * civitai never asked). An option ABSENT from this record is not in the mirror at all */
   optionTriggers?: Record<string, LoraTriggers>
   /** prompt: tag completion is on (`v.prompt(…, { tags })`), with the insert rules. The list
    * itself stays on the server: the editor asks `GET /tags/<module>/<var>?q=` */
   tags?: { underscores: boolean; artistPrefix?: string }
   /** prompt: false when the model ignores `(text:1.2)` weights */
   weights?: false
   /** text: this one wants a box, not a line (`v.text(…, { multiline: true })`) */
   multiline?: boolean
   /** text + prompt: named starting texts (`{ presets: { label: text } }`). NOT `presets`, which
    * a size var already owns with a different shape — one flat descriptor type, two kinds */
   textPresets?: VarPreset[]
   min?: number
   max?: number
   presets?: SizePreset[]
   /** size: preset labels starred by default (quick buttons before the list) */
   starredPresets?: string[]
   extensions?: readonly string[]
}

/** an empty list is absent from the json: every var without presets would otherwise carry `[]` */
function presetsOrUndefined(presets: VarPreset[]): VarPreset[] | undefined {
   return presets.length === 0 ? undefined : presets
}

function rangeText(opts: { min?: number; max?: number }): string {
   if (opts.min == null && opts.max == null) return ''
   return ` (${opts.min ?? '-∞'}..${opts.max ?? '∞'})`
}

export function describeVar(varDef: AnyVar): VarDescriptor {
   const base = {
      kind: varDef.kind,
      label: varDef.label,
      default: varDef.defaultValue,
      // absent unless the workflow set something: most vars carry no looks
      ...(Object.keys(varDef.uiOpts).length > 0 ? { ui: varDef.uiOpts } : {}),
   }
   // kind, never instanceof: the cli bundle and the consumer's `comfy-ts` import hold
   // different copies of every class (VarKind owns the WHY). Casts are the sanctioned
   // kind-narrowing family (agent/coding.md cast whitelist 6)
   switch (varDef.kind) {
      case 'prompt': {
         const v = varDef as PromptVar
         return {
            ...base,
            payload: 'string ("//" starts a comment, "- " lines = negative)',
            textPresets: presetsOrUndefined(v.presets),
            tags:
               v.tags == null
                  ? undefined
                  : { underscores: v.tags.underscores === true, artistPrefix: v.tags.artistPrefix },
            weights: v.promptOpts.weights === false ? false : undefined,
         }
      }
      case 'text': {
         const v = varDef as TextVar
         return { ...base, payload: 'string', multiline: v.opts.multiline, textPresets: presetsOrUndefined(v.presets) }
      }
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
         const v = varDef as AnyChoiceVar<string>
         const list = v.choices.join(' | ')
         const payload =
            v.select === 'many'
               ? `a list of: ${list}`
               : v.select === 'zero-or-one'
                 ? `null or one of: ${list}`
                 : `one of: ${list}`
         return { ...base, payload, choices: v.choices, select: v.select }
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
         return {
            ...base,
            payload: '{"width":W,"height":H} or "WxH" or a preset label',
            presets: v.presets,
            starredPresets: [...v.starred],
         }
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
