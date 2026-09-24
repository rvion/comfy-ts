// PURE payload → var application: one POST body value onto one var, per kind.
// Returns an error message (nothing applied) or null. No fs here — ImageVar
// url download + existence checks are ServeApp's job.
//
// Discrimination is by `kind`, NEVER instanceof: a consumer's `.cflow.ts` imports
// `comfy-ts` (dist/index.js) while `comfy-ts serve` runs from the cli bundle, and the
// two hold different copies of every class, so instanceof was false for EVERY var and
// every payload override answered "unsupported kind". The casts
// below are the sanctioned kind-narrowing family (agent/coding.md cast whitelist 6).
import type {
   AnyVar,
   AnyChoiceVar,
   FloatVar,
   ImageVar,
   IntVar,
   LorasVar,
   PromptVar,
   SeedVar,
   SizeVar,
   TextVar,
   ToggleVar,
} from 'src/vars/ComfyVars.ts'
import { isLoraLanes, isLorasInput, isPromptInput } from 'src/vars/lanes.ts'
import { isLoraStrength } from 'src/vars/loraEntry.ts'

function isFiniteNumber(x: unknown): x is number {
   return typeof x === 'number' && Number.isFinite(x)
}

/** cap long option lists in error messages */
function listSome(items: readonly string[], cap: number = 20): string {
   if (items.length <= cap) return items.join(', ')
   return `${items.slice(0, cap).join(', ')} … +${items.length - cap} more`
}

/** `extraLoraOptions`: names the lora-manager mirror knows that ComfyUI's enum does not.
 * they are accepted like any option, the file is on disk, so the run usually works, but
 * ONLY those: an arbitrary name still fails, so a typo cannot reach the host */
export function applyVarPayload(
   varDef: AnyVar,
   raw: unknown,
   opts: { extraLoraOptions?: readonly string[] } = {},
): string | null {
   const name = varDef.name ?? varDef.label ?? varDef.kind

   switch (varDef.kind) {
      case 'text': {
         if (typeof raw !== 'string') return `var '${name}' expects a string`
         ;(varDef as TextVar).set(raw)
         return null
      }

      case 'prompt': {
         if (!isPromptInput(raw))
            return `var '${name}' expects a string or {"lanes": [{"name": string, "prompt": string, "active": boolean}]}`
         ;(varDef as PromptVar).set(raw)
         return null
      }

      case 'int':
      case 'float': {
         const v = varDef as IntVar | FloatVar
         if (isFiniteNumber(raw)) {
            v.set(raw) // set() clamps to min/max
            return null
         }
         if (typeof raw === 'string' && v.parse(raw)) return null
         const o = v.opts
         const range = o.min == null && o.max == null ? '' : ` (${o.min ?? '-∞'}..${o.max ?? '∞'})`
         return `var '${name}' expects a number${range}`
      }

      case 'seed': {
         const v = varDef as SeedVar
         if (isFiniteNumber(raw)) {
            // an explicit payload seed is FIXED for this request
            v.setMode('=')
            v.set(raw)
            return null
         }
         if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
            const o = raw as { mode?: unknown; value?: unknown }
            const mode = o.mode === '=' || o.mode === '+' || o.mode === '-' || o.mode === '?' ? o.mode : null
            if (o.mode !== undefined && mode == null) return `var '${name}': mode must be one of = + - ?`
            if (o.value !== undefined && !isFiniteNumber(o.value)) return `var '${name}': value must be a number`
            if (mode == null && o.value === undefined) return `var '${name}': give "mode" and/or "value"`
            if (mode != null) v.setMode(mode)
            if (isFiniteNumber(o.value)) v.set(o.value)
            return null
         }
         return `var '${name}' expects a number or {"mode":"=|+|-|?","value":number}`
      }

      case 'toggle': {
         if (typeof raw !== 'boolean') return `var '${name}' expects true or false`
         ;(varDef as ToggleVar).set(raw)
         return null
      }

      case 'choice': {
         const v = varDef as AnyChoiceVar<string>
         const known = (x: unknown): x is string => typeof x === 'string' && v.choices.includes(x)
         if (v.select === 'many') {
            if (Array.isArray(raw) && raw.every(known)) {
               v.set(v.choices.filter((c) => raw.includes(c)))
               return null
            }
            return `var '${name}' expects a list of: ${listSome(v.choices)}`
         }
         if (v.select === 'zero-or-one') {
            if (raw === null || known(raw)) {
               v.set(raw)
               return null
            }
            return `var '${name}' expects null or one of: ${listSome(v.choices)}`
         }
         if (known(raw)) {
            v.set(raw)
            return null
         }
         return `var '${name}' expects one of: ${listSome(v.choices)}`
      }

      case 'loras': {
         const v = varDef as LorasVar<string>
         const SHAPE = `{"<lora name>": false | true | strength | [model, clip] | {strength, off?, mute?}} or {"lanes": [{"name", "active", "loras": {…}}]}`
         if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return `var '${name}' expects ${SHAPE}`
         const records = isLoraLanes(raw) ? raw.lanes.map((l) => l.loras) : [raw as Record<string, unknown>]
         const known = new Set<string>([...v.options, ...(opts.extraLoraOptions ?? [])])
         for (const record of records) {
            const unknownNames = Object.keys(record).filter((k) => !known.has(k))
            if (unknownNames.length > 0)
               return `var '${name}': unknown lora(s) ${unknownNames.join(', ')} — available: ${listSome([...known])}`
            for (const [k, st] of Object.entries(record))
               if (!isLoraStrength(st))
                  return `var '${name}': '${k}' must be false | true | number | [model, clip] | { strength: [model, clip], off?, mute? }`
         }
         if (!isLorasInput(raw)) return `var '${name}' expects ${SHAPE}`
         v.set(raw) // every lane and entry validated just above
         return null
      }

      case 'size': {
         const v = varDef as SizeVar
         if (typeof raw === 'string' && v.parse(raw)) return null
         if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
            const o = raw as { width?: unknown; height?: unknown }
            if (isFiniteNumber(o.width) && isFiniteNumber(o.height)) {
               v.set({ width: o.width, height: o.height })
               return null
            }
         }
         return `var '${name}' expects {"width":W,"height":H}, "WxH", or a preset label`
      }

      case 'image': {
         if (typeof raw !== 'string') return `var '${name}' expects a file path or http(s) url string`
         ;(varDef as ImageVar).set(raw)
         return null
      }

      default: {
         // same as describeVar: `never` is the compile-time check, the runtime path keeps
         // the message a caller can act on instead of answering a bare token
         const unknownKind: never = varDef.kind
         return `var '${name}' has unsupported kind '${String(unknownKind)}'`
      }
   }
}
