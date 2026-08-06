// ROOT state tree of the serve web ui (app-state-tree doctrine: one root,
// child stores hang off it, components read and call)
import { makeAutoObservable, observableRef, observableShallow, runInAction } from 'mobx'
import {
   deleteDraft,
   fetchDraftValues,
   fetchHostLogs,
   fetchHosts,
   fetchIndex,
   fetchSettings,
   postHostAction,
   saveDraft,
   saveSettings,
   setModuleHost,
   type HostAction,
   type HostsPayload,
   type ModuleDescription,
   type ServeSettings,
} from 'src/cli/serve/web/api.ts'
import { EnhancerSt } from 'src/cli/serve/web/state/EnhancerSt.ts'
import { FormSt } from 'src/cli/serve/web/state/FormSt.ts'
import { RunSt } from 'src/cli/serve/web/state/RunSt.ts'

/** selection + drawer survive a reload (his standing default: hand-tuned state persists and restores) */
const STORAGE_KEY = 'comfy-ts-serve-ui'

/** where the results live. 'auto' keeps the width rule (side ≥1100px, bottom under it);
 * 'pinned' floats the newest image over the bottom of the screen, so a phone shows the
 * knobs and what they produced without scrolling between them */
export type ResultsLayout = 'auto' | 'off' | 'bottom' | 'side' | 'pinned'

/** icon names live in Icon.tsx; this list stays a plain description of the modes */
export const LAYOUTS: {
   id: ResultsLayout
   icon: 'panel-off' | 'panel-bottom' | 'panel-side' | 'pin'
   title: string
}[] = [
   { id: 'off', icon: 'panel-off', title: 'no preview: the form only' },
   { id: 'bottom', icon: 'panel-bottom', title: 'results below the form' },
   { id: 'side', icon: 'panel-side', title: 'results beside the form' },
   { id: 'pinned', icon: 'pin', title: 'newest image pinned over the bottom, form scrolls under it' },
]

function isLayout(raw: unknown): raw is ResultsLayout {
   return raw === 'auto' || raw === 'off' || raw === 'bottom' || raw === 'side' || raw === 'pinned'
}

