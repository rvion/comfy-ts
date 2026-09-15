// the HOST protocol: the panel inside an <iframe>, talking to the page that embeds it.
// A host cannot read a cross-origin frame (url, dom, storage), so everything it learns is
// something the panel SAYS. Three things go out, two come in, all as postMessage with a
// `comfyTs` discriminator so an unrelated message on the same window is ignored.
//
//   panel → host   { comfyTs: 'ready' }                            once, when the boot is done
//                  { comfyTs: 'selection', module, draft }          on every selection change
//                  { comfyTs: 'result-action', id, ... }            a host button on a result
//   host → panel   { comfyTs: 'host-actions', actions: [{id,label,title?}] }
//                  { comfyTs: 'set-prompt', text }
//
// PURE and DOM-free below `isEmbedded`: the parsers are headless-tested.

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

export type ToHost = { comfyTs: 'ready' } | { comfyTs: 'selection'; module: string; draft: string } | ResultActionMsg

export type FromHost = { comfyTs: 'host-actions'; actions: HostButton[] } | { comfyTs: 'set-prompt'; text: string }

function isRecord(v: unknown): v is Record<string, unknown> {
   return v != null && typeof v === 'object'
}

/** a host message, or null for anything else on the window (other frames, devtools, ads).
 * Never throws: a malformed message is simply not ours */
export function parseFromHost(data: unknown): FromHost | null {
   if (!isRecord(data)) return null
   if (data.comfyTs === 'set-prompt')
      return typeof data.text === 'string' ? { comfyTs: 'set-prompt', text: data.text } : null
   if (data.comfyTs === 'host-actions') {
      if (!Array.isArray(data.actions)) return null
      const actions: HostButton[] = []
      for (const a of data.actions) {
         if (!isRecord(a) || typeof a.id !== 'string' || a.id === '' || typeof a.label !== 'string') continue
         actions.push({ id: a.id, label: a.label, ...(typeof a.title === 'string' ? { title: a.title } : {}) })
      }
      return { comfyTs: 'host-actions', actions }
   }
   return null
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
