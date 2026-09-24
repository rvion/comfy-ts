// vars that go together (VarUi.group): CONSECUTIVE rows with the same group share one block.
// PURE, tests/serve-web-var-groups.test.ts. A group split by a row you dragged between its
// members becomes two blocks, which is what the eye sees anyway

export type GroupPlace = { pos: 'solo' | 'start' | 'mid' | 'end'; color: string | null } | null

export function groupPlaces(rows: readonly { group?: string; groupColor?: string }[]): GroupPlace[] {
   const out: GroupPlace[] = rows.map(() => null)
   let i = 0
   while (i < rows.length) {
      const g = rows[i]?.group
      if (g == null) {
         i++
         continue
      }
      let j = i
      while (j + 1 < rows.length && rows[j + 1]?.group === g) j++
      const color = rows.slice(i, j + 1).find((r) => r.groupColor != null)?.groupColor ?? null
      for (let k = i; k <= j; k++)
         out[k] = { pos: i === j ? 'solo' : k === i ? 'start' : k === j ? 'end' : 'mid', color }
      i = j + 1
   }
   return out
}
