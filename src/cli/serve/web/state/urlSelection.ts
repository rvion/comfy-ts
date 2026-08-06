// the selection lives in the URL, so a panel you are looking at can be SENT to someone and
// they land on the same workflow and draft. PURE and DOM-free: headless-tested by
// tests/serve-web-url-selection.test.ts, the browser side is two calls in WebSt.

export type UrlSelection = { module: string | null; draft: string | null }

const MODULE_PARAM = 'workflow'
const DRAFT_PARAM = 'draft'

/** what a url asks for. Never throws: a hand-edited or truncated query is simply "nothing
 * asked", because a bad link must open the panel, not break it */
export function readUrlSelection(search: string): UrlSelection {
   try {
      const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      const module = params.get(MODULE_PARAM)
      const draft = params.get(DRAFT_PARAM)
      return { module: module === '' ? null : module, draft: draft === '' ? null : draft }
   } catch {
      return { module: null, draft: null }
   }
}

/**
 * the query for a selection, with everything else in the url PRESERVED, the panel does not
 * own the whole query string, and eating an unrelated param someone appended would be rude.
 * returns the full search string, `''` when there is nothing to carry.
 */
export function writeUrlSelection(p: { search: string; module: string; draft: string }): string {
   const params = new URLSearchParams(p.search.startsWith('?') ? p.search.slice(1) : p.search)
   params.set(MODULE_PARAM, p.module)
   params.set(DRAFT_PARAM, p.draft)
   const text = params.toString()
   return text === '' ? '' : `?${text}`
}

/** the selection to open with: THE URL WINS over what this browser last had. A link is an
 * explicit instruction from whoever sent it; the stored selection is only a memory of your
 * own last visit, and it must never override the link you just clicked. */
export function resolveSelection(p: {
   url: UrlSelection
   stored: UrlSelection
   /** module key → its drafts */
   modules: readonly { module: string; drafts: readonly string[] }[]
}): { module: string; draft: string } | null {
   const pick = (key: string | null): { module: string; drafts: readonly string[] } | null =>
      key == null ? null : (p.modules.find((m) => m.module === key) ?? null)
   // a url naming a module this server does not serve falls back rather than showing nothing
   const mod = pick(p.url.module) ?? pick(p.stored.module) ?? p.modules[0]
   if (mod == null) return null
   const wanted = p.url.module != null && p.url.module === mod.module ? p.url.draft : p.stored.draft
   const draft = wanted != null && mod.drafts.includes(wanted) ? wanted : 'default'
   return { module: mod.module, draft }
}
