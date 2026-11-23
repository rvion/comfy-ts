// what every explorer catalog shares: an entry's card facts, the weight files it needs, and its
// availability read from the LIVE host schema (a node or a weight file missing → the card shows
// the files and their urls instead of a run button).
import type { BaseNodeFactory, ComfyWorkflow } from 'comfy-ts'

/** a weight file the graph names, and where to get it when the host lacks it */
export type WeightFile = { node: string; input: string; file: string; folder: string; url: string }

/** the facts a card shows, and what the host must have to run the entry */
export type CatalogEntry = {
   id: string
   label: string
   family: string
   year: number
   /** when it came out, as precise as known: `2025-11` */
   date: string
   /** its weights on disk */
   size: string
   /** 1 (rough) to 5 (the best of its kind), judged on the explorer's samples */
   quality: number
   /** one run on an RTX class GPU, weights loaded */
   speed: string
   blurb: string
   nodes: string[]
   /** weights the host must list; a node pack that downloads its own on the first run lists none */
   files: WeightFile[]
   /** the node pack downloads its weights on the first run (slow once) */
   autoDownload?: boolean
}

/** a factory of the base (untyped) builder, or a loud error naming the node. For graphs that name
 * weight files the generated host sdk does not know until they are downloaded */
export function base<ID extends string>(wf: ComfyWorkflow<ID>, name: string): BaseNodeFactory {
   const f = wf.builderBase[name]
   if (f == null) throw new Error(`this host has no ${name} node`)
   return f
}

/** raw object_info, as the host schema keeps it */
export type ObjectInfo = Record<
   string,
   { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }
>

/** the options of a COMBO input in both object_info spellings: [[...]] and ['COMBO', { options }] */
function comboOptions(info: ObjectInfo, node: string, input: string): string[] {
   const def = info[node]?.input
   const slot = def?.required?.[input] ?? def?.optional?.[input]
   if (!Array.isArray(slot)) return []
   const head: unknown = slot[0]
   if (Array.isArray(head)) return head.filter((x): x is string => typeof x === 'string')
   const meta: unknown = slot[1]
   const opts: unknown = typeof meta === 'object' && meta != null && 'options' in meta ? meta.options : null
   return Array.isArray(opts) ? opts.filter((x): x is string => typeof x === 'string') : []
}

export type Availability = { ok: boolean; missingNodes: string[]; missingFiles: WeightFile[] }

export function availability(info: ObjectInfo, m: CatalogEntry): Availability {
   const missingNodes = m.nodes.filter((n) => info[n] == null)
   const missingFiles = m.files.filter((f) => !comboOptions(info, f.node, f.input).includes(f.file))
   return { ok: missingNodes.length === 0 && missingFiles.length === 0, missingNodes, missingFiles }
}

/** an entry as the page gets it: its card facts and its availability, never its graph */
export function entryPayload(info: ObjectInfo, m: CatalogEntry): Record<string, unknown> {
   return {
      id: m.id,
      label: m.label,
      family: m.family,
      year: m.year,
      blurb: m.blurb,
      date: m.date,
      size: m.size,
      quality: m.quality,
      speed: m.speed,
      autoDownload: m.autoDownload === true,
      ...availability(info, m),
   }
}
