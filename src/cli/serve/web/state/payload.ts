// PURE value normalization for the web form. DOM-free on purpose:
// headless-tested by tests/serve-web-payload.test.ts. The form does NOT build
// override payloads any more: drafts are live (autosave through PUT, generate
// posts {}) — architecture item 12, web ui
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'

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

/** the record the web keeps holds ON loras ONLY, so it always reads as "what is in the
 * palette". Two things are dropped: keys the host no longer offers (dead weight the ui
 * cannot display, and a server-side build failure), and `false` entries — LorasVar writes
 * one for every lora ever unticked, so treating them as palette members put the WHOLE
 * catalog in the row. Off is off: `activeLoras` skips both spellings, so nothing changes
 * in the graph, and with live drafts the next autosave heals the file */
export function pruneLorasRecord(raw: unknown, options: readonly string[]): Record<string, unknown> {
   if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
   const known = new Set(options)
   const out: Record<string, unknown> = {}
   for (const [k, st] of Object.entries(raw as Record<string, unknown>)) if (known.has(k) && loraIsOn(st)) out[k] = st
   return out
}

/** what a fresh VarSt starts from: the draft value when present, else the descriptor default — seed/size/loras normalized so controls never branch on shape */
export function normalizeInitial(desc: VarDescriptor, raw: unknown): unknown {
   if (desc.kind === 'seed') return asSeedForm(raw ?? desc.default)
   if (desc.kind === 'size') return asSizeForm(raw ?? desc.default)
   if (desc.kind === 'loras') return pruneLorasRecord(raw ?? desc.default, desc.options ?? [])
   return raw ?? desc.default
}

export function randomSeed(): number {
   return Math.floor(Math.random() * 2 ** 32)
}

// ---- loras record transitions (LorasVar's semantics, mirrored for the web) ----
// key absent = not selected · false = SELECTED but off (stays in the ui) ·
// number | [model, clip] | true = on. LorasVar keeps the same `prev` memory so
// off → on restores the strength instead of snapping to 1

export type LoraStrengthPair = { model: number; clip: number }

export function loraIsOn(st: unknown): boolean {
   return st != null && st !== false
}

/** any stored strength shape → the {model, clip} pair the inputs edit */
export function loraStrengthPair(st: unknown): LoraStrengthPair {
   if (typeof st === 'number' && Number.isFinite(st)) return { model: st, clip: st }
   if (Array.isArray(st) && typeof st[0] === 'number' && typeof st[1] === 'number') return { model: st[0], clip: st[1] }
   return { model: 1, clip: 1 }
}

/** pause/resume. A PAUSE removes the lora from the record entirely — the palette membership
 * of a paused lora lives in the ui, not in the draft, so a draft never accumulates the
 * off-entries that flooded the palette. Resuming writes the remembered strength back */
export function setLoraEnabled(
   record: Record<string, unknown>,
   name: string,
   on: boolean,
   prev?: LoraStrengthPair,
): Record<string, unknown> {
   const next = { ...record }
   // PAUSE KEEPS THE KEY (as `false`): deleting it dropped the lora out of the record's
   // insertion order, so pausing a card sent it to the end of the row. `false` is the same
   // "selected but off" spelling LorasVar uses, every reader ignores it, and normalizeInitial
   // prunes it on load — so nothing accumulates in the draft file
   if (!on) next[name] = false
   else {
      const pair = prev ?? loraStrengthPair(record[name])
      next[name] = [pair.model, pair.clip]
   }
   return next
}

/**
 * the palette, IN ORDER: the record's own key order (newest last on disk, shown newest FIRST),
 * plus loras paused in this session that already left the record. Pure, because the order is
 * the thing a drag rewrites and a pause must not touch.
 */
export function paletteOrder(p: {
   record: Record<string, unknown>
   options: readonly string[]
   /** paused in this session — kept in the palette even when the record no longer lists them */
   paused: ReadonlySet<string>
}): string[] {
   const known = new Set(p.options)
   const inRecord = Object.keys(p.record).filter((n) => known.has(n) && (loraIsOn(p.record[n]) || p.paused.has(n)))
   const pausedOnly = [...p.paused].filter((n) => known.has(n) && !inRecord.includes(n))
   return [...inRecord, ...pausedOnly].reverse()
}

/** move a lora to a new slot in the PALETTE (what the row shows, newest first) and give back the
 * record rewritten in that order — the record's key order IS the stored order */
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
   // displayed is newest-first; the record stores the opposite, so it is written back reversed
   for (const name of [...next].reverse()) if (name in p.record) out[name] = p.record[name]
   // anything the palette does not show (a key pruned from view) keeps its entry
   for (const [k, v] of Object.entries(p.record)) if (!(k in out)) out[k] = v
   return out
}

/** set both strengths; an OFF lora stays off (its strength is edited on re-enable) */
export function setLoraStrength(
   record: Record<string, unknown>,
   name: string,
   pair: LoraStrengthPair,
): Record<string, unknown> {
   return { ...record, [name]: [pair.model, pair.clip] }
}
