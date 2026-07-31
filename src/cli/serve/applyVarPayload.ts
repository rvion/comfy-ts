// PURE payload → var application: one POST body value onto one var, per kind.
// Returns an error message (nothing applied) or null. No fs here — ImageVar
// url download + existence checks are ServeApp's job.
import {
   type AnyVar,
   ChoiceVar,
   FloatVar,
   ImageVar,
   IntVar,
   type LoraStrength,
   LorasVar,
   PromptVar,
   SeedVar,
   SizeVar,
   TextVar,
   ToggleVar,
} from 'src/vars/ComfyVars.ts'

function isFiniteNumber(x: unknown): x is number {
   return typeof x === 'number' && Number.isFinite(x)
}

function isLoraStrength(x: unknown): x is LoraStrength {
   if (typeof x === 'boolean') return true
   if (isFiniteNumber(x)) return true
   return Array.isArray(x) && x.length === 2 && isFiniteNumber(x[0]) && isFiniteNumber(x[1])
}

/** cap long option lists in error messages */
function listSome(items: readonly string[], cap: number = 20): string {
   if (items.length <= cap) return items.join(', ')
   return `${items.slice(0, cap).join(', ')} … +${items.length - cap} more`
}

export function applyVarPayload(varDef: AnyVar, raw: unknown): string | null {
   const name = varDef.name ?? varDef.label ?? varDef.kind

   if (varDef instanceof TextVar || varDef instanceof PromptVar) {
      if (typeof raw !== 'string') return `var '${name}' expects a string`
      varDef.set(raw)
      return null
   }

   if (varDef instanceof IntVar || varDef instanceof FloatVar) {
      if (isFiniteNumber(raw)) {
         varDef.set(raw) // set() clamps to min/max
         return null
      }
      if (typeof raw === 'string' && varDef.parse(raw)) return null
      const o = varDef.opts
      const range = o.min == null && o.max == null ? '' : ` (${o.min ?? '-∞'}..${o.max ?? '∞'})`
      return `var '${name}' expects a number${range}`
   }

   if (varDef instanceof SeedVar) {
      if (isFiniteNumber(raw)) {
         // an explicit payload seed is FIXED for this request
         varDef.setMode('=')
         varDef.set(raw)
         return null
      }
      if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
         const o = raw as { mode?: unknown; value?: unknown }
         const mode = o.mode === '=' || o.mode === '+' || o.mode === '-' || o.mode === '?' ? o.mode : null
         if (o.mode !== undefined && mode == null) return `var '${name}': mode must be one of = + - ?`
         if (o.value !== undefined && !isFiniteNumber(o.value)) return `var '${name}': value must be a number`
         if (mode == null && o.value === undefined) return `var '${name}': give "mode" and/or "value"`
         if (mode != null) varDef.setMode(mode)
         if (isFiniteNumber(o.value)) varDef.set(o.value)
         return null
      }
      return `var '${name}' expects a number or {"mode":"=|+|-|?","value":number}`
   }

   if (varDef instanceof ToggleVar) {
      if (typeof raw !== 'boolean') return `var '${name}' expects true or false`
      varDef.set(raw)
      return null
   }

   if (varDef instanceof ChoiceVar) {
      if (typeof raw === 'string' && varDef.parse(raw)) return null
      return `var '${name}' expects one of: ${listSome(varDef.choices)}`
   }

   if (varDef instanceof LorasVar) {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
         return `var '${name}' expects {"<lora name>": false | true | strength | [model, clip]}`
      const record = raw as Record<string, unknown>
      const known = new Set<string>(varDef.options)
      const unknownNames = Object.keys(record).filter((k) => !known.has(k))
      if (unknownNames.length > 0)
         return `var '${name}': unknown lora(s) ${unknownNames.join(', ')} — available: ${listSome(varDef.options)}`
      for (const [k, s] of Object.entries(record))
         if (!isLoraStrength(s)) return `var '${name}': '${k}' must be false | true | number | [model, clip]`
      varDef.set(record as Partial<Record<string, LoraStrength>>) // every entry validated just above
      return null
   }

   if (varDef instanceof SizeVar) {
      if (typeof raw === 'string' && varDef.parse(raw)) return null
      if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
         const o = raw as { width?: unknown; height?: unknown }
         if (isFiniteNumber(o.width) && isFiniteNumber(o.height)) {
            varDef.set({ width: o.width, height: o.height })
            return null
         }
      }
      return `var '${name}' expects {"width":W,"height":H}, "WxH", or a preset label`
   }

   if (varDef instanceof ImageVar) {
      if (typeof raw !== 'string') return `var '${name}' expects a file path or http(s) url string`
      varDef.set(raw)
      return null
   }

   return `var '${name}' has unsupported kind '${varDef.kind}'`
}
