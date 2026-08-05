// form state for ONE module+draft selection — swapped whole on WebSt when the
// selection changes (observableRef there, dispose() first: the autosave
// reaction is owned here). DRAFTS ARE LIVE (the TUI model): edits autosave
// through PUT /drafts, generate posts {} — the draft is the one source of truth
import { makeAutoObservable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx'
import { saveDraft, type ModuleDescription } from 'src/cli/serve/web/api.ts'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { normalizeInitial } from 'src/cli/serve/web/state/payload.ts'

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
   /** the values json the server last confirmed — save() no-ops when nothing changed */
   private lastSaved: string

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
      this.lastSaved = JSON.stringify(this.valuesJSON())
      makeAutoObservable<FormSt, 'disposers' | 'saveChain' | 'lastSaved'>(this, {
         vars: false,
         moduleKey: false,
         draft: false,
         host: false,
         disposers: false,
         saveChain: false,
         lastSaved: false,
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

   dispose(): void {
      for (const d of this.disposers) d()
      this.disposers = []
      // a draft switch inside the debounce window must not lose the edit
      if (JSON.stringify(this.valuesJSON()) !== this.lastSaved) void this.save()
   }

   /** tab-close/hide flush: keepalive survives page teardown, fire-and-forget by nature */
   flushKeepalive(): void {
      const encoded = JSON.stringify(this.valuesJSON())
      if (encoded === this.lastSaved) return
      this.lastSaved = encoded
      void saveDraft(
         { module: this.moduleKey, draft: this.draft, values: JSON.parse(encoded) as Record<string, unknown> },
         { keepalive: true },
      ).catch(() => {})
   }

   valuesJSON(): Record<string, unknown> {
      return Object.fromEntries(this.vars.map((v) => [v.name, v.value]))
   }

   get dirtyCount(): number {
      return this.vars.filter((v) => v.dirty).length
   }

   /** persist the draft now. Resolves FALSE on failure — generate() must not run stale inputs */
   save(): Promise<boolean> {
      const encoded = JSON.stringify(this.valuesJSON())
      if (encoded === this.lastSaved) return this.saveChain
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
