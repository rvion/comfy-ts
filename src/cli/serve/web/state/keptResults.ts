// the page's results after a reload: what the serve process kept, merged with what this page
// already holds (a run can finish while the list is in flight). PURE, headless-tested
import { KEPT_RUNS } from 'src/cli/serve/resultHistory.ts'

type Run = { promptId: string; finishedAt?: number }

/** one entry per promptId, the page's own copy first, newest first, capped like the server */
export function mergeKept<R extends Run>(current: readonly R[], kept: readonly R[]): R[] {
   const seen = new Set(current.map((r) => r.promptId))
   const merged = [...current, ...kept.filter((r) => !seen.has(r.promptId))]
   return merged
      .map((r, ix) => ({ r, ix }))
      .sort((a, b) => (b.r.finishedAt ?? 0) - (a.r.finishedAt ?? 0) || a.ix - b.ix)
      .map((x) => x.r)
      .slice(0, KEPT_RUNS)
}

/** an output that only the serve process holds: gone on a restart, or past the memory budget */
export function isEphemeral(out: { url: string | null; absPath: string | null }): boolean {
   return out.absPath == null && out.url != null
}

export function formatMb(bytes: number): string {
   const mb = bytes / (1024 * 1024)
   return mb < 10 ? mb.toFixed(1) : String(Math.round(mb))
}
