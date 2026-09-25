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
   fetchTabs,
   pingHost,
   postHostAction,
   postLoraCivitai,
   fetchHostDrift,
   saveDraft,
   saveSettings,
   saveTabs,
   setModuleHost,
   type HostAction,
   type HostsPayload,
   type ModuleDescription,
   type PathLabel,
   type ServeSettings,
} from 'src/cli/serve/web/api.ts'
import { EnhancerSt } from 'src/cli/serve/web/state/EnhancerSt.ts'
import { OmniboxSt } from 'src/cli/serve/web/state/OmniboxSt.ts'
import { duplicateDraftName, freeDraftName } from 'src/cli/serve/web/state/draftNames.ts'
import { asLatentMode, type LatentMode } from 'src/cli/serve/web/state/latentMode.ts'
import { pushHistory, type HistoryEntry } from 'src/cli/serve/web/state/history.ts'
import { isPromptInput, promptLanesToText, type PromptInput } from 'src/vars/lanes.ts'
import { FORM_TIMING, FormSt, type FormTiming, type VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { closeTab, openTab, readTabs, renameTab, type DraftTab } from 'src/cli/serve/web/state/draftTabs.ts'
import { logWebError } from 'src/cli/serve/web/logWeb.ts'
import { asSeedForm } from 'src/cli/serve/web/state/payload.ts'
import { readUrlSelection, resolveSelection, writeUrlSelection } from 'src/cli/serve/web/state/urlSelection.ts'
import { RunSt } from 'src/cli/serve/web/state/RunSt.ts'
import { DEFAULT_MEMORY_BUDGET_MB } from 'src/cli/serve/resultHistory.ts'
import { asLoraSort, type LoraSort } from 'src/cli/serve/web/state/loraSort.ts'
import {
   coerceHostValue,
   isEmbedded,
   parseFromHost,
   pickPromptVar,
   postTarget,
   readUrlPrompt,
   resolveHostSelection,
   safeStringify,
} from 'src/cli/serve/web/state/host.ts'
import type { HostToPanel, PanelHostAction, PanelRequest, PanelToHost } from 'src/cli/serve/hostProtocol.ts'

/** selection + drawer survive a reload: hand-tuned state persists and restores */
const STORAGE_KEY = 'comfy-ts-serve-ui'

/** where the results live. every value is one of the buttons: a width rule would put the panel
 * in a placement no button can show as selected, and a mode you cannot point at is not a mode.
 * 'pinned' floats the newest image over the bottom, so a phone shows the knobs and what they
 * produced without scrolling between them */
export type ResultsLayout = 'off' | 'bottom' | 'left' | 'side' | 'pinned'

/** results on the RIGHT: the wide-screen shape, and the one a first visit opens in */
export const DEFAULT_LAYOUT: ResultsLayout = 'side'

/** icon names live in Icon.tsx; this list stays a plain description of the modes */
export const LAYOUTS: {
   id: ResultsLayout
   icon: 'panel-off' | 'panel-bottom' | 'panel-left' | 'panel-side' | 'panel-corner'
   /** the word under the icon, where the results go */
   label: string
   title: string
}[] = [
   { id: 'off', icon: 'panel-off', label: 'none', title: 'no preview: the form only' },
   { id: 'bottom', icon: 'panel-bottom', label: 'below', title: 'results below the form' },
   { id: 'left', icon: 'panel-left', label: 'left', title: 'results left of the form' },
   { id: 'side', icon: 'panel-side', label: 'right', title: 'results right of the form' },
   {
      id: 'pinned',
      icon: 'panel-corner',
      label: 'corner',
      title: 'newest image in the bottom right corner, form scrolls under it',
   },
]

function isLayout(raw: unknown): raw is ResultsLayout {
   return raw === 'off' || raw === 'bottom' || raw === 'left' || raw === 'side' || raw === 'pinned'
}

type StoredSelection = {
   module?: string
   draft?: string
   loraImages?: boolean
   loraTitles?: boolean
   /** lora previews fill their card (cover) instead of fitting inside it (contain) */
   loraFill?: boolean
   /** trigger words under the lora cards */
   loraTriggers?: boolean
   /** the single lora image size, before the form and the popup got one each: seeds both */
   loraScale?: number
   /** lora image size factor in the form's lora rows */
   loraFormScale?: number
   /** lora image size factor in the lora popup */
   loraPopupScale?: number
   /** the label column width, px */
   labelWidth?: number
   loraSort?: string
   /** how many lora cards the popup draws before it stops */
   loraCap?: number
   /** the one-shot 60 → 200 default bump already happened for this browser */
   loraCapMigrated?: boolean
   layout?: string
   /** a LatentMode; a boolean in blobs written before the corner mode */
   latent?: boolean | string
   /** results blurred until hovered */
   blur?: boolean
   /** fit = one per row at the panel's width, grid = the slider's size, wrapping */
   /** the fit/grid pair before columns: read once to seed resultsColumns */
   resultsView?: string
   resultsSize?: number
   /** how many results side by side in the preview, 1 = each as wide as the panel */
   resultsColumns?: number
   /** live previews opened to their full text, as `module/name` */
   expandedPreviews?: string[]
   logs?: boolean
   /** module key → the var names in the order you dragged them into */
   varOrder?: Record<string, string[]>
   /** starred size presets per `module/var`, once you star or unstar one yourself */
   sizeStars?: Record<string, string[]>
}

/** varOrder is the one stored field a reader INDEXES rather than merely reads, so a blob of
 * the wrong shape (hand-edited, or written by an older version) crashed the whole panel to a
 * blank page inside render. Every entry is shape-checked here, once */
export const DEFAULT_LORA_CAP = 200
/** the previous default, persisted whether or not anyone chose it: a stored 60 cannot be told
 * apart from a deliberate one, so it is read as unset once (see loraCapMigrated) */
const LEGACY_LORA_CAP = 60
/** an upper bound, not a policy: 2000 cards is 2000 image requests, and a number typed by
 * hand (or restored from an older blob) must not be able to hang the page */
/** lora images from a little smaller to twice the base size: the right size depends on the
 * collection (art crops well small, a character sheet needs room) and on the screen */
export function clampLoraScale(raw: unknown): number {
   const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1
   return Math.min(2, Math.max(0.6, Math.round(n * 20) / 20))
}

/** the form and the popup each keep their own size: the popup is for browsing, so it is
 * usually drawn bigger than the rows under a var */
export function readLoraScales(stored: StoredSelection): { form: number; popup: number } {
   return {
      form: clampLoraScale(stored.loraFormScale ?? stored.loraScale),
      popup: clampLoraScale(stored.loraPopupScale ?? stored.loraScale),
   }
}

/** results side by side: one full width image at 1, a thumbnail wall at the top */
export function clampResultsColumns(raw: unknown): number {
   const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 1
   return Math.min(8, Math.max(1, n))
}

/** a blob written before columns keeps its look: fit was one per row, grid about three */
export function readResultsColumns(stored: StoredSelection): number {
   if (stored.resultsColumns != null) return clampResultsColumns(stored.resultsColumns)
   return stored.resultsView === 'grid' ? 3 : 1
}

export const DEFAULT_LABEL_WIDTH = 120

export function clampLabelWidth(raw: unknown): number {
   const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : DEFAULT_LABEL_WIDTH
   return Math.min(360, Math.max(60, n))
}

export function clampLoraCap(raw: unknown): number {
   const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_LORA_CAP
   return Math.min(2000, Math.max(1, n))
}

function readVarOrder(raw: unknown): Record<string, string[]> {
   if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
   const out: Record<string, string[]> = {}
   for (const [k, v] of Object.entries(raw as Record<string, unknown>))
      if (Array.isArray(v)) out[k] = v.filter((n): n is string => typeof n === 'string')
   return out
}

function readStoredSelection(): StoredSelection {
   try {
      const raw = (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {}) as StoredSelection
      return { ...raw, varOrder: readVarOrder(raw.varOrder), sizeStars: readVarOrder(raw.sizeStars) }
   } catch {
      return {}
   }
}

export class WebSt {
   phase: 'loading' | 'error' | 'ready' = 'loading'
   bootError = ''
   modules: ModuleDescription[] = []
   loadErrors: Record<string, string> = {}
   /** the menu's read-only cards: where `.comfy-ts/` lives, and the folder serve scanned */
   workspace: PathLabel | null = null
   root: PathLabel | null = null
   /** the phone drawer (the menu column at 760px and below) */
   menuOpen = false
   form: FormSt | null = null
   formLoading = false
   formError: string | null = null
   /** lora image/title visibility, EVERY lora surface (row cards + popup) — the hide toggles are NSFW screens */
   showLoraImages: boolean
   showLoraTitles: boolean
   /** cover vs contain for every lora preview: art crops well, a character sheet does not */
   loraFill: boolean
   /** trigger words under each lora card: off by default, the words are reference, not a control */
   showLoraTriggers: boolean
   /** how big lora images are drawn in the form's rows, 1 = the base card size */
   loraFormScale: number
   /** how big lora images are drawn in the lora popup, 1 = the base card size */
   loraPopupScale: number
   loraSort: LoraSort
   /** how many lora cards the popup draws. A cap exists because each card is an image
    * request; how many is a MACHINE question (your box, your collection), so it is yours */
   loraCap: number
   run: RunSt
   /** prompt refiner: own store, own localStorage blob (the openrouter key never leaves the browser) */
   enhancer: EnhancerSt
   /** ⌘K / ⌘J: every workflow and draft, fuzzy matched */
   omnibox: OmniboxSt
   /** SERVER settings, not browser ones: they decide whether a generation writes files at all
    * and where, so they are shared by every client and read back from GET /settings */
   settings: ServeSettings = {
      saveToDisk: true,
      hostOverride: {},
      savePrefix: {},
      memoryBudgetMb: DEFAULT_MEMORY_BUDGET_MB,
      effectivePrefix: {},
   }
   savingError: string | null = null
   /** what you are typing in a prefix field, before the debounced write lands */
   private prefixEdits: Record<string, string> = {}
   private prefixTimers = new Map<string, ReturnType<typeof setTimeout>>()

   get saveToDisk(): boolean {
      return this.settings.saveToDisk
   }
   /** where the results go — hand-tuned, so it persists and restores */
   layout: ResultsLayout
   /** where `show preview` brings the panel back to, after `off` hid it with its own buttons */
   lastShownLayout: ResultsLayout = DEFAULT_LAYOUT
   /** var row order per module. A UI preference, so it lives in the browser blob: the draft
    * file is the var VALUES contract shared with the TUI, and a layout key there would have to
    * be filtered out by every reader of it */
   varOrder: Record<string, string[]> = {}
   /** your own starred size presets per `module/var`; absent = the var's defaults */
   sizeStars: Record<string, string[]> = {}
   /** the label column width, dragged by its edge */
   labelWidth = DEFAULT_LABEL_WIDTH

   /** the form's vars in YOUR order, with anything unknown (a new var) kept at the end */
   orderedVars(moduleKey: string, names: readonly string[]): string[] {
      const wanted = this.varOrder[moduleKey]
      if (wanted == null) return [...names]
      const known = new Set(names)
      const ordered = wanted.filter((n) => known.has(n))
      return [...ordered, ...names.filter((n) => !ordered.includes(n))]
   }

   moveVar(p: { module: string; names: readonly string[]; from: number; to: number }): void {
      const order = this.orderedVars(p.module, p.names)
      const [moved] = order.splice(p.from, 1)
      if (moved == null) return
      order.splice(p.to, 0, moved)
      this.varOrder = { ...this.varOrder, [p.module]: order }
      this.persist()
   }

   /** hosts this process knows + where each module runs (server-owned, like the drafts) */
   hosts: HostsPayload = { hosts: [], defaults: {}, overrides: {} }
   hostError: string | null = null
   /** buttons the EMBEDDING page asked for on every result (host protocol, host.ts). Empty
    * when the panel is a plain tab, so nothing here changes the standalone panel */
   hostActions: PanelHostAction[] = []
   /** the parent window's origin, pinned from its first host message — replies go there only */
   private hostOrigin: string | null = null
   /** module + draft + values of the last `state` posted, so the debounced mirror does not
    * repeat what a reply (or the previous mirror) already told the host */
   private lastPostedState: string | null = null
   /** in-flight selection changes (select, delete, lora refresh): a host request waits for
    * them to settle instead of answering against a form that is null for a moment */
   private switches = new Set<Promise<unknown>>()
   /** host messages run one after another, behind the boot: a message that lands while the
    * index is still loading needs a form, and dropping it was the silent failure */
   private hostChain: Promise<void> = Promise.resolve()

   constructor(private formTiming: FormTiming = FORM_TIMING) {
      this.run = new RunSt()
      // a finished run reports the seed it used; the form shows it, and the autosave carries it
      // into the draft, which is also what the server continues from, so `+` keeps stepping
      this.run.onSeeds = (p): void => this.applyRunSeeds(p)
      this.enhancer = new EnhancerSt(() => this.form)
      this.omnibox = new OmniboxSt(this)
      const stored = readStoredSelection()
      // a stored 'auto' from before the mode was removed resolves to what it MEANT on a
      // wide screen, which is where it spent most of its life
      this.layout = isLayout(stored.layout) ? stored.layout : DEFAULT_LAYOUT
      this.showLoraImages = stored.loraImages ?? true
      this.showLoraTitles = stored.loraTitles ?? true
      this.loraFill = stored.loraFill ?? true
      this.showLoraTriggers = stored.loraTriggers ?? false
      const loraScales = readLoraScales(stored)
      this.loraFormScale = loraScales.form
      this.loraPopupScale = loraScales.popup
      this.loraSort = asLoraSort(stored.loraSort)
      // marked in the blob, so the bump happens once and a deliberate 60 sticks after it
      this.loraCap = clampLoraCap(
         stored.loraCapMigrated !== true && stored.loraCap === LEGACY_LORA_CAP ? DEFAULT_LORA_CAP : stored.loraCap,
      )
      this.latentMode = asLatentMode(stored.latent)
      this.blurResults = stored.blur ?? false
      this.resultsColumns = readResultsColumns(stored)
      this.expandedPreviews = Array.isArray(stored.expandedPreviews)
         ? stored.expandedPreviews.filter((x): x is string => typeof x === 'string')
         : []
      this.varOrder = stored.varOrder ?? {}
      this.sizeStars = stored.sizeStars ?? {}
      this.labelWidth = clampLabelWidth(stored.labelWidth)
      this.showLogs = stored.logs ?? false
      makeAutoObservable<WebSt, 'hostOrigin' | 'hostChain' | 'lastPostedState' | 'switches' | 'formTiming'>(this, {
         run: false,
         enhancer: false,
         omnibox: false,
         form: observableRef,
         modules: observableShallow,
         hostOrigin: false,
         hostChain: false,
         lastPostedState: false,
         switches: false,
         formTiming: false,
      })
      // inside a host page → listen for what it asks; a plain tab never sees a message
      if (isEmbedded()) window.addEventListener('message', (e) => this.onHostMessage(e))
      // a closing/hidden tab must not lose an edit still inside the autosave debounce
      window.addEventListener('beforeunload', () => this.form?.flushKeepalive())
      document.addEventListener('visibilitychange', () => {
         // hiding a tab is not closing it: the ordinary chained save keeps writes in order.
         // keepalive is unchained by necessity and could land before an older one
         if (document.visibilityState === 'hidden') void this.form?.save()
      })
      // boot catches its own failures; the chain only has to outlive them
      this.hostChain = this.boot().catch((e: unknown) => logWebError('panel boot failed', e))
   }

   /** live while dragging, persisted once on release: a write per pointer move is wasted work */
   setLabelWidth(px: number, persist: boolean): void {
      this.labelWidth = clampLabelWidth(px)
      if (persist) this.persist()
   }

   setSizeStars(key: string, stars: string[]): void {
      this.sizeStars[key] = stars
      this.persist()
   }

   setLoraFormScale(v: number): void {
      this.loraFormScale = clampLoraScale(v)
      this.persist()
   }

   setLoraPopupScale(v: number): void {
      this.loraPopupScale = clampLoraScale(v)
      this.persist()
   }

   toggleLoraTriggers(): void {
      this.showLoraTriggers = !this.showLoraTriggers
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

   setLoraSort(mode: LoraSort): void {
      this.loraSort = mode
      this.persist()
   }

   toggleLoraFill(): void {
      this.loraFill = !this.loraFill
      this.persist()
   }

   setLoraCap(next: number): void {
      this.loraCap = clampLoraCap(next)
      this.persist()
   }

   /** put the seeds a run used back on the form, VALUE only: the mode is the draft's policy and
    * a run never changes it. Writing the USED value (not the next one) is deliberate, the
    * server restarts its continuation from the draft, so writing the next value would skip one */
   private applyRunSeeds(p: { module: string; draft: string; seeds: Record<string, number> }): void {
      const form = this.form
      // the run that finished, not whatever is on screen now: a queued run resolving after you
      // browsed away wrote its seed into ANOTHER draft, and the autosave put it on disk
      if (form == null || form.moduleKey !== p.module || form.draft !== p.draft) return
      runInAction(() => {
         for (const varSt of form.vars) {
            if (varSt.desc.kind !== 'seed') continue
            const used = p.seeds[varSt.name]
            if (typeof used !== 'number' || !Number.isFinite(used)) continue
            const current = asSeedForm(varSt.value)
            if (current.value === used) continue
            varSt.setFromRun({ mode: current.mode, value: used })
         }
      })
      this.mirrorState()
   }

   /** the address bar follows the selection, so the url on screen is always the one to share.
    * replaceState, not pushState: picking drafts is a browsing gesture here, and one history
    * entry per click would make Back mean "undo the last twelve clicks" */
   private syncUrl(): void {
      const form = this.form
      if (form == null) return
      try {
         const search = writeUrlSelection({
            search: window.location.search,
            module: form.moduleKey,
            draft: form.draft,
         })
         window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`)
      } catch (e) {
         // a sandboxed frame can refuse history writes; the panel itself still works
         logWebError('could not put the selection in the url', e)
      }
   }

   private persist(): void {
      try {
         // merge, never rebuild: toggling a setting before a draft loads must not
         // erase the stored selection (this.form is null then)
         const stored = readStoredSelection()
         localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
               ...stored,
               ...(this.form != null ? { module: this.form.moduleKey, draft: this.form.draft } : {}),
               loraImages: this.showLoraImages,
               loraTitles: this.showLoraTitles,
               loraFill: this.loraFill,
               loraTriggers: this.showLoraTriggers,
               loraFormScale: this.loraFormScale,
               loraPopupScale: this.loraPopupScale,
               loraSort: this.loraSort,
               loraCap: this.loraCap,
               loraCapMigrated: true,
               layout: this.layout,
               latent: this.latentMode,
               blur: this.blurResults,
               resultsColumns: this.resultsColumns,
               expandedPreviews: this.expandedPreviews,
               logs: this.showLogs,
               varOrder: this.varOrder,
               sizeStars: this.sizeStars,
               labelWidth: this.labelWidth,
            }),
         )
      } catch (e) {
         logWebError('ui state could not be stored (it will not survive a reload)', e)
      }
   }

   /** the open drafts, left to right. The serve process keeps them (GET/PUT /tabs), never
    * this browser: every window shows the same tabs */
   tabs: readonly DraftTab[] = []

   private async loadTabs(): Promise<void> {
      try {
         const reply = await fetchTabs()
         const tabs = readTabs(
            reply.tabs,
            this.modules.map((m) => ({ module: m.module, drafts: m.drafts })),
         )
         runInAction(() => {
            this.tabs = tabs
         })
      } catch (e) {
         logWebError('the open tabs could not be read, starting with none', e)
      }
   }

   private setTabs(next: readonly DraftTab[]): void {
      if (next === this.tabs) return
      this.tabs = next
      saveTabs(next).catch((e: unknown) => logWebError('the open tabs could not be saved', e))
   }

   get activeTab(): DraftTab | null {
      return this.form == null ? null : { module: this.form.moduleKey, draft: this.form.draft }
   }

   /** × on a tab: closing the open one moves to its neighbour, the last tab stays */
   closeTab(t: DraftTab): void {
      const r = closeTab(this.tabs, t, this.activeTab)
      this.setTabs(r.tabs)
      if (r.next != null) void this.select(r.next)
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
            this.workspace = index.workspace ?? null
            this.root = index.root ?? null
            this.phase = 'ready'
         })
         void this.loadSettings()
         void this.loadHosts()
         void this.run.loadKept()
         const stored = readStoredSelection()
         // the URL wins over the stored selection: a link someone sent is an instruction, the
         // stored one is only a memory of this browser's last visit
         const opening = resolveSelection({
            url: readUrlSelection(window.location.search),
            stored: { module: stored.module ?? null, draft: stored.draft ?? null },
            modules: this.modules,
         })
         // `ready` means "booted with a selection": without one the host must hear that the
         // panel is dead, or it cannot tell dead from still loading
         if (opening == null) {
            this.postHost({ comfyTs: 'error', code: 'boot', message: 'no workflows are served' })
            return
         }
         // before the first select, which adds its own tab to the list it read
         await this.loadTabs()
         await this.select(opening)
         if (this.form == null) {
            this.postHost({
               comfyTs: 'error',
               code: 'boot',
               message: `the opening draft could not be read: ${this.formError ?? 'unknown error'}`,
            })
            return
         }
         // a host opens the panel with the prompt already typed (`?prompt=`)
         const urlPrompt = readUrlPrompt(window.location.search)
         if (urlPrompt != null) this.setPromptText(urlPrompt)
         // last: the host replies with its buttons + its prompt, and both need a form
         this.postHost({ comfyTs: 'ready' })
         this.startDriftWatch()
      } catch (e) {
         const message = e instanceof Error ? e.message : String(e)
         runInAction(() => {
            this.phase = 'error'
            this.bootError = message
         })
         this.postHost({ comfyTs: 'error', code: 'boot', message })
      }
   }

   /** latest-wins guard for rapid draft clicks: only the newest select may write form state */
   private selectToken = 0

   /** `mirror: false` when a host request will answer with its own `state` right after */
   select(p: { module: string; draft: string }, o: { mirror?: boolean } = {}): Promise<void> {
      // the phone drawer is a way to a draft: arriving there closes it
      this.menuOpen = false
      this.renamingDraft = null
      return this.trackSwitch(this.selectNow(p, o.mirror ?? true))
   }

   private trackSwitch<T>(op: Promise<T>): Promise<T> {
      this.switches.add(op)
      const done = (): void => void this.switches.delete(op)
      op.then(done, done)
      return op
   }

   /** resolves once no selection change is in flight (a nested one included) */
   private async switchSettled(): Promise<void> {
      while (this.switches.size > 0) await Promise.allSettled(this.switches)
   }

   private async selectNow(p: { module: string; draft: string }, mirror: boolean): Promise<void> {
      const mod = this.moduleByKey(p.module)
      if (mod == null) return
      // re-picking the draft you are IN is a no-op, not a reload: a pending autosave would
      // lose the race against the fetch and the typed edit would vanish from the form
      if (this.form?.moduleKey === p.module && this.form.draft === p.draft) {
         return
      }
      const token = ++this.selectToken
      runInAction(() => {
         // the refiner points at a var of the OUTGOING form: applying it after the swap
         // would write into a discarded object, so the modal closes with its form
         this.enhancer.close()
         this.formLoading = true
         this.formError = null
      })
      // flush the outgoing form BEFORE reading the next one, so a switch never races its own save
      const outgoing = this.form
      if (outgoing != null) {
         outgoing.dispose()
         // OFF SCREEN before the round trip: its autosave reaction is already disposed, so
         // leaving it rendered meant every keystroke during the fetch went nowhere, silently.
         // app shows "loading draft…" while form is null
         runInAction(() => {
            this.form = null
         })
         if (!(await outgoing.save()))
            runInAction(() => {
               this.formError = `the previous draft could not be saved: ${outgoing.saveError ?? 'unknown error'}`
            })
      }
      try {
         const reply = await fetchDraftValues(p)
         // a newer select owns the screen now: telling the host about this one would be a lie
         if (token !== this.selectToken) return
         const form = new FormSt(p.module, p.draft, mod, reply.values ?? {}, this.formTiming)
         // the host mirrors user edits on the autosave's own debounce (pinned only)
         form.onSettled = (): void => this.mirrorState()
         runInAction(() => {
            this.form = form
            this.setTabs(openTab(this.tabs, p))
            this.persist()
            this.syncUrl()
         })
         this.postHost({ comfyTs: 'selection', module: form.moduleKey, draft: form.draft })
         if (mirror) this.mirrorState()
      } catch (e) {
         runInAction(() => {
            if (token !== this.selectToken) return
            // the outgoing form was DISPOSED above: keeping it on screen leaves an editable
            // form whose autosave reaction is dead, so edits silently stop persisting while
            // the header still reads 'saved'. No form is honest, the error says what happened
            this.form = null
            this.formError = e instanceof Error ? e.message : String(e)
         })
      } finally {
         runInAction(() => {
            if (token === this.selectToken) this.formLoading = false
         })
      }
   }

   // ── the host protocol (host.ts, types in hostProtocol.ts) ────────────────
   promptVar(): VarSt | null {
      return pickPromptVar(this.form?.vars ?? [])
   }

   /** `set-prompt` and `?prompt=`: through the same coercion as set-values */
   setPromptText(text: string): void {
      const v = this.promptVar()
      if (v == null) return
      const coerced = coerceHostValue(v.desc, text, v.value)
      if (!coerced.ok) {
         logWebError('host set-prompt', `'${v.name}' (${v.desc.kind}) rejected the text`)
         return
      }
      runInAction(() => v.set(coerced.value))
   }

   private postHost(msg: PanelToHost): void {
      if (!isEmbedded()) return
      // host.ts owns the rule: before the pin only value-free messages leave, to '*'
      const target = postTarget(msg, this.hostOrigin)
      if (target == null) return
      try {
         window.parent.postMessage(msg, target)
      } catch (e) {
         logWebError('could not post to the host page', e)
      }
   }

   /** set vars by name, each through coerceHostValue. Returns the names NOT applied (no such
    * var, or a value its control cannot produce); those fields stay as they were */
   setValues(values: Record<string, unknown>): string[] {
      const form = this.form
      if (form == null) return Object.keys(values)
      const rejected: string[] = []
      runInAction(() => {
         for (const [name, raw] of Object.entries(values)) {
            const varSt = form.vars.find((v) => v.name === name)
            if (varSt == null) {
               rejected.push(name)
               logWebError('host set-values', `no var named '${name}' on ${form.moduleKey}`)
               continue
            }
            const coerced = coerceHostValue(varSt.desc, raw, varSt.value)
            if (coerced.ok) varSt.set(coerced.value)
            else {
               rejected.push(name)
               logWebError('host set-values', `'${name}' (${varSt.desc.kind}) rejected ${safeStringify(raw)}`)
            }
         }
      })
      return rejected
   }

   private stateOf(form: FormSt): { key: string; values: Record<string, unknown> } {
      const values = form.varValues()
      return { key: safeStringify([form.moduleKey, form.draft, values]), values }
   }

   /** the reply to a request: always posted (the host is pinned, it just spoke) */
   private replyState(form: FormSt, request: PanelRequest, rejected?: string[]): void {
      const { key, values } = this.stateOf(form)
      this.lastPostedState = key
      this.postHost({
         comfyTs: 'state',
         module: form.moduleKey,
         draft: form.draft,
         values,
         request,
         ...(rejected != null ? { rejected } : {}),
      })
   }

   /** volunteered state (a user edit or switch, run seeds): only to a pinned host, and only
    * when it differs from the last state the host was told */
   private mirrorState(): void {
      const form = this.form
      if (form == null || this.hostOrigin == null) return
      const { key, values } = this.stateOf(form)
      if (key === this.lastPostedState) return
      this.lastPostedState = key
      this.postHost({ comfyTs: 'state', module: form.moduleKey, draft: form.draft, values })
   }

   private replyError(
      request: PanelRequest,
      code: 'unknown-module' | 'select-failed' | 'superseded' | 'no-form',
      message: string,
   ): void {
      this.postHost({ comfyTs: 'error', code, message, request })
   }

   private onHostMessage(e: MessageEvent): void {
      // the host is the parent window, nobody else: a sibling or child frame posting first used
      // to pin ITS origin and lock the real host out
      if (e.source !== window.parent) return
      const msg = parseFromHost(e.data)
      if (msg == null) return
      if (this.hostOrigin == null) this.hostOrigin = e.origin
      else if (e.origin !== this.hostOrigin) return
      this.hostChain = this.hostChain
         .then(() => this.applyHostMessage(msg))
         .catch((err: unknown) => logWebError(`host message '${msg.comfyTs}' failed`, err))
   }

   /** every request (`set-selection`, `set-values`, `get-state`) answers exactly once, with
    * `state` or `error`; the catch below keeps that true when something throws */
   private async applyHostMessage(msg: HostToPanel): Promise<void> {
      try {
         await this.applyHostMessageNow(msg)
      } catch (e) {
         if (msg.comfyTs === 'set-selection' || msg.comfyTs === 'set-values' || msg.comfyTs === 'get-state')
            this.replyError(msg.comfyTs, 'no-form', e instanceof Error ? e.message : String(e))
         throw e
      }
   }

   private async applyHostMessageNow(msg: HostToPanel): Promise<void> {
      switch (msg.comfyTs) {
         case 'host-actions':
            runInAction(() => {
               this.hostActions = msg.actions
            })
            return
         case 'set-prompt':
            await this.switchSettled()
            this.setPromptText(msg.text)
            return
         case 'set-selection': {
            await this.switchSettled()
            const target = resolveHostSelection({ want: msg, modules: this.modules })
            if (target == null) {
               this.replyError('set-selection', 'unknown-module', `no workflow named '${msg.module}' is served`)
               return
            }
            const open = this.form
            if (open == null || open.moduleKey !== target.module || open.draft !== target.draft) {
               await this.select(target, { mirror: false })
               await this.switchSettled()
            }
            const form = this.form
            if (form == null) {
               const why = this.formError ?? 'the draft could not be read'
               this.replyError('set-selection', 'select-failed', why)
            } else if (form.moduleKey !== target.module || form.draft !== target.draft)
               this.replyError(
                  'set-selection',
                  'superseded',
                  `the panel switched to ${form.moduleKey}/${form.draft} while ${target.module}/${target.draft} was loading`,
               )
            else this.replyState(form, 'set-selection')
            return
         }
         case 'set-values': {
            await this.switchSettled()
            const form = this.form
            if (form == null) {
               this.replyError('set-values', 'no-form', this.noFormMessage())
               return
            }
            this.replyState(form, 'set-values', this.setValues(msg.values))
            return
         }
         case 'get-state': {
            await this.switchSettled()
            const form = this.form
            if (form == null) this.replyError('get-state', 'no-form', this.noFormMessage())
            else this.replyState(form, 'get-state')
            return
         }
      }
   }

   private noFormMessage(): string {
      return this.formError != null ? `no draft is open: ${this.formError}` : 'no draft is open'
   }

   /** a host button on a result: tell the page which image, and the prompt it came from */
   postResultAction(
      actionId: string,
      r: { promptId: string; module: string; draft: string; seeds: Record<string, number> },
      img: { url: string; filename: string },
      ix: number,
   ): void {
      const pv = this.promptVar()
      this.postHost({
         comfyTs: 'result-action',
         id: actionId,
         promptId: r.promptId,
         ix,
         url: img.url,
         filename: img.filename,
         module: r.module,
         draft: r.draft,
         seeds: r.seeds,
         prompt: pv != null && typeof pv.value === 'string' ? pv.value : null,
      })
   }

   /** side and pinned show the results next to (or over) the form, so the run button belongs
    * there: in pinned it stays on screen while the form scrolls */
   get generateInResults(): boolean {
      return this.layout === 'side' || this.layout === 'left' || this.layout === 'pinned'
   }

   setLayout(next: ResultsLayout): void {
      // a click SETS the mode. cycling back to a width rule lands where no button is showing
      if (this.layout !== 'off') this.lastShownLayout = this.layout
      this.layout = next
      this.persist()
   }

   showPreview(): void {
      this.setLayout(this.lastShownLayout === 'off' ? DEFAULT_LAYOUT : this.lastShownLayout)
   }

   /** the host a module's runs go to right now (override if any, else the module's own) */
   hostFor(moduleKey: string): string {
      return this.hosts.overrides[moduleKey] ?? this.hosts.defaults[moduleKey] ?? ''
   }

   /** the host's OWN base url, for opening its pages (the lora manager lives there) */
   hostUrlFor(moduleKey: string): string | null {
      const id = this.hostFor(moduleKey)
      return this.hosts.hosts.find((h) => h.id === id)?.httpUrl ?? null
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
      } catch (e) {
         // the process serving this page owns /hosts, so a failure here is a real one (500,
         // transport) rather than an old server: never swallowed, or the host box silently
         // shows the module default and every host action targets the wrong box
         logWebError('could not read the host list', e)
      }
   }

   /** the ComfyUI console, polled only while the logs panel is open (off by default: most of
    * the time you do not care, and a closed panel must cost nothing) */
   showLogs = false
   logLines: string[] = []
   logsError: string | null = null
   /** the latent frames during a run: full in the running card, small in a corner, or none */
   latentMode: LatentMode = 'corner'
   /** results blurred until the pointer is on them: a screen someone else may see */
   blurResults = false

   /** the last ⌘P / ⌘O jump: the var it targets reacts to a NEW seq, so pressing it twice works */
   jump: { kind: 'prompt' | 'loras'; seq: number } | null = null

   requestJump(kind: 'prompt' | 'loras'): void {
      this.jump = { kind, seq: (this.jump?.seq ?? 0) + 1 }
   }
   /** results side by side in the preview, each column an equal share of its width */
   resultsColumns = 1
   /** live previews opened to their full text, as `module/name`; the rest show one line each */
   expandedPreviews: string[] = []
   private logsTimer: ReturnType<typeof setInterval> | null = null

   setLatentMode(v: LatentMode): void {
      this.latentMode = v
      this.persist()
   }

   togglePreviewExpanded(key: string): void {
      this.expandedPreviews = this.expandedPreviews.includes(key)
         ? this.expandedPreviews.filter((k) => k !== key)
         : [...this.expandedPreviews, key]
      this.persist()
   }

   setResultsColumns(n: number): void {
      this.resultsColumns = clampResultsColumns(n)
      this.persist()
   }

   toggleBlur(): void {
      this.blurResults = !this.blurResults
      this.persist()
   }

   setMenuOpen(open: boolean): void {
      this.menuOpen = open
   }

   /** the name being typed for the open draft, null when no rename is in progress. Here, not in
    * the menu, because F2 starts it from any focus */
   renamingDraft: string | null = null

   /** F2 and the rename row. The phone drawer opens so the input is on screen; a folded desktop
    * menu unfolds (App reacts to renamingDraft) */
   startRename(): void {
      if (this.form == null) return
      this.renamingDraft = this.form.draft
      this.menuOpen = true
   }

   setRenaming(v: string): void {
      this.renamingDraft = v
   }

   stopRename(): void {
      this.renamingDraft = null
   }

   /** bumped by ⌘B and the ☰: the desktop menu Panel folds or unfolds on each bump */
   menuFoldTick = 0

   requestMenuFold(): void {
      this.menuFoldTick++
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
            // already folded into lines server side, through the TUI's own assembly
            this.logLines = reply.lines
            this.logsError = null
         })
      } catch (e) {
         runInAction(() => {
            this.logsError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   /** ONE refresh for everything a host knows: serve refetches its schema and re-reads its lora
    * manager list, then the panel re-reads its workflow descriptions, so the open form offers
    * what the host has now (a new lora, a new model) without a tab reload. The drift check calls
    * it by itself; the host card's ↻ is the same call, pulsing while it runs */
   refreshing = false

   async refreshHost(): Promise<void> {
      if (this.refreshing) return
      runInAction(() => {
         this.refreshing = true
      })
      try {
         await this.hostAction('refresh-schema')
         await this.trackSwitch(this.reloadIndexAndForm())
      } finally {
         runInAction(() => {
            this.refreshing = false
         })
      }
   }

   /** the host changed since serve loaded its schema: a light check (the loaders, a few KB) every
    * 15s while the tab is visible, a full one (node types too) at boot and when a host that
    * stopped answering answers again. A change is not SHOWN, it is applied: refreshHost */
   driftDown = false

   private startDriftWatch(): void {
      void this.checkDrift(true)
      setInterval(() => {
         if (document.visibilityState === 'visible') void this.checkDrift(false)
      }, 15_000)
   }

   async checkDrift(full: boolean): Promise<void> {
      const host = this.form == null ? null : this.hostFor(this.form.moduleKey)
      if (host == null || host === '' || this.refreshing) return
      try {
         const r = await fetchHostDrift({ host, full })
         const cameBack = this.driftDown
         runInAction(() => {
            this.driftDown = false
         })
         if (r.changed) await this.refreshHost()
         else if (cameBack && !full) await this.checkDrift(true)
      } catch {
         runInAction(() => {
            this.driftDown = true
         })
      }
   }

   /** loras whose civitai fetch is in flight: their card says so instead of offering it twice */
   loraFetching = new Set<string>()

   /** one lora's trigger words, fetched from civitai by the lora manager, then the mirror and
    * the descriptors re-read so the card shows what came back (words, or a definite none) */
   async fetchLoraTriggers(lora: string): Promise<void> {
      const host = this.form == null ? null : this.hostFor(this.form.moduleKey)
      if (host == null || host === '' || this.loraFetching.has(lora)) return
      runInAction(() => {
         this.loraFetching.add(lora)
         this.hostError = null
      })
      try {
         await postLoraCivitai({ host, lora })
         await this.trackSwitch(this.reloadIndexAndForm())
      } catch (e) {
         runInAction(() => {
            this.hostError = e instanceof Error ? e.message : String(e)
         })
      } finally {
         runInAction(() => {
            this.loraFetching.delete(lora)
         })
      }
   }

   private async reloadIndexAndForm(): Promise<void> {
      // the option lists (and the manager-only union) live in the descriptors: re-read them,
      // then re-select the same draft so the form is rebuilt against the new options
      try {
         const index = await fetchIndex()
         const current = this.form
         runInAction(() => {
            this.modules = index.workflows
         })
         if (current != null) {
            // flush and DISPOSE the outgoing form, in an action: dropping the reference alone
            // leaked its autosave reaction and let it write the file the new form just read
            current.dispose()
            await current.save()
            runInAction(() => {
               this.form = null
            })
            await this.select({ module: current.moduleKey, draft: current.draft })
         }
      } catch (e) {
         runInAction(() => {
            this.hostError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   /** a restart takes the host down and back: this WATCHES it instead of leaving you guessing.
    * polls until it answers, or gives up loudly after ~2 minutes */
   hostWatch: 'idle' | 'down' | 'back' = 'idle'

   private async watchHostComeBack(): Promise<void> {
      const host = this.form == null ? null : this.hostFor(this.form.moduleKey)
      if (host == null || host === '') return
      runInAction(() => {
         this.hostWatch = 'down'
      })
      const deadline = Date.now() + 120_000
      for (;;) {
         await new Promise((r) => setTimeout(r, 2500))
         if (Date.now() > deadline) {
            runInAction(() => {
               this.hostWatch = 'idle'
               this.hostError = `${host} has not answered for 2 minutes — check the console`
            })
            return
         }
         const up = await pingHost({ host })
            .then((r) => r.up)
            .catch(() => false)
         if (!up) continue
         runInAction(() => {
            this.hostWatch = 'back'
         })
         void this.checkDrift(true)
         setTimeout(() => runInAction(() => (this.hostWatch = 'idle')), 4000)
         return
      }
   }

   /** interrupt / clear the queue / reboot the box this workflow runs on */
   async hostAction(action: HostAction): Promise<void> {
      const host = this.form == null ? null : this.hostFor(this.form.moduleKey)
      if (host == null || host === '') return
      runInAction(() => {
         this.hostError = null
      })
      try {
         await postHostAction({ host, action })
         // a reboot is the one action whose result arrives LATER: watch for it
         if (action === 'restart') void this.watchHostComeBack()
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
      } catch (e) {
         // same as the host list: this process owns /settings, so a failure is a real one and
         // the panel would otherwise show the DEFAULT setting as if it were the server's
         logWebError('could not read the serve settings', e)
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

   /** the server evicts at once on a smaller budget, so the usage is re-read after */
   async setMemoryBudget(mb: number): Promise<void> {
      if (await this.pushSettings({ memoryBudgetMb: mb })) await this.run.refreshMemory()
   }

   private async pushSettings(patch: {
      saveToDisk?: boolean
      savePrefix?: Record<string, string>
      memoryBudgetMb?: number
   }): Promise<boolean> {
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

   /** `override` replaces var values in THIS run only (the enhancer's try): the form and the
    * draft keep their own */
   generate(override?: Record<string, unknown>): void {
      void this.generateNow(override)
   }

   /** flush the autosave first: the server reads the draft it just wrote — one source of truth.
    * every click ENQUEUES, so hitting generate n times runs n prompts; the queued payload
    * freezes the values you saw, and seeds stay on the draft's server-side policy */
   private async generateNow(override?: Record<string, unknown>): Promise<void> {
      const form = this.form
      if (form == null) return
      const payload = { ...form.queuePayload(), ...override }
      const saved = await form.save()
      // the header already shows the loud save error; running the stale draft would lie
      if (!saved) return
      this.run.enqueue({ module: form.moduleKey, draft: form.draft, payload })
      this.recordPrompts(form, payload)
   }

   /** every prompt var of what was just queued, for the history picker (this page only) */
   promptHistory: HistoryEntry<PromptInput>[] = []

   /** from the payload that was SENT, so a tried candidate is history like any prompt */
   private recordPrompts(form: FormSt, payload: Record<string, unknown>): void {
      const at = Date.now()
      for (const v of form.vars) {
         const value = payload[v.name]
         if (v.desc.kind !== 'prompt' || !isPromptInput(value)) continue
         // lanes keep their headers in the text, so a search finds a lane by its name too
         const text = typeof value === 'string' ? value : promptLanesToText(value)
         this.promptHistory = pushHistory(this.promptHistory, {
            text,
            value,
            at,
            source: `${form.moduleKey} · ${v.desc.label ?? v.name}`,
         })
      }
   }

   /** rename = write the values under the new name, switch to it, then drop the old FILE.
    * same shape as the enhancer presets: the name IS the identity, so there is nothing to
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
               this.setTabs(
                  renameTab(
                     this.tabs,
                     { module: form.moduleKey, draft: from },
                     { module: form.moduleKey, draft: name },
                  ),
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
    * ORDER: the form is dropped WITHOUT flushing FIRST, its autosave would otherwise
    * re-create the file the server is about to delete */
   deleteDraft(p: { module: string; draft: string }): Promise<void> {
      return this.trackSwitch(this.deleteDraftNow(p))
   }

   private async deleteDraftNow(p: { module: string; draft: string }): Promise<void> {
      const neighbour = closeTab(this.tabs, p, this.activeTab).next
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
            this.setTabs(this.tabs.filter((t) => t.module !== p.module || t.draft !== p.draft))
         })
         // only when the open draft was the one deleted: its neighbour tab first, else the rule
         if (this.form != null) return
         const fallback = reply.drafts.includes('default') ? 'default' : (reply.drafts[0] ?? 'default')
         await this.select(neighbour ?? { module: p.module, draft: fallback })
      } catch (e) {
         runInAction(() => {
            this.formError = e instanceof Error ? e.message : String(e)
         })
      }
   }

   /** duplicate = save the current values under a new name, then switch to it */
   async duplicateDraft(rawName: string): Promise<void> {
      const form = this.form
      if (form == null) return
      await this.createDraft(rawName, form.valuesJSON())
   }

   /** ⌘D and the duplicate row: a copy of what is on screen, auto-named, opened */
   duplicateCurrentDraft(): Promise<void> {
      const form = this.form
      if (form == null) return Promise.resolve()
      const drafts = this.moduleByKey(form.moduleKey)?.drafts ?? [form.draft]
      return this.duplicateDraft(duplicateDraftName(form.draft, drafts))
   }

   /** the new draft row: the workflow's own values, auto-named, opened */
   newDraftFromDefaults(): Promise<void> {
      const form = this.form
      if (form == null) return Promise.resolve()
      return this.newDraft(freeDraftName(this.moduleByKey(form.moduleKey)?.drafts ?? []))
   }

   /** a new draft from the workflow's OWN values (the ones in its code), not the open draft's */
   async newDraft(rawName: string): Promise<void> {
      const form = this.form
      const mod = form == null ? null : this.moduleByKey(form.moduleKey)
      if (mod == null) return
      const values: Record<string, unknown> = {}
      for (const [name, desc] of Object.entries(mod.vars)) values[name] = desc.default
      await this.createDraft(rawName, values)
   }

   private async createDraft(rawName: string, values: Record<string, unknown>): Promise<void> {
      const form = this.form
      const name = rawName.trim()
      if (form == null || name === '') return
      const existing = this.moduleByKey(form.moduleKey)?.drafts.includes(name) === true
      if (existing && !window.confirm(`draft '${name}' already exists — overwrite it?`)) return
      try {
         const reply = await saveDraft({ module: form.moduleKey, draft: name, values })
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
