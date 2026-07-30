import { makeAutoObservable, observable, runInAction } from 'mobx'
import type { SeedVar, ToggleVar, AnyVar } from 'src/vars/ComfyVars.ts'
import { DraftsSt } from 'src/cli/tui/state/DraftsSt.ts'
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
import type { DefinedWorkflow } from 'src/vars/DefinedWorkflow.ts'

// nav = vars list · tree = left workflow panel · host = host stats/actions ·
// preview = `p` settings menu in the preview panel ·
// edit = inline single-line (numbers + custom prompts) · overlay-* = modal popups
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
   | 'overlay-drafts'

/**
 * ROOT of the TUI state tree (one instance per run). Children are service
 * classes with an `st` backref; components are stateless views over this.
 */
export class TuiSt {
   wf: DefinedWorkflow
   mode: TuiMode = 'nav'
   selIx: number = 0

   editor: EditorSt
   picker: PickerSt
   loras: LorasSt
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
      // wf: observable.ref so switching workflows re-renders without proxying
      // the foreign object; children manage their own observability
      makeAutoObservable(this, {
         wf: observable.ref,
         onExit: false,
         editor: false,
         picker: false,
         loras: false,
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
      // the TUI is ALWAYS in a draft from the very first frame: the one this
      // workflow was last in (settings), else 'default'; the current workflow
      // starts unfolded so its drafts are visible in the tree
      this.drafts.activateRemembered()
      if (opts.currentFile != null) this.tree.expandedFiles.add(opts.currentFile)
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

   /** left tree panel width: longest row (workflow or indented draft), clamped */
   get treeWidth(): number {
      const longest = Math.max(
         8,
         ...this.tree.rows.map((r) =>
            r.kind === 'workflow' ? r.name.length : r.kind === 'draft' ? r.draft.length + 3 : r.label.length,
         ),
      )
      return Math.min(32, longest + 7)
   }

   // ---- vars navigation ----
   get entries(): [string, AnyVar][] {
      return this.wf.entries()
   }

   get selected(): [string, AnyVar] | undefined {
      return this.entries[this.selIx]
   }

   moveSel(delta: number): void {
      const len = this.entries.length
      if (len === 0) return
      this.selIx = (this.selIx + delta + len) % len
   }

   // kind-discriminated narrowing casts below are sanctioned (agent/coding.md):
   // ComfyVar<T> value-invariance blocks a clean union, `kind` is the tag.

   /** enter/space on a var: toggle, open an overlay, or inline-edit */
   activate(): void {
      const sel = this.selected?.[1]
      if (sel == null) return
      if (sel.kind === 'toggle') (sel as ToggleVar).toggle()
      else if (sel.kind === 'text') this.editor.beginMultiline()
      else if (sel.kind === 'choice') this.picker.beginChoice()
      else if (sel.kind === 'size') this.picker.beginSize()
      else if (sel.kind === 'loras') this.loras.begin()
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
