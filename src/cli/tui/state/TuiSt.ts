import { makeAutoObservable, observableRef, runInAction } from 'mobx'
import { listWindow, type ListWindow } from 'src/cli/tui/listWindow.ts'
import type { SeedVar, ToggleVar, AnyVar } from 'src/vars/ComfyVars.ts'
import { ImagePickerSt } from 'src/cli/tui/imagePicker/ImagePickerSt.ts'
import { DraftsSt, draftKeyForFile } from 'src/cli/tui/state/DraftsSt.ts'
import { EditorSt } from 'src/cli/tui/state/EditorSt.ts'
import { ExecSt } from 'src/cli/tui/state/ExecSt.ts'
import { HostSt } from 'src/cli/tui/state/HostSt.ts'
import { LogsSt } from 'src/cli/tui/state/LogsSt.ts'
import { LorasSt } from 'src/cli/tui/state/LorasSt.ts'
import { PickerSt } from 'src/cli/tui/state/PickerSt.ts'
import { PreviewSt } from 'src/cli/tui/state/PreviewSt.ts'
import { QueueSt } from 'src/cli/tui/state/QueueSt.ts'
import { SettingsSt } from 'src/cli/tui/state/SettingsSt.ts'
import { TreeSt } from 'src/cli/tui/state/TreeSt.ts'
import { WorkflowsSt } from 'src/cli/tui/state/WorkflowsSt.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { DefinedWorkflow } from 'src/vars/DefinedWorkflow.ts'

// nav = vars list · tree = left workflow panel · host = host stats/actions (`a`) ·
// preview = `p` settings menu in the preview panel ·
// edit = inline single-line (numbers + custom prompts) · overlay-* = modal popups
// (overlay-hosts = the `h` host picker)
export type TuiMode =
   | 'nav'
   | 'tree'
   | 'host'
   | 'preview'
   | 'edit'
   | 'overlay-text'
   | 'overlay-choice'
   | 'overlay-size'
   | 'overlay-loras'
   | 'overlay-image'
   | 'overlay-drafts'
   | 'overlay-hosts'
   | 'overlay-copy'

/**
 * ROOT of the TUI state tree (one instance per run). Children are service
 * classes with an `st` backref; components are stateless views over this.
 */
export class TuiSt {
   wf: DefinedWorkflow
   mode: TuiMode = 'nav'
   selIx: number = 0

   /** `h` host override: when set, EVERY workflow runs/probes against it
    * instead of its defining host (cleared by picking 'workflow default') */
   hostOverride: ComfyHost | null = null

   /** the host runs actually target right now */
   get runHost(): ComfyHost {
      return this.hostOverride ?? this.wf.host
   }

   setHostOverride(host: ComfyHost | null): void {
      this.hostOverride = host
      // the override host must be disconnected on exit like any loaded one
      if (host != null) this.workflows.loadedHosts.add(host)
      this.queue.attach(this.runHost)
      this.logs.attach(this.runHost)
      this.settings.hostOverrideId = host?.data.id ?? null
   }

   /** re-resolve a persisted override id — hosts register as modules import */
   applyPersistedHostOverride(): void {
      const id = this.settings.hostOverrideId
      if (id == null || this.hostOverride != null) return
      const host = comfyts.hosts.get(id)
      if (host != null) this.setHostOverride(host)
   }

   editor: EditorSt
   picker: PickerSt
   loras: LorasSt
   imagePicker: ImagePickerSt
   workflows: WorkflowsSt
   tree: TreeSt
   drafts: DraftsSt
   exec: ExecSt
   preview: PreviewSt
   host: HostSt
   queue: QueueSt
   logs: LogsSt
   settings: SettingsSt

   /** owned cleanups (reactions, listeners) — flushed by dispose() */
   disposers: (() => void)[] = []
   onExit: () => void = () => {}

