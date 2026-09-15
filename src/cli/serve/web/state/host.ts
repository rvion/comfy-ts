// the HOST protocol: the panel inside an <iframe>, talking to the page that embeds it. A host
// cannot read a cross-origin frame (url, dom, storage), so everything it learns is something the
// panel SAYS. Every message carries a `comfyTs` discriminator, so an unrelated message on the
// window is ignored. The message types live in src/cli/serve/hostProtocol.ts (re-exported as
// types by `comfy-ts/web`); the full contract is agent/architecture.md → HOST PROTOCOL.
//
// WHO IS THE HOST: only `window.parent`. A message whose `source` is another window is ignored,
// and the parent's origin is pinned from its first host message (WebSt.onHostMessage).
// WHAT GOES OUT BEFORE THE PIN: `ready`, `selection` and `error {code:'boot'}` only, to '*'. They
// carry no draft value. `state` and everything else waits for the host to speak (postTarget).
//
// Host messages run IN ORDER, and not before the boot is done: a message that lands while the
// panel is still loading waits for the form instead of being dropped (WebSt.hostChain).
// PURE and DOM-free below `isEmbedded`: the parsers are headless-tested.
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import type { HostToPanel, PanelHostAction, PanelToHost } from 'src/cli/serve/hostProtocol.ts'
import { asSeedForm, pruneLorasRecord } from 'src/cli/serve/web/state/payload.ts'

function isRecord(v: unknown): v is Record<string, unknown> {
   return v != null && typeof v === 'object'
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
   return isRecord(v) && !Array.isArray(v)
}

/** a host message, or null for anything else on the window (other frames, devtools, ads).
 * Never throws: a malformed message is simply not ours */
export function parseFromHost(data: unknown): HostToPanel | null {
   if (!isRecord(data)) return null
   switch (data.comfyTs) {
      case 'set-prompt':
         return typeof data.text === 'string' ? { comfyTs: 'set-prompt', text: data.text } : null
      case 'host-actions': {
         if (!Array.isArray(data.actions)) return null
         const actions: PanelHostAction[] = []
         for (const a of data.actions) {
            if (!isRecord(a) || typeof a.id !== 'string' || a.id === '' || typeof a.label !== 'string') continue
            // a button with no label is invisible, and a second id would make a click ambiguous
            if (a.label === '' || actions.some((x) => x.id === a.id)) continue
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

/** the var `set-prompt` and `?prompt=` fill: the one declared `kind:'prompt'`, else a TEXT var
 * named like a prompt that is not the negative one. A name alone is not enough: a float
 * `prompt_strength` or a `negative_prompt` declared first must never receive the prompt */
export function pickPromptVar<V extends { name: string; desc: VarDescriptor }>(vars: readonly V[]): V | null {
   return (
      vars.find((v) => v.desc.kind === 'prompt') ??
      vars.find(
         (v) => (v.desc.kind === 'text' || v.desc.kind === 'prompt') && /prompt/i.test(v.name) && !/neg/i.test(v.name),
      ) ??
      null
   )
}

/** the targetOrigin a panel message goes out with, or null when it must not go out yet.
 * Before the host origin is pinned only messages carrying no draft value may leave, to '*'.
 * An opaque parent origin ("null") cannot be a targetOrigin (postMessage throws), so it is
 * posted with '*': the post goes to window.parent only, which is the window that pinned it */
export function postTarget(msg: PanelToHost, pinnedOrigin: string | null): string | null {
   if (pinnedOrigin == null) {
      const unpinnedOk =
         msg.comfyTs === 'ready' || msg.comfyTs === 'selection' || (msg.comfyTs === 'error' && msg.code === 'boot')
      return unpinnedOk ? '*' : null
   }
   return pinnedOrigin === 'null' ? '*' : pinnedOrigin
}

/** a host value for a log line. JSON.stringify throws on a BigInt or a cycle, and a throw
 * there used to abort the whole message, reply included */
export function safeStringify(v: unknown): string {
   try {
      const out = JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? `${x}n` : x))
      if (typeof v === 'bigint') return `${v}n`
      return out ?? String(v)
   } catch {
      try {
         return String(v)
      } catch {
         return '[unprintable]'
      }
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
