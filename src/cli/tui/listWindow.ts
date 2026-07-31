/** a scroll window over a list, `…` markers INCLUDED in the line budget
 * (OverlayList's markers ride on modal slack instead — different contract) */
export type ListWindow = {
   start: number
   end: number
   moreAbove: boolean
   moreBelow: boolean
}

/**
 * window a list around the selection so that
 * (moreAbove ? 1 : 0) + (end - start) + (moreBelow ? 1 : 0) <= budget,
 * with the selection always inside [start, end). Degenerate budgets (<= 2)
 * drop the markers and show a bare slice at the selection.
 */
export const listWindow = (p: { count: number; selected: number; budget: number }): ListWindow => {
   if (p.count === 0 || p.budget <= 0) {
      const at = Math.max(0, Math.min(p.selected, p.count))
      return { start: at, end: at, moreAbove: false, moreBelow: false }
   }
   if (p.count <= p.budget) return { start: 0, end: p.count, moreAbove: false, moreBelow: false }
   const sel = Math.max(0, Math.min(p.selected, p.count - 1))
   if (p.budget <= 2) {
      const start = Math.min(sel, p.count - p.budget)
      return { start, end: start + p.budget, moreAbove: false, moreBelow: false }
   }
   // top region: the window starts at 0, only the below marker eats a line
   if (sel < p.budget - 1) return { start: 0, end: p.budget - 1, moreAbove: false, moreBelow: true }
   // bottom region: the window ends at count, only the above marker eats a line
   if (sel >= p.count - (p.budget - 1))
      return { start: p.count - (p.budget - 1), end: p.count, moreAbove: true, moreBelow: false }
   // middle: both markers eat, the rest centers on the selection
   const visible = p.budget - 2
   const start = Math.max(1, Math.min(sel - Math.floor(visible / 2), p.count - visible - 1))
   return { start, end: start + visible, moreAbove: true, moreBelow: true }
}
