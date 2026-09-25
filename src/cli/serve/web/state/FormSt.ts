// form state for ONE module+draft selection — swapped whole on WebSt when the
// selection changes (observableRef there, dispose() first: the autosave
// reaction is owned here). DRAFTS ARE LIVE (the TUI model): edits autosave
// through PUT /drafts, generate posts {} — the draft is the one source of truth
import { makeAutoObservable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx'
import { fetchPreviews, saveDraft, type ModuleDescription } from 'src/cli/serve/web/api.ts'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { normalizeInitial, payloadSnapshot } from 'src/cli/serve/web/state/payload.ts'
import {
   flattenLoras,
   isLorasInput,
   loraSetting,
   paletteLoras,
   updateLora,
   type LoraRecord,
   type LorasInput,
} from 'src/vars/lanes.ts'
import { keywordParts, loraMuted, withLora } from 'src/vars/loraEntry.ts'
import { ENHANCE_KEY, readIntents } from 'src/cli/draftMeta.ts'

/** one var row: value in toJSON shape, replaced whole on every edit */
export class VarSt {
   value: unknown
   /** changed since the draft loaded — drives the revert affordance, not the payload */
   dirty = false
   /** image vars only: a browser-visible url for the current value (upload response or http value) */
   uploadedUrl: string | null = null

   constructor(
      public readonly name: string,
      public readonly desc: VarDescriptor,
      public initial: unknown,
   ) {
      this.value = initial
      makeAutoObservable(this, { value: observableRef, name: false, desc: false })
   }

   set(value: unknown): void {
      this.value = value
      this.dirty = true
   }

   /** a value the RUN reported, not one you typed: it re-baselines, so the row is not marked
    * changed and revert-all does not offer to undo something nobody did */
   setFromRun(value: unknown): void {
      this.value = value
      this.initial = value
      this.dirty = false
   }

   setUploadedUrl(url: string | null): void {
      this.uploadedUrl = url
   }

   /** the workflow's declared default, in the shape the controls hold */
   get defaultValue(): unknown {
      return normalizeInitial(this.desc, this.desc.default)
   }

   /** by value: a size or a choice list is a fresh object every time */
   get isAtDefault(): boolean {
      return JSON.stringify(this.value) === JSON.stringify(this.defaultValue)
   }

   /** back to what the workflow declares; an edit like any other (autosaved, revertable) */
   resetToDefault(): void {
      this.set(this.defaultValue)
   }

   revert(): void {
      this.value = this.initial
      this.dirty = false
      this.uploadedUrl = null
   }

   snapshot(): { name: string; value: unknown } {
      return { name: this.name, value: this.value }
   }
}

/** the debounces a form runs on: tests set them to a few ms rather than wait them out */
export type FormTiming = { autosaveMs: number; previewMs: number }
export const FORM_TIMING: FormTiming = { autosaveMs: 500, previewMs: 250 }

export class FormSt {
   vars: VarSt[]
   /** the module's host id — lora hover data routes are host-scoped */
   readonly host: string
   saveState: 'saved' | 'saving' | 'error' = 'saved'
   saveError: string | null = null
   private disposers: IReactionDisposer[] = []
   /** saves are chained so two PUTs can never land out of order */
   private saveChain: Promise<boolean> = Promise.resolve(true)
   /** the values json the server last CONFIRMED — what is really on disk */
   private lastSaved: string
   /** the values json last HANDED to the chain, confirmed or still in flight. save() no-ops
    * against this one, never against lastSaved: while a PUT is open the disk does not hold
    * lastSaved any more, so editing back to it wrote nothing and the in-flight value won */
   private lastQueued: string
   /** identity of the newest queued write, so a rollback cannot claim someone else's */
   private queueSeq = 0
   /** called on the autosave debounce, right after the save is queued: the embedding host
    * mirrors the form from it (WebSt), one call per settled burst of edits, never per key */
   onSettled: (() => void) | null = null
   /** the workflow's live previews for the values on screen, name → text */
   previews: Record<string, string> = {}
   previewError: string | null = null
   private previewAbort: AbortController | null = null

   constructor(
      public readonly moduleKey: string,
      public readonly draft: string,
      mod: ModuleDescription,
      values: Record<string, unknown>,
      timing: FormTiming = FORM_TIMING,
   ) {
      this.host = mod.host
      this.vars = Object.entries(mod.vars).map(
         ([name, desc]) => new VarSt(name, desc, normalizeInitial(desc, values[name])),
      )
      this.intents = readIntents(values[ENHANCE_KEY])
      // seeded from the RAW reply, not the normalized values: when normalizeInitial heals
      // something (a stale lora key), the form is already out of sync with the file and the
      // next save() must actually send, otherwise the server keeps building the stale record
      this.lastSaved = JSON.stringify(
         withIntents(Object.fromEntries(this.vars.map((v) => [v.name, values[v.name]])), this.intents),
      )
      this.lastQueued = this.lastSaved
      makeAutoObservable<FormSt, 'disposers' | 'saveChain' | 'lastSaved' | 'lastQueued' | 'queueSeq' | 'previewAbort'>(
         this,
         {
            vars: false,
            moduleKey: false,
            draft: false,
            host: false,
            disposers: false,
            saveChain: false,
            lastSaved: false,
            lastQueued: false,
            queueSeq: false,
            onSettled: false,
            previewAbort: false,
         },
      )
      // the persistence idiom: the values json is change-detector AND payload
      this.disposers.push(
         reaction(
            () => JSON.stringify(this.valuesJSON()),
            () => {
               void this.save()
               this.onSettled?.()
            },
            { delay: timing.autosaveMs },
         ),
      )
      // live previews: the same values json, asked sooner than the save (they are what you
      // watch while typing), the older request cancelled so a slow reply never lands last
      const previewNames = mod.previews ?? []
      if (previewNames.length > 0)
         this.disposers.push(
            reaction(
               () => JSON.stringify(this.varValues()),
               () => void this.refreshPreviews(),
               { delay: timing.previewMs, fireImmediately: true },
            ),
         )
   }

   async refreshPreviews(): Promise<void> {
      this.previewAbort?.abort()
      const abort = new AbortController()
      this.previewAbort = abort
      try {
         const reply = await fetchPreviews({ module: this.moduleKey, values: this.varValues(), signal: abort.signal })
         runInAction(() => {
            this.previews = reply.previews
            this.previewError = null
         })
      } catch (e) {
         if (abort.signal.aborted) return
         runInAction(() => {
            this.previewError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   /** stop the autosave. `flush: false` is the DELETE path: flushing there would write the
    * draft file back milliseconds after the server removed it */
   dispose(p: { flush?: boolean } = {}): void {
      for (const d of this.disposers) d()
      this.disposers = []
      this.previewAbort?.abort()
      if (p.flush === false) return
      // a draft switch inside the debounce window must not lose the edit. Compared against
      // lastQueued, like save() itself: lastSaved lags behind an in-flight write, so a revert
      // made while one is open looked identical to "already written" and was dropped
      if (JSON.stringify(this.valuesJSON()) !== this.lastQueued) void this.save()
   }

   /** tab-close/hide flush. keepalive survives page teardown, so this one does NOT ride
    * saveChain (chaining could delay it past unload). lastSaved is committed only when the
    * server answers: a failed flush must stay dirty so the next save() retries it */
   flushKeepalive(): void {
      const encoded = JSON.stringify(this.valuesJSON())
      // lastQueued, not lastSaved: nothing runs after this one, so a revert made while a PUT
      // was open would be lost for good rather than merely delayed
      if (encoded === this.lastQueued) return
      this.lastQueued = encoded
      void saveDraft(
         { module: this.moduleKey, draft: this.draft, values: JSON.parse(encoded) as Record<string, unknown> },
         { keepalive: true },
      ).then(
         () =>
            runInAction(() => {
               this.lastSaved = encoded
               this.lastQueued = encoded
               this.saveState = 'saved'
            }),
         (e: unknown) =>
            runInAction(() => {
               if (this.lastQueued === encoded) this.lastQueued = this.lastSaved
               this.saveState = 'error'
               this.saveError = e instanceof Error ? e.message : String(e)
            }),
      )
   }

   /** the draft file's `$enhance`: the enhancer's input per prompt (src/cli/draftMeta.ts) */
   intents: Record<string, string> = {}

   intentFor(key: string): string | undefined {
      return this.intents[key]
   }

   /** '' clears it: the input then follows the prompt again */
   setIntent(key: string, text: string): void {
      const next = { ...this.intents }
      if (text === '') delete next[key]
      else next[key] = text
      this.intents = next
   }

   /** what the draft FILE holds: the values, and the intents beside them. Saved together, so an
    * intent is autosaved like any edit */
   valuesJSON(): Record<string, unknown> {
      return withIntents(this.varValues(), this.intents)
   }

   /** the var values alone: what previews compute from and what an embedding page is told.
    * An intent typed in the enhancer changes neither */
   varValues(): Record<string, unknown> {
      return Object.fromEntries(this.vars.map((v) => [v.name, v.value]))
   }

   /** frozen values for a QUEUED run (seeds excluded — payload.ts owns the why) */
   queuePayload(): Record<string, unknown> {
      return payloadSnapshot(this.vars.map((v) => ({ name: v.name, kind: v.desc.kind, value: v.value })))
   }

   /** the keywords the ACTIVE loras will prepend to this prompt, in the ORDER THE RUN USES.
    * that order is the var's option list (LorasVar.activeNames filters `names`), NOT the
    * record's insertion order: walking the record showed the keywords in drag order while the
    * prompt that ran used the enum order, so the preview and the run disagreed the moment you
    * reordered a card. Computed here rather than fetched: it must follow every toggle live */
   /** a var whose `activeWhen` does not hold right now: shown, but disabled. The reason is a
    * sentence the label shows, null when the var is active */
   inactiveReason(v: VarSt): string | null {
      const when = v.desc.ui?.activeWhen
      if (when == null) return null
      for (const [name, allowed] of Object.entries(when)) {
         const other = this.vars.find((x) => x.name === name)
         const current = other?.value
         if (!allowed.some((a) => a === current)) return `only used when ${name} is ${allowed.join(' or ')}`
      }
      return null
   }

   /** the loras var a prompt takes its keywords from, and the record the build reads from it
    * (the plain record, or its active lanes merged) */
   private keywordSource(promptVar: VarSt): { source: VarSt; value: LorasInput; record: LoraRecord } | null {
      const sourceName = promptVar.desc.keywordsFrom
      if (sourceName == null) return null
      const source = this.vars.find((v) => v.name === sourceName)
      if (source == null) return null
      const value = isLorasInput(source.value) ? source.value : {}
      return { source, value, record: flattenLoras(value).record }
   }

   /** one group per lora in the palette that has a keyword: its name, then the keyword split at
    * the commas, each part on or off. A lora the build does not run (paused, or in a lane that
    * is off) keeps its group, marked not running, so switching a lane never shifts the form */
   loraKeywordGroups(
      promptVar: VarSt,
   ): { lora: string; label: string; running: boolean; parts: { text: string; on: boolean }[] }[] {
      const found = this.keywordSource(promptVar)
      if (found == null) return []
      const keywords = found.source.desc.optionKeywords ?? {}
      const labels = found.source.desc.optionLabels ?? {}
      const inPalette = new Map(paletteLoras(found.value).map((l) => [l.name, l]))
      const out: { lora: string; label: string; running: boolean; parts: { text: string; on: boolean }[] }[] = []
      for (const name of found.source.desc.options ?? []) {
         const entry = inPalette.get(name)
         if (entry == null) continue
         const parts = keywordParts(keywords[name] ?? '')
         if (parts.length === 0) continue
         const muted = loraMuted(entry.setting)
         out.push({
            lora: name,
            label: labels[name] ?? name,
            running: entry.running,
            parts: parts.map((text) => ({ text, on: !muted.includes(text) })),
         })
      }
      return out
   }

   /** what the active loras will prepend, as sent: muted parts left out, deduped */
   loraKeywordsFor(promptVar: VarSt): string[] {
      const out: string[] = []
      for (const g of this.loraKeywordGroups(promptVar)) {
         if (!g.running) continue
         const kept = g.parts
            .filter((w) => w.on)
            .map((w) => w.text)
            .join(', ')
         if (kept !== '' && !out.includes(kept)) out.push(kept)
      }
      return out
   }

   /** every keyword part the build will add in front, with the lora it comes from (the editor
    * flags a tag you typed that a lora already adds) */
   injectedTagsFor(promptVar: VarSt): { tag: string; source: string }[] {
      return this.loraKeywordGroups(promptVar)
         .filter((g) => g.running)
         .flatMap((g) => g.parts.filter((w) => w.on).map((w) => ({ tag: w.text, source: g.label })))
   }

   /** the keyword parts of EVERY lora in the list, running or not: the editor completes them */
   loraWordsFor(promptVar: VarSt): { word: string; source: string }[] {
      const sourceName = promptVar.desc.keywordsFrom
      const source = sourceName == null ? null : this.vars.find((v) => v.name === sourceName)
      if (source == null) return []
      const keywords = source.desc.optionKeywords ?? {}
      const labels = source.desc.optionLabels ?? {}
      return Object.entries(keywords).flatMap(([name, kw]) =>
         keywordParts(kw).map((word) => ({ word, source: labels[name] ?? name })),
      )
   }

   /** mute or unmute one part of a lora's keyword, stored on that lora in the draft */
   toggleKeywordPart(promptVar: VarSt, lora: string, part: string): void {
      const found = this.keywordSource(promptVar)
      if (found == null) return
      const muted = loraMuted(loraSetting(found.value, lora))
      this.setKeywordMute(promptVar, lora, muted.includes(part) ? muted.filter((w) => w !== part) : [...muted, part])
   }

   /** the whole list of muted parts at once (the popover's all / none) */
   setKeywordMute(promptVar: VarSt, lora: string, mute: readonly string[]): void {
      const found = this.keywordSource(promptVar)
      if (found == null) return
      found.source.set(updateLora(found.value, lora, withLora(loraSetting(found.value, lora), { mute })))
   }

   get dirtyCount(): number {
      return this.vars.filter((v) => v.dirty).length
   }

   /** persist the draft now. Resolves FALSE on failure — generate() must not run stale inputs */
   save(): Promise<boolean> {
      const encoded = JSON.stringify(this.valuesJSON())
      // already on its way (or landed): ride the chain, so generate() waits for that write
      if (encoded === this.lastQueued) return this.lastSaved === encoded ? Promise.resolve(true) : this.saveChain
      this.lastQueued = encoded
      const seq = ++this.queueSeq
      runInAction(() => {
         this.saveState = 'saving'
      })
      this.saveChain = this.saveChain.then(async () => {
         try {
            await saveDraft({
               module: this.moduleKey,
               draft: this.draft,
               values: JSON.parse(encoded) as Record<string, unknown>,
            })
            runInAction(() => {
               this.lastSaved = encoded
               this.saveState = 'saved'
               this.saveError = null
            })
            return true
         } catch (e) {
            runInAction(() => {
               // by seq, not by value: a newer save carrying the same json must keep its marker
               if (this.queueSeq === seq) this.lastQueued = this.lastSaved
               // a failed chain must not be handed to the next no-op caller as a stale false
               this.saveChain = Promise.resolve(true)
               this.saveState = 'error'
               this.saveError = e instanceof Error ? e.message : String(e)
            })
            return false
         }
      })
      return this.saveChain
   }

   revertAll(): void {
      for (const v of this.vars) v.revert()
   }
}

function withIntents(values: Record<string, unknown>, intents: Record<string, string>): Record<string, unknown> {
   return Object.keys(intents).length === 0 ? values : { ...values, [ENHANCE_KEY]: intents }
}