   constructor(
      wf: DefinedWorkflow,
      opts: {
         workflowFiles?: string[]
         currentFile?: string
         /** files that came from the PACKAGED examples (grouped apart in the tree) */
         bundledFiles?: Set<string>
         /** modules that failed to load before mount (red rows in the tree) */
         loadErrors?: Map<string, string>
      } = {},
   ) {
      this.wf = wf
      // wf: observableRef so switching workflows re-renders without proxying
      // the foreign object; children manage their own observability
      makeAutoObservable(this, {
         wf: observableRef,
         hostOverride: observableRef,
         onExit: false,
         editor: false,
         picker: false,
         loras: false,
         imagePicker: false,
         workflows: false,
         tree: false,
         drafts: false,
         exec: false,
         preview: false,
         host: false,
         queue: false,
         logs: false,
         settings: false,
      })
      this.settings = new SettingsSt(this)
      this.editor = new EditorSt(this)
      this.picker = new PickerSt(this)
      this.loras = new LorasSt(this)
      this.imagePicker = new ImagePickerSt(this)
      this.workflows = new WorkflowsSt(
         this,
         opts.workflowFiles ?? [],
         opts.currentFile ?? null,
         opts.bundledFiles,
         opts.loadErrors,
      )
      this.tree = new TreeSt(this)
      this.drafts = new DraftsSt(this)
      this.exec = new ExecSt(this)
      this.preview = new PreviewSt(this)
      this.host = new HostSt(this)
      this.queue = new QueueSt(this)
      this.logs = new LogsSt(this)
      // a remembered `h` override re-applies as soon as its host is registered
      this.applyPersistedHostOverride()
      // the TUI is ALWAYS in a draft from the very first frame: the one this
      // workflow was last in (settings), else 'default'; the current workflow
      // starts unfolded so its drafts are visible in the tree
      this.drafts.activateRemembered()
      if (opts.currentFile != null) {
         const currentFile = opts.currentFile
         // settings.lastWorkflow is OBSERVED (SettingsSt's own persist reaction),
         // so this constructor tail is a mobx action or it warns on every open
         runInAction(() => {
            this.tree.expandedFiles.add(currentFile)
            // the first module loads in run-tui, BEFORE WorkflowsSt.load can record it
            this.workflows.recordSpecColor(currentFile, wf)
            // whatever is on screen is what a no-arg reopen returns to
            this.settings.lastWorkflow = currentFile
         })
      }
      // full-terminal layout: track resizes (SIGWINCH surfaces as stdout resize)
      const onResize = (): void => {
         runInAction(() => {
            this.termCols = process.stdout.columns ?? 80
            this.termRows = (process.stdout.rows ?? 24) - 1
         })
      }
      process.stdout.on?.('resize', onResize)
      this.disposers.push(() => process.stdout.off?.('resize', onResize))
   }

   dispose(): void {
      for (const d of this.disposers.splice(0)) d()
      this.workflows.disconnectAllHosts()
   }

   // ---- terminal geometry (drives overlays + preview panel sizing) ----
   // rows minus 1: vscode's terminal clips the first row when a frame uses them all
   termCols: number = process.stdout.columns ?? 80
   termRows: number = (process.stdout.rows ?? 24) - 1

   /** rows available inside a modal overlay list */
   get overlayLines(): number {
      return Math.max(8, this.termRows - 12)
   }

   /** left tree panel width: longest row (depth-indented), clamped */
   get treeWidth(): number {
      const longest = Math.max(
         8,
         ...this.tree.rows.map(
            (r) =>
               r.depth * 2 +
               (r.kind === 'workflow' ? r.name.length : r.kind === 'draft' ? r.draft.length + 3 : r.label.length + 2),
         ),
      )
      return Math.min(34, longest + 7)
   }

   // ---- vars navigation ----
   get entries(): [string, AnyVar][] {
      return this.wf.entries()
   }

   get selected(): [string, AnyVar] | undefined {
      return this.entries[this.selIx]
   }

   /** module key of the loaded workflow (drafts + savePrefix are keyed by it) */
   get moduleKey(): string {
      const cur = this.workflows.currentPath
      return cur != null ? draftKeyForFile(cur) : (this.wf.spec.id ?? 'workflow')
   }

   /** the local save dir under .comfy-ts/outputs/ — per-module override, else the module key */
   get savePrefix(): string {
      return this.settings.savePrefix[this.moduleKey] ?? this.moduleKey
   }

