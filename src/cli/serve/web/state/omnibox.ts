// the omnibox list and its fuzzy match. PURE and DOM-free, tests/serve-web-omnibox.test.ts.
// one entry per draft, labelled folder/workflow/draft, so typing a folder, a workflow or a
// draft name all land on the same list
import { groupModulesByFolder, type TreeItem } from 'src/cli/serve/web/state/moduleTree.ts'

export type OmniboxEntry = { module: string; draft: string; host: string; label: string }

export function omniboxEntries(modules: readonly (TreeItem & { host: string; drafts: string[] })[]): OmniboxEntry[] {
   const out: OmniboxEntry[] = []
   for (const group of groupModulesByFolder(modules)) {
      for (const mod of group.modules) {
         // no saved draft still opens: the server serves the spec values as `default`
         const drafts = mod.drafts.length > 0 ? mod.drafts : ['default']
         const prefix = group.folder === '' ? mod.module : `${group.folder}/${mod.module}`
         for (const draft of drafts)
            out.push({ module: mod.module, draft, host: mod.host, label: `${prefix}/${draft}` })
      }
   }
   return out
}

function isBoundary(ch: string | undefined): boolean {
   return ch == null || ch === '/' || ch === '-' || ch === '_' || ch === ' ' || ch === '.'
}

function scoreFrom(q: string, t: string, start: number): number | null {
   let score = 0
   let at = start - 1
   for (const ch of q) {
      const found = t.indexOf(ch, at + 1)
      if (found < 0) return null
      score += 1
      if (found === at + 1) score += 3
      if (isBoundary(t[found - 1])) score += 5
      // late hits cost a little, so the same letters earlier in the label win ties
      score -= (found - at - 1) * 0.05
      at = found
   }
   return score
}

/** subsequence match, higher is better, null when the letters are not all there in order.
 * a letter after a separator or right after the previous hit counts extra. Every place the
 * first letter occurs is tried, since the first `a` of `examples/…/anima` is the wrong one */
export function fuzzyScore(query: string, text: string): number | null {
   const q = query.toLowerCase().replace(/\s+/g, '')
   if (q === '') return 0
   const t = text.toLowerCase()
   let best: number | null = null
   for (let start = t.indexOf(q[0] ?? ''); start >= 0; start = t.indexOf(q[0] ?? '', start + 1)) {
      const score = scoreFrom(q, t, start)
      if (score != null && (best == null || score > best)) best = score
   }
   return best
}

export function searchOmnibox(entries: readonly OmniboxEntry[], query: string): OmniboxEntry[] {
   if (query.trim() === '') return [...entries]
   const scored: { entry: OmniboxEntry; score: number; ix: number }[] = []
   for (const [ix, entry] of entries.entries()) {
      // the draft alone first: typing a draft name should not lose to a folder that shares letters
      const draftScore = fuzzyScore(query, entry.draft)
      const labelScore = fuzzyScore(query, entry.label)
      const score = Math.max(draftScore == null ? -Infinity : draftScore + 2, labelScore ?? -Infinity)
      if (score !== -Infinity) scored.push({ entry, score, ix })
   }
   scored.sort((a, b) => b.score - a.score || a.ix - b.ix)
   return scored.map((s) => s.entry)
}
