// the HOST protocol: the panel inside an <iframe>, talking to the page that embeds it.
// A host cannot read a cross-origin frame (url, dom, storage), so everything it learns is
// something the panel SAYS. All messages are postMessage with a `comfyTs` discriminator, so an
// unrelated message on the same window is ignored.
//
//   panel → host   { comfyTs: 'ready' }                            once, when the boot is done
//                  { comfyTs: 'selection', module, draft }          after every selection change
//                  { comfyTs: 'state', module, draft, values }      after every selection change,
//                                                                  after set-values, on get-state
//                  { comfyTs: 'result-action', id, ... }            a host button on a result
//   host → panel   { comfyTs: 'host-actions', actions: [{id,label,title?}] }
//                  { comfyTs: 'set-prompt', text }
//                  { comfyTs: 'set-selection', module, draft }
//                  { comfyTs: 'set-values', values: {<var name>: value} }
//                  { comfyTs: 'get-state' }
//
// Host messages run IN ORDER, and not before the boot is done: a message that lands while the
// panel is still loading waits for the form instead of being dropped (WebSt.hostChain).
// PURE and DOM-free below `isEmbedded`: the parsers are headless-tested.
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { asSeedForm, pruneLorasRecord } from 'src/cli/serve/web/state/payload.ts'

export type HostButton = { id: string; label: string; title?: string }

export type ResultActionMsg = {
   comfyTs: 'result-action'
   id: string
   promptId: string
   ix: number
   /** the image url, relative to the panel's own origin (`/images/<promptId>/<ix>` or `/outputs/…`) */
   url: string
   filename: string
   module: string
   draft: string
   seeds: Record<string, number>
   /** the prompt var's text at click time, when the form has one */
   prompt: string | null
}

/** the form as it is now: var name → value in the draft file's shape (seed `{mode,value}`,
 * size `{width,height}`, loras `{name: strength}`) */
export type StateMsg = { comfyTs: 'state'; module: string; draft: string; values: Record<string, unknown> }

export type ToHost =
   | { comfyTs: 'ready' }
   | { comfyTs: 'selection'; module: string; draft: string }
   | StateMsg
   | ResultActionMsg

export type FromHost =
   | { comfyTs: 'host-actions'; actions: HostButton[] }
   | { comfyTs: 'set-prompt'; text: string }
   | { comfyTs: 'set-selection'; module: string; draft: string }
   | { comfyTs: 'set-values'; values: Record<string, unknown> }
   | { comfyTs: 'get-state' }

function isRecord(v: unknown): v is Record<string, unknown> {
   return v != null && typeof v === 'object'
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
   return isRecord(v) && !Array.isArray(v)
}

/** a host message, or null for anything else on the window (other frames, devtools, ads).
 * Never throws: a malformed message is simply not ours */
export function parseFromHost(data: unknown): FromHost | null {
   if (!isRecord(data)) return null
   switch (data.comfyTs) {
      case 'set-prompt':
         return typeof data.text === 'string' ? { comfyTs: 'set-prompt', text: data.text } : null
      case 'host-actions': {
         if (!Array.isArray(data.actions)) return null
         const actions: HostButton[] = []
         for (const a of data.actions) {
            if (!isRecord(a) || typeof a.id !== 'string' || a.id === '' || typeof a.label !== 'string') continue
            actions.push({ id: a.id, label: a.label, ...(typeof a.title === 'string' ? { title: a.title } : {}) })
         }
         return { comfyTs: 'host-actions', actions }
      }
      case 'set-selection':
         return typeof data.module === 'string' && data.module !== '' && typeof data.draft === 'string'
            ? { comfyTs: 'set-selection', module: data.module, draft: data.draft }
            : null
      case 'set-values':
         return isPlainRecord(data.values) ? { comfyTs: 'set-values', values: data.values } : null
      case 'get-state':
         return { comfyTs: 'get-state' }
      default:
         return null
   }
}

/** where a host's set-selection lands. Same fallback as a url (resolveSelection) with one
 * difference: an unknown MODULE is null, "change nothing", because the panel is already showing
 * something and replacing it with an arbitrary first workflow is not what the host asked */