   /** empty input resets to the module-key default */
   setSavePrefix(raw: string): void {
      const trimmed = raw.trim().replace(/^\/+|\/+$/g, '')
      if (trimmed === '' || trimmed === this.moduleKey) delete this.settings.savePrefix[this.moduleKey]
      else this.settings.savePrefix[this.moduleKey] = trimmed
   }

   /** the vars list carries the TUI-owned rows after the workflow vars: the
    * save-to-disk toggle, plus the save-prefix row while saving is on
    * (architecture item 14) */
   get varRowCount(): number {
      return this.entries.length + (this.settings.saveToDisk ? 2 : 1)
   }

   /** true while the selection sits on the save-to-disk pseudo-row */
   get onSaveRow(): boolean {
      return this.selIx === this.entries.length
   }

   /** true while the selection sits on the save-prefix pseudo-row */
   get onPrefixRow(): boolean {
      return this.settings.saveToDisk && this.selIx === this.entries.length + 1
   }

   moveSel(delta: number): void {
      const len = this.varRowCount
      this.selIx = (this.selIx + delta + len) % len
   }

   // ---- vars viewport (reviewer follow-up 2026-07-31: the fixed-height
   // frame clips instead of overflowing, so the vars list must window like
   // the tree — measured height, never chrome arithmetic) ----

   /** measured height of the vars panel Box (VarsPanel measureElement); 0 = not measured yet */
   varsViewH: number = 0
   setVarsViewH(h: number): void {
      this.varsViewH = h
   }

   /** row budget: measured height minus the 2 border rows; pre-measure fallback estimate */
   get varsBudget(): number {
      const h = this.varsViewH > 0 ? this.varsViewH : Math.max(5, this.termRows - 5)
      return Math.max(1, h - 2)
   }

   get varsWindow(): ListWindow {
      return listWindow({ count: this.varRowCount, selected: this.selIx, budget: this.varsBudget })
   }

   /**
    * while the list cannot fit, NON-selected rows collapse to one truncated
    * line (prompt values wrap tall) — rows above the selection then cost one
    * line each, so the selection can never be pushed off-screen. Reads only
    * entry count + measured height, never its own rendering: no oscillation.
    */
   get varsCompact(): boolean {
      const w = this.varsWindow
      if (w.moreAbove || w.moreBelow) return true
      const h = this.varsViewH > 0 ? this.varsViewH : Math.max(5, this.termRows - 5)
      return this.varRowCount + 2 > h
   }

   // kind-discriminated narrowing casts below are sanctioned (agent/coding.md):
   // ComfyVar<T> value-invariance blocks a clean union, `kind` is the tag.

   /** enter/space on a var: toggle, open an overlay, or inline-edit */
   activate(): void {
      if (this.onSaveRow) {
         this.settings.saveToDisk = !this.settings.saveToDisk
         return
      }
      if (this.onPrefixRow) {
         this.editor.beginCustom({
            title: `save prefix — dir under .comfy-ts/outputs/ (empty = ${this.moduleKey})`,
            initial: this.savePrefix,
            onCommit: (raw) => {
               this.setSavePrefix(raw)
               return true
            },
         })
         return
      }
      const sel = this.selected?.[1]
      if (sel == null) return
      if (sel.kind === 'toggle') (sel as ToggleVar).toggle()
      else if (sel.kind === 'text' || sel.kind === 'prompt') this.editor.beginMultiline()
      else if (sel.kind === 'choice') this.picker.beginChoice()
      else if (sel.kind === 'size') this.picker.beginSize()
      else if (sel.kind === 'loras') this.loras.begin()
      else if (sel.kind === 'image') this.imagePicker.begin()
      else this.editor.beginInline() // int / float / seed: type the number
   }

   /** kind-specific nav keys (documented in the keybar): seed `+`/`-`/`=`/`?` mode, `*` reroll */
   navKey(input: string): boolean {
      const sel = this.selected?.[1]
      if (sel?.kind === 'seed') {
         if (input === '+' || input === '-' || input === '=' || input === '?') {
            ;(sel as SeedVar).setMode(input)
            return true
         }
         if (input === '*') {
            ;(sel as SeedVar).randomize()
            return true
         }
      }
      return false
   }
}
