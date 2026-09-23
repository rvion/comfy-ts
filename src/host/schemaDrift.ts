import { isRecord } from 'src/utils/isRecord.ts'

/**
 * what changed on a host since a schema was loaded: node types, and the model files each loader
 * lists. ComfyUI exposes no boot time, so staleness is decided by CONTENT: a restart that changed
 * nothing stays quiet, a new lora shows even when nobody knows when the box rebooted.
 * A light check asks only the loaders (`/object_info/<node>`, a few KB); a full one compares every
 * node type (`/object_info`, megabytes).
 */

/** the loader inputs whose combo IS a model folder listing */
export const MODEL_LISTS = [
   { noun: 'lora', node: 'LoraLoader', input: 'lora_name' },
   { noun: 'checkpoint', node: 'CheckpointLoaderSimple', input: 'ckpt_name' },
   { noun: 'unet', node: 'UNETLoader', input: 'unet_name' },
   { noun: 'text encoder', node: 'CLIPLoader', input: 'clip_name' },
   { noun: 'vae', node: 'VAELoader', input: 'vae_name' },
] as const

type Spec = Record<string, unknown>
type Delta = { added: string[]; removed: string[] }

export type SchemaDrift = {
   /** null on a light check: node types are only compared by a full one */
   nodes: Delta | null
   models: ({ noun: string } & Delta)[]
}

/** a combo's options in both object_info spellings: `[[...options]]` and `['COMBO', { options }]` */
export function comboOptions(spec: Spec, node: string, input: string): string[] | null {
   const def = spec[node]
   if (!isRecord(def) || !isRecord(def['input'])) return null
   const sections = def['input']
   for (const section of ['required', 'optional']) {
      const sec = sections[section]
      if (!isRecord(sec)) continue
      const slot = sec[input]
      if (!Array.isArray(slot)) continue
      const first: unknown = slot[0]
      if (Array.isArray(first)) return first.filter((x): x is string => typeof x === 'string')
      const opts: unknown = slot[1]
      if (first === 'COMBO' && isRecord(opts) && Array.isArray(opts['options']))
         return opts['options'].filter((x): x is string => typeof x === 'string')
   }
   return null
}

function delta(before: readonly string[], after: readonly string[]): Delta {
   const was = new Set(before)
   const now = new Set(after)
   return { added: after.filter((x) => !was.has(x)), removed: before.filter((x) => !now.has(x)) }
}

/** `live` may be PARTIAL (a light check holds only the loaders): a list is compared only where both
 * sides have the loader, and node types only when `full` */
export function diffSchemas(p: { loaded: Spec; live: Spec; full: boolean }): SchemaDrift {
   const models: SchemaDrift['models'] = []
   for (const m of MODEL_LISTS) {
      const before = comboOptions(p.loaded, m.node, m.input)
      const after = comboOptions(p.live, m.node, m.input)
      if (before == null || after == null) continue
      const d = delta(before, after)
      if (d.added.length > 0 || d.removed.length > 0) models.push({ noun: m.noun, ...d })
   }
   return { nodes: p.full ? delta(Object.keys(p.loaded), Object.keys(p.live)) : null, models }
}

export function driftChanged(d: SchemaDrift): boolean {
   return d.models.length > 0 || (d.nodes != null && (d.nodes.added.length > 0 || d.nodes.removed.length > 0))
}

/** `+5 loras, -1 unet, +4 node types`, '' when nothing changed */
export function summarizeDrift(d: SchemaDrift): string {
   const parts: string[] = []
   const say = (n: number, sign: string, noun: string): void => {
      if (n > 0) parts.push(`${sign}${n} ${noun}${n === 1 ? '' : 's'}`)
   }
   for (const m of d.models) {
      say(m.added.length, '+', m.noun)
      say(m.removed.length, '-', m.noun)
   }
   if (d.nodes != null) {
      say(d.nodes.added.length, '+', 'node type')
      say(d.nodes.removed.length, '-', 'node type')
   }
   return parts.join(', ')
}
