// PURE value normalization for the web form. DOM-free on purpose:
// headless-tested by tests/serve-web-payload.test.ts. The form does NOT build
// override payloads any more: drafts are live (autosave through PUT, generate
// posts {}) — architecture item 12, web ui
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'

export type SeedFormValue = { mode: string; value: number }
export type SizeFormValue = { width: number; height: number }

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
 * option-driven list and would fail the build server-side. With live drafts the pruned
 * record is what the next autosave WRITES, so stale keys heal out of the draft file —
 * deliberate: a lora the host lost is dead weight the ui cannot even display */
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
