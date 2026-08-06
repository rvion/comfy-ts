import { makeAutoObservable } from 'mobx'
import { fuzzyMatch } from 'src/utils/fuzzyMatch.ts'
import type { ChoiceVar, PromptVar, SizeVar, TextVar } from 'src/vars/ComfyVars.ts'
import type { VarPreset } from 'src/vars/presets.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** the two var classes that carry presets */
type PresetVar = TextVar | PromptVar

/**
 * choice + size + preset overlays: a windowed option list with a fuzzy type-to-filter.
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
   /** size overlay only: the linked image var's live dims, read ONCE per open
    * (fs read — never inside the options computed, which runs per keystroke) */
   imageSizeRow: string | null = null

   // kind-narrowing casts sanctioned (agent/coding.md), `kind` is the tag
   private get choiceVar(): ChoiceVar<string> | null {
      const sel = this.st.selected?.[1]
      return sel?.kind === 'choice' ? (sel as ChoiceVar<string>) : null
   }

   private get sizeVar(): SizeVar | null {
      const sel = this.st.selected?.[1]
      return sel?.kind === 'size' ? (sel as SizeVar) : null
   }

   /** null when the selected var is not text/prompt, or carries no presets */
   get presetVar(): PresetVar | null {
      const sel = this.st.selected?.[1]
      if (sel == null || (sel.kind !== 'text' && sel.kind !== 'prompt')) return null
      const withPresets = sel as PresetVar
      return withPresets.presets.length === 0 ? null : withPresets
   }

   /** the preset rows the filter kept — the label AND the text are searched, since what you
    * remember of a preset is often a phrase inside it */
   get presetOptions(): VarPreset[] {
      const pv = this.presetVar
      if (pv == null) return []
      if (this.filter === '') return pv.presets
      return pv.presets.filter((x) => fuzzyMatch(this.filter, `${x.label} ${x.text}`))
   }

   get options(): string[] {
      const pv = this.presetVar
      if (pv != null) return this.presetOptions.map((x) => x.label)
      const cv = this.choiceVar
      if (cv != null) {
         if (this.filter === '') return [...cv.choices]
         return cv.choices.filter((c) => fuzzyMatch(this.filter, c))
      }
      const sv = this.sizeVar
      if (sv != null) {
         const labels = sv.presets.map((p) => `${p.width}×${p.height}  ${p.label}`)
         if (this.imageSizeRow != null) labels.unshift(this.imageSizeRow)
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

   /** `P` on a text/prompt var that declares presets. A var without any stays on `nav`:
    * the keybar only advertises the key when the row has some */
   beginPresets(): void {
      const pv = this.presetVar
      if (pv == null) return
      this.st.mode = 'overlay-preset'
      this.filter = ''
      this.invalid = false
      const value = pv.value.trim()
      const ix = pv.presets.findIndex((x) => x.text.trim() === value)
      this.ix = ix === -1 ? 0 : ix
   }

   beginSize(): void {
      const sv = this.sizeVar
      if (sv == null) return
      this.st.mode = 'overlay-size'
      this.filter = ''
      this.invalid = false
      const img = sv.imageSize()
      this.imageSizeRow = img == null ? null : `${img.width}×${img.height}  size of image '${img.name}'`
      const presetIx = sv.presets.findIndex((p) => p.width === sv.value.width && p.height === sv.value.height)
      this.ix = presetIx === -1 ? 0 : presetIx + (this.imageSizeRow != null ? 1 : 0)
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
      const pv = this.presetVar
      if (pv != null) {
         const hit = this.presetOptions[this.ix]
         if (hit == null) return
         // REPLACES the value, like the web panel's menu: a preset is a starting text, and the
         // draft the row came from is what reverts it
         pv.set(hit.text)
         this.st.mode = 'nav'
         return
      }
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
