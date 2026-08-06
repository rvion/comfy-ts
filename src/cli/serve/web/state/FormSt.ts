// form state for ONE module+draft selection — swapped whole on WebSt when the
// selection changes (observableRef there, dispose() first: the autosave
// reaction is owned here). DRAFTS ARE LIVE (the TUI model): edits autosave
// through PUT /drafts, generate posts {} — the draft is the one source of truth
import { makeAutoObservable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx'
import { saveDraft, type ModuleDescription } from 'src/cli/serve/web/api.ts'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { normalizeInitial, payloadSnapshot } from 'src/cli/serve/web/state/payload.ts'

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
      public readonly initial: unknown,
   ) {
      this.value = initial
      makeAutoObservable(this, { value: observableRef, name: false, desc: false, initial: false })
   }

   set(value: unknown): void {
      this.value = value
      this.dirty = true
   }

   setUploadedUrl(url: string | null): void {
      this.uploadedUrl = url
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

   constructor(
      public readonly moduleKey: string,
      public readonly draft: string,
      mod: ModuleDescription,
      values: Record<string, unknown>,
   ) {
      this.host = mod.host
      this.vars = Object.entries(mod.vars).map(
         ([name, desc]) => new VarSt(name, desc, normalizeInitial(desc, values[name])),
      )
      // seeded from the RAW reply, not the normalized values: when normalizeInitial heals
      // something (a stale lora key), the form is already out of sync with the file and the
      // next save() must actually send — otherwise the server keeps building the stale record
      this.lastSaved = JSON.stringify(Object.fromEntries(this.vars.map((v) => [v.name, values[v.name]])))
      this.lastQueued = this.lastSaved
      makeAutoObservable<FormSt, 'disposers' | 'saveChain' | 'lastSaved' | 'lastQueued'>(this, {
         vars: false,
         moduleKey: false,
         draft: false,
         host: false,
         disposers: false,
         saveChain: false,
         lastSaved: false,
         lastQueued: false,
      })
      // the persistence idiom: the values json is change-detector AND payload
      this.disposers.push(
         reaction(
            () => JSON.stringify(this.valuesJSON()),
            () => void this.save(),
            { delay: 500 },
         ),
      )
   }

   /** stop the autosave. `flush: false` is the DELETE path: flushing there would write the
    * draft file back milliseconds after the server removed it */
   dispose(p: { flush?: boolean } = {}): void {
      for (const d of this.disposers) d()
      this.disposers = []
      if (p.flush === false) return
      // a draft switch inside the debounce window must not lose the edit
      if (JSON.stringify(this.valuesJSON()) !== this.lastSaved) void this.save()
   }

   /** tab-close/hide flush. keepalive survives page teardown, so this one does NOT ride
    * saveChain (chaining could delay it past unload). lastSaved is committed only when the
    * server answers: a failed flush must stay dirty so the next save() retries it */
   flushKeepalive(): void {
      const encoded = JSON.stringify(this.valuesJSON())
      if (encoded === this.lastSaved) return
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
               this.saveState = 'error'
               this.saveError = e instanceof Error ? e.message : String(e)
            }),
      )
   }

   valuesJSON(): Record<string, unknown> {
      return Object.fromEntries(this.vars.map((v) => [v.name, v.value]))
   }

   /** frozen values for a QUEUED run (seeds excluded — payload.ts owns the why) */
   queuePayload(): Record<string, unknown> {
      return payloadSnapshot(this.vars.map((v) => ({ name: v.name, kind: v.desc.kind, value: v.value })))
   }

   /** the keywords the ACTIVE loras will prepend to this prompt, in the order the loras sit in
    * the record. Computed here rather than fetched: it must follow every toggle live, and the
    * descriptor already carries both halves (which loras var feeds it, and each one's keyword) */
   loraKeywordsFor(promptVar: VarSt): string[] {
      const sourceName = promptVar.desc.keywordsFrom
      if (sourceName == null) return []
      const source = this.vars.find((v) => v.name === sourceName)
      if (source == null) return []
      const keywords = source.desc.optionKeywords ?? {}
      const record = source.value != null && typeof source.value === 'object' ? source.value : {}
      const out: string[] = []
      for (const [name, st] of Object.entries(record as Record<string, unknown>)) {
         // same rule as the graph: only loras that are ON contribute
         if (st == null || st === false) continue
         const kw = keywords[name]
         if (kw != null && kw !== '' && !out.includes(kw)) out.push(kw)
      }
      return out
   }

   get dirtyCount(): number {
      return this.vars.filter((v) => v.dirty).length
   }

   /** persist the draft now. Resolves FALSE on failure — generate() must not run stale inputs */
   save(): Promise<boolean> {
      const encoded = JSON.stringify(this.valuesJSON())
      if (encoded === this.lastQueued) {
         // already on its way (or landed): riding the chain resolves when that write does, so
         // generate() cannot run ahead of it. A FAILED write rolls lastQueued back, so this
         // branch never hands back a stale false
         return this.saveChain
      }
      this.lastQueued = encoded
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
               // roll back: this content is NOT on its way any more, the next save must re-send
               this.lastQueued = this.lastSaved
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
