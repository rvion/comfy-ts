// the panel's loud channel. src/utils/log.ts is node-shaped, and a browser failure that only
// updates a state field disappears the moment something re-renders: a console line survives,
// and it is the first thing anyone reads when the ui does something inexplicable.
export function logWebError(what: string, e: unknown): void {
   console.error(`🔴 [comfy-ts serve] ${what}: ${e instanceof Error ? e.message : String(e)}`)
}
