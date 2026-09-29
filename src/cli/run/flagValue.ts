// one `--<var> <value>` flag, a string on the command line, as the value serve's payload takes
// for that var kind (applyVarPayload validates it after, so this only shapes, never judges)
import { isAbsolute, resolve } from 'pathe'
import type { ChoiceSelect, VarKind } from 'src/vars/ComfyVars.ts'

export type FlagSpec = { kind: VarKind; select?: ChoiceSelect }

const TRUE = new Set(['true', 'yes', '1', 'on'])
const FALSE = new Set(['false', 'no', '0', 'off'])

/** `raw` is `true` for a bare flag (`--upscale`) */
export function flagValue(p: {
   name: string
   spec: FlagSpec
   raw: string | true
   cwd: string
}): { value: unknown } | { error: string } {
   const raw = p.raw
   if (p.spec.kind === 'toggle') {
      if (raw === true) return { value: true }
      const v = raw.toLowerCase()
      if (TRUE.has(v)) return { value: true }
      if (FALSE.has(v)) return { value: false }
      return { error: `--${p.name} is a toggle: true or false` }
   }
   if (raw === true) return { error: `--${p.name} needs a value` }
   switch (p.spec.kind) {
      case 'int':
      case 'float':
         return { value: raw }
      case 'seed': {
         if (raw === '?' || raw === '+' || raw === '-' || raw === '=') return { value: { mode: raw } }
         const n = Number(raw)
         return Number.isFinite(n) ? { value: n } : { error: `--${p.name} is a seed: a number, or ? for a random one` }
      }
      case 'choice':
         if (p.spec.select === 'many')
            return {
               value: raw
                  .split(',')
                  .map((x) => x.trim())
                  .filter((x) => x !== ''),
            }
         if (p.spec.select === 'zero-or-one' && raw === 'none') return { value: null }
         return { value: raw }
      case 'loras':
         try {
            return { value: JSON.parse(raw) }
         } catch {
            return { error: `--${p.name} takes the loras as json, like '{"name.safetensors": 0.8}'` }
         }
      case 'image':
      case 'audio':
      case 'video':
         // a url goes through as is: serve downloads it
         return { value: /^https?:\/\//.test(raw) || isAbsolute(raw) ? raw : resolve(p.cwd, raw) }
      default:
         return { value: raw }
   }
}
