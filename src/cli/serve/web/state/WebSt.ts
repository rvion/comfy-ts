// ROOT state tree of the serve web ui (app-state-tree doctrine: one root,
// child stores hang off it, components read and call)
import { makeAutoObservable, observableRef, observableShallow, runInAction } from 'mobx'
import { fetchDraftValues, fetchIndex, saveDraft, type ModuleDescription } from 'src/cli/serve/web/api.ts'
import { FormSt } from 'src/cli/serve/web/state/FormSt.ts'
import { RunSt } from 'src/cli/serve/web/state/RunSt.ts'

/** selection + drawer survive a reload (his standing default: hand-tuned state persists and restores) */
const STORAGE_KEY = 'comfy-ts-serve-ui'

type StoredSelection = { module?: string; draft?: string; sidebar?: boolean }

function readStoredSelection(): StoredSelection {
   try {
      return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {}) as StoredSelection
   } catch {
      return {}
   }
}

function isNarrowScreen(): boolean {
   return window.matchMedia('(max-width: 800px)').matches
}

export class WebSt {
   phase: 'loading' | 'error' | 'ready' = 'loading'
   bootError = ''
   modules: ModuleDescription[] = []
   loadErrors: Record<string, string> = {}
   form: FormSt | null = null
   formLoading = false
   formError: string | null = null
   /** drawer on narrow screens, collapsible column on wide ones — stored toggle wins over the width default */
   sidebarOpen: boolean
   run: RunSt

   constructor() {
      this.run = new RunSt()
      this.sidebarOpen = readStoredSelection().sidebar ?? !isNarrowScreen()
      makeAutoObservable(this, { run: false, form: observableRef, modules: observableShallow })
      void this.boot()
   }

   toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen
      this.persist()
   }

   private persist(): void {
      try {
         localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
               module: this.form?.moduleKey,
               draft: this.form?.draft,
               sidebar: this.sidebarOpen,
            }),
         )
      } catch {
         // storage full/blocked: state just won't survive the reload
      }
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

   /** latest-wins guard for rapid draft clicks: only the newest select may write form state */
   private selectToken = 0

   async select(p: { module: string; draft: string }): Promise<void> {
      const mod = this.moduleByKey(p.module)
      if (mod == null) return
      const token = ++this.selectToken
      runInAction(() => {
         this.formLoading = true
         this.formError = null
         // picking a draft is the drawer's exit on a phone
         if (isNarrowScreen()) this.sidebarOpen = false
      })
      try {
         const reply = await fetchDraftValues(p)
         runInAction(() => {
            if (token !== this.selectToken) return
            this.form?.dispose()
            this.form = new FormSt(p.module, p.draft, mod, reply.values ?? {})
            this.persist()
         })
      } catch (e) {
         runInAction(() => {
            if (token !== this.selectToken) return
            this.formError = e instanceof Error ? e.message : String(e)
         })
      } finally {
         runInAction(() => {
            if (token === this.selectToken) this.formLoading = false
         })
      }
   }

   generate(): void {
      void this.generateNow()
   }

   /** flush the autosave first: the server reads the draft it just wrote — one source of truth */
   private async generateNow(): Promise<void> {
      const form = this.form
      if (form == null || this.run.isRunning) return
      await form.save()
      await this.run.generate({ module: form.moduleKey, draft: form.draft, payload: {} })
   }

   /** duplicate = save the current values under a new name, then switch to it */
   async duplicateDraft(rawName: string): Promise<void> {
      const form = this.form
      const name = rawName.trim()
      if (form == null || name === '') return
      try {
         const reply = await saveDraft({ module: form.moduleKey, draft: name, values: form.valuesJSON() })
         runInAction(() => {
            this.modules = this.modules.map((m) => (m.module === form.moduleKey ? { ...m, drafts: reply.drafts } : m))
         })
         await this.select({ module: form.moduleKey, draft: name })
      } catch (e) {
         runInAction(() => {
            this.formError = e instanceof Error ? e.message : String(e)
         })
      }
   }
}
