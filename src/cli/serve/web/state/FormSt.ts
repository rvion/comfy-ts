// form state for ONE module+draft selection — swapped whole on WebSt when the
// selection changes (observableRef there), per app-state-tree doctrine
import { makeAutoObservable, observableRef } from 'mobx'
import type { ModuleDescription } from 'src/cli/serve/web/api.ts'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { buildPayload, normalizeInitial, type FormEntrySnapshot } from 'src/cli/serve/web/state/payload.ts'

/** one var row: value in payload shape, replaced whole on every edit */
export class VarSt {
   value: unknown
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

   snapshot(): FormEntrySnapshot {
      return { name: this.name, desc: this.desc, value: this.value, dirty: this.dirty }
   }
}

export class FormSt {
   vars: VarSt[]

   constructor(
      public readonly moduleKey: string,
      public readonly draft: string,
      mod: ModuleDescription,
      values: Record<string, unknown>,
   ) {
      this.vars = Object.entries(mod.vars).map(
         ([name, desc]) => new VarSt(name, desc, normalizeInitial(desc, values[name])),
      )
      makeAutoObservable(this, { vars: false, moduleKey: false, draft: false })
   }

   get dirtyCount(): number {
      return this.vars.filter((v) => v.dirty).length
   }

   payload(): Record<string, unknown> {
      return buildPayload(this.vars.map((v) => v.snapshot()))
   }

   revertAll(): void {
      for (const v of this.vars) v.revert()
   }
}
