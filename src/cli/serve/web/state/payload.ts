// PURE form → POST payload + value normalization. DOM-free on purpose:
// headless-tested by tests/serve-web-payload.test.ts.
// Rules (architecture item 12, web ui): DIRTY vars only — the draft stays the
// base; a dirty seed posts a NUMBER (posting a bare mode would skip the
// server's reroll branch, so the ui never does)
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'

export type SeedFormValue = { mode: string; value: number }
export type SizeFormValue = { width: number; height: number }
export type FormEntrySnapshot = { name: string; desc: VarDescriptor; value: unknown; dirty: boolean }

export function buildPayload(entries: FormEntrySnapshot[]): Record<string, unknown> {
   const out: Record<string, unknown> = {}
   for (const e of entries) {
      if (!e.dirty) continue
      out[e.name] = e.desc.kind === 'seed' ? asSeedForm(e.value).value : e.value
   }
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

/** drop record keys the host no longer offers: a stale draft entry is invisible in the
 * option-driven list, and applyVarPayload rejects the whole record over it — the draft
 * itself stays untouched, only what the form POSTS is pruned */
export function pruneLorasRecord(raw: unknown, options: readonly string[]): Record<string, unknown> {
   if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
   const known = new Set(options)
   const out: Record<string, unknown> = {}
   for (const [k, st] of Object.entries(raw as Record<string, unknown>)) if (known.has(k)) out[k] = st
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
