// PURE var → descriptor: ONE introspection pass feeds GET /drafts (json) AND
// the startup print (renderDescriptorLine)
import {
   type AnyVar,
   ChoiceVar,
   FloatVar,
   ImageVar,
   IntVar,
   LorasVar,
   PromptVar,
   SeedVar,
   SizeVar,
   type SizePreset,
   type VarKind,
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
   if (varDef instanceof PromptVar) return { ...base, payload: 'string ("//" lines = comments, "- " lines = negative)' }
   if (varDef instanceof IntVar)
      return { ...base, payload: `integer${rangeText(varDef.opts)}`, min: varDef.opts.min, max: varDef.opts.max }
   if (varDef instanceof FloatVar)
      return { ...base, payload: `number${rangeText(varDef.opts)}`, min: varDef.opts.min, max: varDef.opts.max }
   if (varDef instanceof SeedVar)
      return {
         ...base,
         default: { mode: varDef.mode, value: varDef.defaultValue },
         payload: 'number (fixed) or {"mode":"=|+|-|?","value":number}',
      }
   if (varDef.kind === 'toggle') return { ...base, payload: 'true or false' }
   if (varDef instanceof ChoiceVar)
      return { ...base, payload: `one of: ${varDef.choices.join(' | ')}`, choices: varDef.choices }
   if (varDef instanceof LorasVar)
      return {
         ...base,
         payload: '{"<lora name>": false | true | strength | [model, clip]}',
         options: varDef.options,
      }
   if (varDef instanceof SizeVar)
      return { ...base, payload: '{"width":W,"height":H} or "WxH" or a preset label', presets: varDef.presets }
   if (varDef instanceof ImageVar)
      return { ...base, payload: 'local file path or http(s) url', extensions: varDef.extensions }
   return { ...base, payload: 'string' } // TextVar and future plain kinds
}

/** one aligned console line per var (startup print) */
export function renderDescriptorLine(name: string, d: VarDescriptor, nameWidth: number): string {
   const def = typeof d.default === 'string' ? JSON.stringify(truncate(d.default, 40)) : JSON.stringify(d.default)
   return `   ${name.padEnd(nameWidth)} ${d.kind.padEnd(6)} ${d.payload}  ·  default: ${truncate(def ?? 'null', 60)}`
}

function truncate(s: string, n: number): string {
   return s.length <= n ? s : s.slice(0, n - 1) + '…'
}
