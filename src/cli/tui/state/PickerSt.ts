import { makeAutoObservable } from 'mobx'
import { fuzzyMatch } from 'src/utils/fuzzyMatch.ts'
import type { ChoiceVar, SizeVar } from 'src/vars/ComfyVars.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/**
 * choice + size overlays: a windowed option list with a fuzzy type-to-filter.
 * For sizes the filter doubles as free `WxH` entry.
 */
export class PickerSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<PickerSt, 'st'>(this, { st: false })
   }

   filter: string = ''
   ix: number = 0
   /** size overlay only: the filter failed to parse as WxH on commit */
   invalid: boolean = false

   // kind-narrowing casts sanctioned (agent/coding.md), `kind` is the tag
   private get choiceVar(): ChoiceVar<string> | null {
      const sel = this.st.selected?.[1]
      return sel?.kind === 'choice' ? (sel as ChoiceVar<string>) : null
   }

   private get sizeVar(): SizeVar | null {
      const sel = this.st.selected?.[1]
      return sel?.kind === 'size' ? (sel as SizeVar) : null
   }

   get options(): string[] {
      const cv = this.choiceVar
      if (cv != null) {
         if (this.filter === '') return [...cv.choices]
         return cv.choices.filter((c) => fuzzyMatch(this.filter, c))
      }
      const sv = this.sizeVar
      if (sv != null) {
         const labels = sv.presets.map((p) => `${p.width}×${p.height}  ${p.label}`)
         if (this.filter === '') return labels
         return labels.filter((l) => fuzzyMatch(this.filter, l))
      }
      return []
   }

   beginChoice(): void {
      const cv = this.choiceVar
      if (cv == null) return
      this.st.mode = 'overlay-choice'
      this.filter = ''
      this.invalid = false
      this.ix = Math.max(0, cv.choices.indexOf(cv.value))
   }

   beginSize(): void {
      const sv = this.sizeVar
      if (sv == null) return
      this.st.mode = 'overlay-size'
      this.filter = ''
      this.invalid = false
      const ix = sv.presets.findIndex((p) => p.width === sv.value.width && p.height === sv.value.height)
      this.ix = ix === -1 ? 0 : ix
   }

   move(delta: number): void {
      const len = this.options.length
      if (len === 0) return
      this.ix = (this.ix + delta + len) % len
   }

   filterInput(chunk: string): void {
      this.filter += chunk
      this.ix = 0
      this.invalid = false
   }

   filterBackspace(): void {
      this.filter = this.filter.slice(0, -1)
      this.ix = 0
      this.invalid = false
   }

   /** ⌥⌫ / ⌃W: drop the last word of the filter */
   filterDeleteWord(): void {
      this.filter = this.filter.replace(/\s*\S+\s*$/, '')
      this.ix = 0
      this.invalid = false
   }

   commit(): void {
      const cv = this.choiceVar
      if (cv != null) {
         const hit = this.options[this.ix]
         if (hit == null) return
         cv.set(hit)
         this.st.mode = 'nav'
         return
      }
      const sv = this.sizeVar
      if (sv == null) return
      const hit = this.options[this.ix]
      if (hit != null) {
         const m = hit.match(/^(\d+)×(\d+)/)
         if (m != null) sv.set({ width: Number(m[1]), height: Number(m[2]) })
         this.st.mode = 'nav'
         return
      }
      // no preset survives the filter: the filter IS the custom `WxH` entry
      if (sv.parse(this.filter)) this.st.mode = 'nav'
      else this.invalid = true
   }
}
