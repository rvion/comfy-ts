// the ⌘K / ⌘J search over every workflow and draft. The list and the match are pure
// (omnibox.ts); this holds what is typed, which row is lit, and opens the pick
import { makeAutoObservable } from 'mobx'
import { omniboxEntries, searchOmnibox, type OmniboxEntry } from 'src/cli/serve/web/state/omnibox.ts'
import type { WebSt } from 'src/cli/serve/web/state/WebSt.ts'

export class OmniboxSt {
   isOpen = false
   query = ''
   cursor = 0

   constructor(private st: WebSt) {
      makeAutoObservable<OmniboxSt, 'st'>(this, { st: false })
   }

   get results(): OmniboxEntry[] {
      return searchOmnibox(omniboxEntries(this.st.modules), this.query)
   }

   open(): void {
      this.isOpen = true
      this.query = ''
      // the open draft is lit, so Enter right away is a no-op rather than a jump elsewhere
      const current = this.st.form
      const ix =
         current == null
            ? -1
            : this.results.findIndex(
                 (e) => e.kind === 'draft' && e.module === current.moduleKey && e.draft === current.draft,
              )
      this.cursor = Math.max(0, ix)
   }

   close(): void {
      this.isOpen = false
   }

   toggle(): void {
      if (this.isOpen) this.close()
      else this.open()
   }

   setQuery(v: string): void {
      this.query = v
      this.cursor = 0
   }

   move(delta: number): void {
      const n = this.results.length
      if (n === 0) return
      this.cursor = (this.cursor + delta + n) % n
   }

   pick(entry: OmniboxEntry | undefined = this.results[this.cursor]): void {
      if (entry == null) return
      this.close()
      void this.st.select({ module: entry.module, draft: entry.draft })
   }
}
