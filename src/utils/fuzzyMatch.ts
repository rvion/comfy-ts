/** case-insensitive subsequence match: 'wide' hits '16:9 (Widescreen)' */
export function fuzzyMatch(needle: string, hay: string): boolean {
   const n = needle.toLowerCase()
   const h = hay.toLowerCase()
   let i = 0
   for (const ch of h) if (ch === n[i]) i++
   return i >= n.length
}