type StoredSelection = {
   module?: string
   draft?: string
   sidebar?: boolean
   loraImages?: boolean
   loraTitles?: boolean
   layout?: string
   latent?: boolean
   logs?: boolean
}

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
   /** lora image/title visibility, EVERY lora surface (row cards + popup) — the hide toggles are NSFW screens */
   showLoraImages: boolean
   showLoraTitles: boolean
   run: RunSt
   /** prompt refiner: own store, own localStorage blob (the openrouter key never leaves the browser) */
   enhancer: EnhancerSt
   /** SERVER settings, not browser ones: they decide whether a generation writes files at all
    * and where, so they are shared by every client and read back from GET /settings */
   settings: ServeSettings = { saveToDisk: true, hostOverride: {}, savePrefix: {}, effectivePrefix: {} }
   savingError: string | null = null
   /** what you are typing in a prefix field, before the debounced write lands */
   private prefixEdits: Record<string, string> = {}
   private prefixTimers = new Map<string, ReturnType<typeof setTimeout>>()

   get saveToDisk(): boolean {
      return this.settings.saveToDisk
   }
   /** where the results go — hand-tuned, so it persists and restores */
   layout: ResultsLayout
   /** hosts this process knows + where each module runs (server-owned, like the drafts) */
   hosts: HostsPayload = { hosts: [], defaults: {}, overrides: {} }
   hostError: string | null = null

   constructor() {
      this.run = new RunSt()
      this.enhancer = new EnhancerSt()
      const stored = readStoredSelection()
      this.layout = isLayout(stored.layout) ? stored.layout : 'auto'
      this.sidebarOpen = stored.sidebar ?? !isNarrowScreen()
      this.showLoraImages = stored.loraImages ?? true
      this.showLoraTitles = stored.loraTitles ?? true
      this.showLatent = stored.latent ?? true
      // logs start CLOSED whatever was stored: a panel that polls must be asked for
      this.showLogs = false
      makeAutoObservable(this, { run: false, enhancer: false, form: observableRef, modules: observableShallow })
      // a closing/hidden tab must not lose an edit still inside the autosave debounce
      window.addEventListener('beforeunload', () => this.form?.flushKeepalive())
      document.addEventListener('visibilitychange', () => {
         if (document.visibilityState === 'hidden') this.form?.flushKeepalive()
      })
      void this.boot()
   }

   toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen
      this.persist()
   }

   toggleLoraImages(): void {
      this.showLoraImages = !this.showLoraImages
      this.persist()
   }

   toggleLoraTitles(): void {
      this.showLoraTitles = !this.showLoraTitles
      this.persist()
   }

   private persist(): void {
      try {
         // merge, never rebuild: toggling the sidebar before a draft loads must not
         // erase the stored selection (this.form is null then)
         const stored = readStoredSelection()
         localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
               ...stored,
               ...(this.form != null ? { module: this.form.moduleKey, draft: this.form.draft } : {}),
               sidebar: this.sidebarOpen,
               loraImages: this.showLoraImages,
               loraTitles: this.showLoraTitles,
               layout: this.layout,
               latent: this.showLatent,
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
         void this.loadSettings()
         void this.loadHosts()
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
      // re-picking the draft you are IN is a no-op, not a reload: a pending autosave would
      // lose the race against the fetch and the typed edit would vanish from the form
      if (this.form?.moduleKey === p.module && this.form.draft === p.draft) {
         runInAction(() => {
            if (isNarrowScreen()) this.sidebarOpen = false
         })
         return
      }
      const token = ++this.selectToken
      runInAction(() => {
         // the refiner points at a var of the OUTGOING form: applying it after the swap
         // would write into a discarded object, so the modal closes with its form
         this.enhancer.close()
         this.formLoading = true
         this.formError = null
         // picking a draft is the drawer's exit on a phone
         if (isNarrowScreen()) this.sidebarOpen = false
      })
      // flush the outgoing form BEFORE reading the next one, so a switch never races its own save
      const outgoing = this.form
      if (outgoing != null) {
         outgoing.dispose()
         await outgoing.save()
      }
      try {
         const reply = await fetchDraftValues(p)
         runInAction(() => {
            if (token !== this.selectToken) return
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

   /** side and pinned show the results next to (or over) the form, so the run button belongs
    * there: in pinned it stays on screen while the form scrolls */
   get generateInResults(): boolean {
      return this.layout === 'side' || this.layout === 'pinned'
   }

   setLayout(next: ResultsLayout): void {
      // clicking the mode you are in returns to the width rule, so 'auto' stays reachable
      this.layout = this.layout === next ? 'auto' : next
      this.persist()
   }

   /** the host a module's runs go to right now (override if any, else the module's own) */
   hostFor(moduleKey: string): string {
      return this.hosts.overrides[moduleKey] ?? this.hosts.defaults[moduleKey] ?? ''
   }

   isHostOverridden(moduleKey: string): boolean {
      return this.hosts.overrides[moduleKey] != null
   }

   private async loadHosts(): Promise<void> {
      try {
         const hosts = await fetchHosts()
         runInAction(() => {
            this.hosts = hosts
         })
      } catch {
         // an older server has no /hosts route: the header just shows the module's own host
      }
   }

   /** the ComfyUI console, polled only while the logs panel is open (off by default: most of
    * the time you do not care, and a closed panel must cost nothing) */
   showLogs = false
   logLines: string[] = []
   logsError: string | null = null
   hostNote: string | null = null
   /** the latent frames during a run: on by default, off when you only want the final image */
   showLatent = true
   private logsTimer: ReturnType<typeof setInterval> | null = null

   toggleLatent(): void {
      this.showLatent = !this.showLatent
      this.persist()
   }

   toggleLogs(): void {
      this.showLogs = !this.showLogs
      this.persist()
      if (this.logsTimer != null) clearInterval(this.logsTimer)
      this.logsTimer = null
      if (!this.showLogs) return
      void this.pullLogs()
      this.logsTimer = setInterval(() => void this.pullLogs(), 3000)
   }

   private async pullLogs(): Promise<void> {
      const host = this.form == null ? null : this.hostFor(this.form.moduleKey)
      if (host == null || host === '') return
      try {
         const reply = await fetchHostLogs({ host })
         runInAction(() => {
            this.logLines = reply.entries.map((e) => e.m.replace(/\n+$/, ''))
            this.logsError = null
         })
      } catch (e) {
         runInAction(() => {
            this.logsError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   /** interrupt / clear the queue / reboot the box this workflow runs on */
   async hostAction(action: HostAction): Promise<void> {
      const host = this.form == null ? null : this.hostFor(this.form.moduleKey)
      if (host == null || host === '') return
      runInAction(() => {
         this.hostError = null
         this.hostNote = null
      })
      try {
         const reply = await postHostAction({ host, action })
         runInAction(() => {
            this.hostNote = reply.note
         })
      } catch (e) {
         runInAction(() => {
            this.hostError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   /** run this workflow somewhere else (the TUI's host override). null resets to its own host */
   async setModuleHost(p: { module: string; host: string | null }): Promise<void> {
      runInAction(() => {
         this.hostError = null
      })
      try {
         const reply = await setModuleHost(p)
         runInAction(() => {
            this.hosts = { ...this.hosts, overrides: reply.overrides }
         })
      } catch (e) {
         runInAction(() => {
            this.hostError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   private async loadSettings(): Promise<void> {
      try {
         const s = await fetchSettings()
         runInAction(() => {
            this.settings = s
         })
      } catch {
         // an older server has no /settings route: it always saves, which is what the default says
      }
   }

   /** what the prefix input shows: the typed value while editing, else the effective folder */
   savePrefixDraft(moduleKey: string): string {
      return this.prefixEdits[moduleKey] ?? this.settings.savePrefix[moduleKey] ?? ''
   }

   /** typing is local and instant; the write is debounced, the live-drafts idiom. An invalid
    * folder is rejected by the server and shown, the field keeps what you typed */
   setSavePrefix(moduleKey: string, value: string): void {
      this.prefixEdits[moduleKey] = value
      this.savingError = null
      const timer = this.prefixTimers.get(moduleKey)
      if (timer != null) clearTimeout(timer)
      this.prefixTimers.set(
         moduleKey,
         setTimeout(() => {
            void this.pushSettings({ savePrefix: { [moduleKey]: value } })
         }, 500),
      )
   }

   private async pushSettings(patch: { saveToDisk?: boolean; savePrefix?: Record<string, string> }): Promise<boolean> {
      try {
         const next = await saveSettings(patch)
         runInAction(() => {
            this.settings = next
            this.savingError = null
         })
         return true
      } catch (e) {
         runInAction(() => {
            this.savingError = e instanceof Error ? e.message : String(e)
         })
         return false
      }
   }

   /** flip where outputs go. Optimistic, then reconciled with what the server confirms */
   async toggleSaveToDisk(): Promise<void> {
      const next = !this.saveToDisk
      const before = this.settings
      runInAction(() => {
         this.settings = { ...this.settings, saveToDisk: next }
         this.savingError = null
      })
      // pushSettings reports the failure; roll the optimistic flip back so the switch
      // never shows a state the server refused
      if (!(await this.pushSettings({ saveToDisk: next })))
         runInAction(() => {
            this.settings = before
         })
   }

   generate(): void {
      void this.generateNow()
   }

   /** flush the autosave first: the server reads the draft it just wrote — one source of truth.
    * Every click ENQUEUES, so hitting generate n times runs n prompts; the queued payload
    * freezes the values you saw, and seeds stay on the draft's server-side policy */
   private async generateNow(): Promise<void> {
      const form = this.form
      if (form == null) return
      const payload = form.queuePayload()
      const saved = await form.save()
      // the header already shows the loud save error; running the stale draft would lie
      if (!saved) return
      this.run.enqueue({ module: form.moduleKey, draft: form.draft, payload })
   }

   /** rename = write the values under the new name, switch to it, then drop the old FILE.
    * Same shape as the enhancer presets: the name IS the identity, so there is nothing to
    * "rename" server side. The old file is only removed once the new one is confirmed */
   async renameDraft(rawName: string): Promise<void> {
      const form = this.form
      const name = rawName.trim()
      if (form == null || name === '' || name === form.draft) return
      const from = form.draft
      await this.duplicateDraft(name)
      // duplicateDraft reports its own failure; only drop the old file if the switch happened
      if (this.form?.draft !== name) return
      await deleteDraft({ module: form.moduleKey, draft: from }).then(
         (reply) =>
            runInAction(() => {
               this.modules = this.modules.map((m) =>
                  m.module === form.moduleKey ? { ...m, drafts: reply.drafts } : m,
               )
            }),
         (e: unknown) =>
            runInAction(() => {
               this.formError = `renamed to '${name}', but the old draft '${from}' could not be removed: ${
                  e instanceof Error ? e.message : String(e)
               }`
            }),
      )
   }

   /** delete the draft FILE, then fall back to another draft (DraftsSt.deleteDraft's rule).
    * ORDER: the form is dropped WITHOUT flushing FIRST — its autosave would otherwise
    * re-create the file the server is about to delete */
   async deleteDraft(p: { module: string; draft: string }): Promise<void> {
      const form = this.form
      if (form != null && form.moduleKey === p.module && form.draft === p.draft) {
         form.dispose({ flush: false })
         runInAction(() => {
            this.form = null
         })
      }
      try {
         const reply = await deleteDraft(p)
         runInAction(() => {
            this.modules = this.modules.map((m) => (m.module === p.module ? { ...m, drafts: reply.drafts } : m))
         })
         const fallback = reply.drafts.includes('default') ? 'default' : (reply.drafts[0] ?? 'default')
         await this.select({ module: p.module, draft: fallback })
      } catch (e) {
         runInAction(() => {
            this.formError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   /** duplicate = save the current values under a new name, then switch to it */
   async duplicateDraft(rawName: string): Promise<void> {
      const form = this.form
      const name = rawName.trim()
      if (form == null || name === '') return
      const existing = this.moduleByKey(form.moduleKey)?.drafts.includes(name) === true
      if (existing && !window.confirm(`draft '${name}' already exists — overwrite it?`)) return
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
