/** the output row's slot in the stored field order. A var name is a js identifier, so it can
 * never collide with this */
export const OUTPUT_ROW = ':output'

/** every row the form draws, in the workflow's order: its vars, then the output. A stored order
 * that predates the output slot keeps the output last (orderedVars appends unknown names) */
export function formRowNames(varNames: readonly string[]): string[] {
   return [...varNames, OUTPUT_ROW]
}