export function resolveHostSelection(p: {
   want: { module: string; draft: string }
   modules: readonly { module: string; drafts: readonly string[] }[]
}): { module: string; draft: string } | null {
   const mod = p.modules.find((m) => m.module === p.want.module)
   if (mod == null) return null
   return { module: mod.module, draft: mod.drafts.includes(p.want.draft) ? p.want.draft : 'default' }
}

export type Coerced = { ok: true; value: unknown } | { ok: false }

const REJECT: Coerced = { ok: false }
const SEED_MODES: readonly string[] = ['=', '+', '-', '?']

function isFiniteNumber(v: unknown): v is number {
   return typeof v === 'number' && Number.isFinite(v)
}

/** a strength a lora record may hold: off, on, one strength, or [model, clip] */
function isLoraEntry(v: unknown): boolean {
   if (typeof v === 'boolean' || isFiniteNumber(v)) return true
   return Array.isArray(v) && v.length === 2 && isFiniteNumber(v[0]) && isFiniteNumber(v[1])
}

/**
 * a value a host sent for one var, held to what the var's CONTROL can produce: a text box
 * gives a string, a number box a finite number (int truncated like parseInt), a select one of
 * its choices, the seed row `{mode, value ≥ 0}`. Anything else is rejected rather than
 * repaired, so a host bug shows up as an unchanged field, not a silently different one.
 * `current` is the var's value now: a bare seed number keeps the current mode, as the box does.
 */
export function coerceHostValue(desc: VarDescriptor, raw: unknown, current: unknown): Coerced {
   switch (desc.kind) {
      case 'prompt':
      case 'text':
      case 'image':
         return typeof raw === 'string' ? { ok: true, value: raw } : REJECT
      case 'int':
         return isFiniteNumber(raw) ? { ok: true, value: Math.trunc(raw) } : REJECT
      case 'float':
         return isFiniteNumber(raw) ? { ok: true, value: raw } : REJECT
      case 'toggle':
         return typeof raw === 'boolean' ? { ok: true, value: raw } : REJECT
      case 'choice':
         return typeof raw === 'string' && (desc.choices ?? []).includes(raw) ? { ok: true, value: raw } : REJECT
      case 'seed': {
         const cur = asSeedForm(current)
         if (isFiniteNumber(raw)) return { ok: true, value: { mode: cur.mode, value: Math.max(0, Math.floor(raw)) } }
         if (!isPlainRecord(raw)) return REJECT
         if (raw.mode !== undefined && !(typeof raw.mode === 'string' && SEED_MODES.includes(raw.mode))) return REJECT
         if (raw.value !== undefined && !isFiniteNumber(raw.value)) return REJECT
         return {
            ok: true,
            value: {
               mode: typeof raw.mode === 'string' ? raw.mode : cur.mode,
               value: isFiniteNumber(raw.value) ? Math.max(0, Math.floor(raw.value)) : cur.value,
            },
         }
      }
      case 'size': {
         let width: unknown = null
         let height: unknown = null
         if (typeof raw === 'string') {
            const m = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(raw)
            if (m != null) {
               width = Number(m[1])
               height = Number(m[2])
            }
         } else if (isPlainRecord(raw)) {
            width = raw.width
            height = raw.height
         }
         if (!isFiniteNumber(width) || !isFiniteNumber(height) || width < 1 || height < 1) return REJECT
         return { ok: true, value: { width: Math.floor(width), height: Math.floor(height) } }
      }
      case 'loras': {
         if (!isPlainRecord(raw)) return REJECT
         for (const st of Object.values(raw)) if (!isLoraEntry(st)) return REJECT
         // the record the form keeps: known loras that are ON (payload.ts owns the why)
         return { ok: true, value: pruneLorasRecord(raw, desc.options ?? []) }
      }
      default:
         return REJECT
   }
}

/** `?prompt=<text>` — a host opens the panel with the prompt already in the box */
export function readUrlPrompt(search: string): string | null {
   try {
      const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      const p = params.get('prompt')
      return p == null || p === '' ? null : p
   } catch {
      return null
   }
}

export function isEmbedded(): boolean {
   try {
      return typeof window !== 'undefined' && window.parent !== window
   } catch {
      return false
   }
}
