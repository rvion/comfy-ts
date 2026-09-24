// what a draft file carries BESIDE its var values: keys starting with `$`, never a var name (a var
// is an identifier). Today one: `$enhance`, the enhancer's input per prompt (per lane in lanes
// mode), so each draft keeps its own intent next to the prompt it refines. Every reader walks
// the workflow's vars and ignores these keys; every writer keeps them (preserveDraftMeta). PURE,
// the browser bundle and the TUI both import it
export const ENHANCE_KEY = '$enhance'

/** where one intent lives in `$enhance`: the var, or `var#lane` for one lane */
export function intentKey(varName: string, lane: number | null): string {
   return lane == null ? varName : `${varName}#${lane}`
}

/** `$enhance` as a clean string map: a hand-broken entry drops, the rest stays */
export function readIntents(raw: unknown): Record<string, string> {
   if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
   const out: Record<string, string> = {}
   for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v !== '') out[k] = v
   return out
}

/** a parsed draft file: a json object, never an array or a scalar */
export function isDraftRecord(raw: unknown): raw is Record<string, unknown> {
   return raw != null && typeof raw === 'object' && !Array.isArray(raw)
}

export function isDraftMetaKey(key: string): boolean {
   return key === ENHANCE_KEY
}

/** a writer that knows only the var values keeps what the file already carried beside them */
export function preserveDraftMeta(
   previous: Record<string, unknown> | null,
   next: Record<string, unknown>,
): Record<string, unknown> {
   if (previous == null) return next
   const out = { ...next }
   for (const [k, v] of Object.entries(previous)) if (isDraftMetaKey(k) && !(k in out)) out[k] = v
   return out
}
