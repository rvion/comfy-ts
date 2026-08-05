// ROOT state tree of the serve web ui (app-state-tree doctrine: one root,
// child stores hang off it, components read and call)
import { makeAutoObservable, observableRef, observableShallow, runInAction } from 'mobx'
import { fetchDraftValues, fetchIndex, type ModuleDescription } from 'src/cli/serve/web/api.ts'
import { FormSt } from 'src/cli/serve/web/state/FormSt.ts'
import { RunSt } from 'src/cli/serve/web/state/RunSt.ts'

/** selection survives a reload (his standing default: hand-tuned state persists and restores) */
const STORAGE_KEY = 'comfy-ts-serve-ui'

type StoredSelection = { module?: string; draft?: string }

function readStoredSelection(): StoredSelection {
   try {
      return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {}) as StoredSelection
   } catch {
      return {}
   }
}

export class WebSt {
   phase: 'loading' | 'error' | 'ready' = 'loading'
   bootError = ''
   modules: ModuleDescription[] = []
   loadErrors: Record<string, string> = {}
   form: FormSt | null = null
   formLoading = false
   formError: string | null = null
   run: RunSt

   constructor() {
      this.run = new RunSt()
      makeAutoObservable(this, { run: false, form: observableRef, modules: observableShallow })
      void this.boot()
   }

   moduleByKey(key: string): ModuleDescription | null {
      return this.modules.find((m) => m.module === key) ?? null
   }

   async boot(): Promise<void> {
      try {
         const index = await fetchIndex()
         runInAction(() => {
            this.modules = index.workflows
            this.loadErrors = index.loadErrors ?? {}
            this.phase = 'ready'
         })
         const stored = readStoredSelection()
         const mod = (stored.module != null ? this.moduleByKey(stored.module) : null) ?? this.modules[0]
         if (mod == null) return
         const draft = stored.draft != null && mod.drafts.includes(stored.draft) ? stored.draft : 'default'
         await this.select({ module: mod.module, draft })
      } catch (e) {
         runInAction(() => {
            this.phase = 'error'
            this.bootError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   async select(p: { module: string; draft: string }): Promise<void> {
      const mod = this.moduleByKey(p.module)
      if (mod == null) return
      runInAction(() => {
         this.formLoading = true
         this.formError = null
      })
      try {
         localStorage.setItem(STORAGE_KEY, JSON.stringify({ module: p.module, draft: p.draft }))
      } catch {
         // storage full/blocked: selection just won't survive the reload
      }
      try {
         const reply = await fetchDraftValues(p)
         runInAction(() => {
            this.form = new FormSt(p.module, p.draft, mod, reply.values ?? {})
         })
      } catch (e) {
         runInAction(() => {
            this.formError = e instanceof Error ? e.message : String(e)
         })
      } finally {
         runInAction(() => {
            this.formLoading = false
         })
      }
   }

   generate(): void {
      const form = this.form
      if (form == null) return
      void this.run.generate({ module: form.moduleKey, draft: form.draft, payload: form.payload() })
   }
}
