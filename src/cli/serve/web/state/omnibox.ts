// the omnibox list and its match. PURE and DOM-free, tests/serve-web-omnibox.test.ts.
// grouped: one workflow row, then its drafts. A query word that IS a tag keeps only the
// workflows carrying it, the other words fuzzy match names and tags
import { groupModulesByFolder, type TreeItem } from 'src/cli/serve/web/state/moduleTree.ts'

export type OmniModule = TreeItem & { host: string; drafts: string[]; tags?: string[] }

/** a workflow row opens `draft`, its first draft */
export type OmniboxEntry = {
   kind: 'workflow' | 'draft'
   module: string
   draft: string
   host: string
   folder: string
   tags: string[]
}

export function entryKey(e: OmniboxEntry): string {
   return `${e.kind}:${e.module}/${e.draft}`
}

export function omniboxEntries(modules: readonly OmniModule[]): OmniboxEntry[] {
   const out: OmniboxEntry[] = []
   for (const group of groupModulesByFolder(modules)) {
      for (const mod of group.modules) {
         // no saved draft still opens: the server serves the spec values as `default`
         const drafts = mod.drafts.length > 0 ? mod.drafts : ['default']
         const base = { module: mod.module, host: mod.host, folder: group.folder, tags: mod.tags ?? [] }
         out.push({ kind: 'workflow', draft: drafts[0] ?? 'default', ...base })
         for (const draft of drafts) out.push({ kind: 'draft', draft, ...base })
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

type Group = { head: OmniboxEntry; drafts: OmniboxEntry[]; ix: number }

function groupsOf(entries: readonly OmniboxEntry[]): Group[] {
   const groups: Group[] = []
   for (const e of entries) {
      if (e.kind === 'workflow') groups.push({ head: e, drafts: [], ix: groups.length })
      else groups.at(-1)?.drafts.push(e)
   }
   return groups
}

const max = (a: number | null, b: number | null): number | null => (a == null ? b : b == null ? a : Math.max(a, b))

/** a letter scattered across the label scores ~1, one at a word start or in a run ~4 to 6.
 * Below this average the hit is noise, and in a grouped list noise costs a whole workflow */
const MIN_SCORE_PER_LETTER = 2.5

export function searchOmnibox(entries: readonly OmniboxEntry[], query: string): OmniboxEntry[] {
   const words = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== '')
   if (words.length === 0) return [...entries]
   const known = new Set(entries.flatMap((e) => e.tags))
   const tagWords = words.filter((w) => known.has(w))
   const text = words.filter((w) => !known.has(w)).join('')
   const scored: { group: Group; score: number; rows: OmniboxEntry[] }[] = []
   for (const group of groupsOf(entries)) {
      if (!tagWords.every((t) => group.head.tags.includes(t))) continue
      if (text === '') {
         scored.push({ group, score: 0, rows: [group.head, ...group.drafts] })
         continue
      }
      const headText = `${group.head.folder}/${group.head.module} ${group.head.tags.join(' ')}`
      const good = (score: number | null): number | null =>
         score != null && score >= text.length * MIN_SCORE_PER_LETTER ? score : null
      const headScore = good(fuzzyScore(text, headText))
      // the draft name alone first: typing a draft name should not lose to a folder that shares letters
      const drafts = group.drafts
         .map((d) => {
            const own = good(fuzzyScore(text, d.draft))
            return {
               d,
               own,
               score: max(own == null ? null : own + 2, good(fuzzyScore(text, `${headText}/${d.draft}`))),
            }
         })
         .filter((x): x is { d: OmniboxEntry; own: number | null; score: number } => x.score != null)
      const draftHits = drafts.filter((x) => x.own != null)
      const best = max(
         headScore,
         drafts.reduce<number | null>((m, x) => max(m, x.score), null),
      )
      if (best == null) continue
      // drafts matched by their own name are what was searched; otherwise the whole workflow
      const shown =
         draftHits.length > 0 ? [...draftHits].sort((a, b) => b.score - a.score).map((x) => x.d) : group.drafts
      scored.push({ group, score: best, rows: [group.head, ...shown] })
   }
   scored.sort((a, b) => b.score - a.score || a.group.ix - b.group.ix)
   return scored.flatMap((s) => s.rows)
}
