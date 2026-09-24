// PURE value normalization for the web form. DOM-free on purpose:
// headless-tested by tests/serve-web-payload.test.ts. The form does NOT build
// override payloads any more: drafts are live (autosave through PUT, generate
// posts {}) — architecture item 12, web ui
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { isLoraLanes, type LoraRecord, type LorasInput } from 'src/vars/lanes.ts'
import { isLoraStrength, loraInPalette, loraIsOn as entryIsOn, loraStrengths, withLora } from 'src/vars/loraEntry.ts'

export type SeedFormValue = { mode: string; value: number }
export type SizeFormValue = { width: number; height: number }

/** what a QUEUED run carries: the values you saw when you clicked, so editing the form
 * afterwards cannot change a prompt already in the queue. SEEDS are deliberately left out —
 * they stay the draft's server-side policy, so a queue of 4 under `?`/`+` advances per run
 * instead of repeating one frozen number (an explicit payload seed is fixed by definition) */
export function payloadSnapshot(entries: { name: string; kind: string; value: unknown }[]): Record<string, unknown> {
   const out: Record<string, unknown> = {}
   for (const e of entries) if (e.kind !== 'seed') out[e.name] = e.value
   return out
}

/** draft seed values come as {mode,value} (toJSON) or a legacy plain number */
export function asSeedForm(raw: unknown): SeedFormValue {
   if (typeof raw === 'number' && Number.isFinite(raw)) return { mode: '=', value: raw }
   if (raw != null && typeof raw === 'object') {
      const o = raw as { mode?: unknown; value?: unknown }
      return {
         mode: typeof o.mode === 'string' ? o.mode : '=',
         value: typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : 0,
      }
   }
   return { mode: '=', value: 0 }
}

export function asSizeForm(raw: unknown): SizeFormValue {
   if (raw != null && typeof raw === 'object') {
      const o = raw as { width?: unknown; height?: unknown }
      if (typeof o.width === 'number' && typeof o.height === 'number') return { width: o.width, height: o.height }
   }
   return { width: 1024, height: 1024 }
}

/** the record the web keeps holds PALETTE loras only: on, or paused in the palette form. Two
 * things are dropped: keys the host no longer offers (dead weight the ui cannot display, and a
 * server-side build failure), and `false` entries, which LorasVar writes for every lora ever
 * unticked in the TUI, so treating them as palette members put the WHOLE catalog in the row.
 * A pause is `{ strength, off: true }` (src/vars/loraEntry.ts), never `false`, so it survives */
export function pruneLorasRecord(raw: unknown, options: readonly string[]): LoraRecord {
   if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
   const known = new Set(options)
   const out: LoraRecord = {}
   for (const [k, st] of Object.entries(raw as Record<string, unknown>))
      if (known.has(k) && isLoraStrength(st) && loraInPalette(st)) out[k] = st
   return out
}

/** either shape, pruned the same way: a plain record, or every lane's record */
export function normalizeLorasInput(raw: unknown, options: readonly string[]): LorasInput {
   if (isLoraLanes(raw)) return { lanes: raw.lanes.map((l) => ({ ...l, loras: pruneLorasRecord(l.loras, options) })) }
   return pruneLorasRecord(raw, options)
}

/** what a fresh VarSt starts from: the draft value when present, else the descriptor default — seed/size/loras normalized so controls never branch on shape */
export function normalizeInitial(desc: VarDescriptor, raw: unknown): unknown {
   if (desc.kind === 'seed') return asSeedForm(raw ?? desc.default)
   if (desc.kind === 'size') return asSizeForm(raw ?? desc.default)
   if (desc.kind === 'loras') return normalizeLorasInput(raw ?? desc.default, desc.options ?? [])
   return raw ?? desc.default
}

export function randomSeed(): number {
   return Math.floor(Math.random() * 2 ** 32)
}

// ---- loras record transitions: the stored spellings live in src/vars/loraEntry.ts, shared
// with LorasVar and serve, so the web and the library can never read a lora differently

export type LoraStrengthPair = { model: number; clip: number }

export function loraIsOn(st: unknown): boolean {
   return entryIsOn(st)
}

/** any stored strength shape → the {model, clip} pair the inputs edit */
export function loraStrengthPair(st: unknown): LoraStrengthPair {
   const [model, clip] = loraStrengths(st)
   return { model, clip }
}

/** pause/resume in place: the key, its position and its strengths all stay */
export function setLoraEnabled(record: Record<string, unknown>, name: string, on: boolean): Record<string, unknown> {
   return { ...record, [name]: withLora(record[name], { on }) }
}

/** the palette, IN ORDER: the record's own key order, so a lora you add lands at the end and
 * nothing already on screen moves. Pure, because the order is what a drag rewrites */
export function paletteOrder(p: { record: Record<string, unknown>; options: readonly string[] }): string[] {
   const known = new Set(p.options)
   return Object.keys(p.record).filter((n) => known.has(n) && loraInPalette(p.record[n]))
}

/** move a lora to a new slot in the palette and give back the record rewritten in that order,
 * the record's key order IS the stored order */
export function reorderLoras(p: {
   record: Record<string, unknown>
   /** palette order, as displayed */
   displayed: readonly string[]
   from: number
   to: number
}): Record<string, unknown> {
   const next = [...p.displayed]
   const [moved] = next.splice(p.from, 1)
   if (moved == null) return p.record
   next.splice(p.to, 0, moved)
   const out: Record<string, unknown> = {}
   for (const name of next) if (name in p.record) out[name] = p.record[name]
   // anything the palette does not show (a key pruned from view) keeps its entry
   for (const [k, v] of Object.entries(p.record)) if (!(k in out)) out[k] = v
   return out
}

/** set both strengths; a paused lora stays paused */
export function setLoraStrength(
   record: Record<string, unknown>,
   name: string,
   pair: LoraStrengthPair,
): Record<string, unknown> {
   return { ...record, [name]: withLora(record[name], { strength: [pair.model, pair.clip] }) }
}
