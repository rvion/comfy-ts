// the serve web panel's HOST PROTOCOL, as types only: what a page embedding the panel in an
// <iframe> sends and receives over postMessage. No runtime, no DOM, no imports: `comfy-ts/web`
// re-exports these as types, and the panel's parsers live in src/cli/serve/web/state/host.ts.
// The contract, message by message, is agent/architecture.md → HOST PROTOCOL.

/** a button the host asks the panel to draw on every result */
export type PanelHostAction = { id: string; label: string; title?: string }

/** the host requests that always get exactly one reply: `state` or `error` */
export type PanelRequest = 'set-selection' | 'set-values' | 'get-state'

/** the form as it is now: var name → value in the draft file's shape (seed `{mode,value}`,
 * size `{width,height}`, loras `{name: strength}`). `request` names the host request this
 * answers; absent when the panel volunteers it (a user edit, a user switch, run seeds).
 * `rejected` is on a `set-values` reply only: every name that was NOT applied (no such var,
 * or a value its control cannot produce). Never posted before the host origin is pinned */
export type PanelState = {
   comfyTs: 'state'
   module: string
   draft: string
   values: Record<string, unknown>
   request?: PanelRequest
   rejected?: string[]
}

/** `code: 'boot'` (no `request`): the panel could not boot (index failed, zero workflows, the
 * opening draft unreadable); may go out before the pin. Every other code answers one request:
 * `unknown-module` · `select-failed` · `superseded` · `no-form` */
export type PanelError =
   | { comfyTs: 'error'; code: 'boot'; message: string }
   | {
        comfyTs: 'error'
        code: 'unknown-module' | 'select-failed' | 'superseded' | 'no-form'
        message: string
        request: PanelRequest
     }

export type PanelResultAction = {
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

/** panel → host. `selection` is the light subset of `state` (no values), so it may go out
 * before the pin, like `ready` and the boot error */
export type PanelToHost =
   | { comfyTs: 'ready' }
   | { comfyTs: 'selection'; module: string; draft: string }
   | PanelState
   | PanelError
   | PanelResultAction

/** host → panel */
export type HostToPanel =
   | { comfyTs: 'host-actions'; actions: PanelHostAction[] }
   | { comfyTs: 'set-prompt'; text: string }
   | { comfyTs: 'set-selection'; module: string; draft: string }
   | { comfyTs: 'set-values'; values: Record<string, unknown> }
   | { comfyTs: 'get-state' }
