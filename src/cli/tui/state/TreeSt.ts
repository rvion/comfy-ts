import { makeAutoObservable } from 'mobx'
import { listDraftsForFile } from 'src/cli/tui/state/DraftsSt.ts'
import { listWindow, type ListWindow } from 'src/cli/tui/listWindow.ts'
import { assignFamilyColors, buildFileRows, familyOf } from 'src/cli/tui/treeRows.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

export type TreeRow =
   | { kind: 'dir'; path: string; label: string; depth: number; expanded: boolean }
   | {
        kind: 'workflow'
        file: string
        name: string
        depth: number
        expanded: boolean
        current: boolean
        hasDrafts: boolean
        error: string | null
        /** spec.color of a LOADED module, else the per-family palette color */
        color: string
     }
   | { kind: 'draft'; file: string; draft: string; active: boolean; depth: number }

/** the left `(t)ree`: directory hierarchy + workflows with their drafts nested */
export class TreeSt {
   constructor(private st: TuiSt) {
      this.collapsedDirs = new Set(st.settings.collapsedDirs)
      makeAutoObservable<TreeSt, 'st'>(this, { st: false })
   }

   ix: number = 0
   expandedFiles: Set<string> = new Set()
   collapsedDirs: Set<string>

   /** fold state is hand-tuned: mirror every change into the settings file */
   private persistFolds(): void {
      this.st.settings.collapsedDirs = [...this.collapsedDirs]
   }
   /** `/` filter: the text narrows the tree; `filtering` = keys type into it */
   filter: string = ''
   filtering: boolean = false

   /** family → color over the FULL file list (stable under filter/fold) */
   private get familyColors(): Map<string, string> {
      return assignFamilyColors(this.st.workflows.files)
   }

   get rows(): TreeRow[] {
      void this.st.drafts.version // fs-derived: recompute when drafts change
      const w = this.st.workflows
      const fileRows = buildFileRows({
         userFiles: w.files.filter((f) => !w.bundled.has(f)),
         bundledFiles: w.files.filter((f) => w.bundled.has(f)),
         collapsedDirs: this.collapsedDirs,
         filter: this.filter,
      })
      const colors = this.familyColors
      const rows: TreeRow[] = []
      for (const row of fileRows) {
         if (row.kind === 'dir') {
            rows.push(row)
            continue
         }
         const current = row.file === w.currentPath
         const expanded = this.expandedFiles.has(row.file)
         const drafts = listDraftsForFile(row.file)
         rows.push({
            kind: 'workflow',
            file: row.file,
            name: row.name,
            depth: row.depth,
            expanded,
            current,
            hasDrafts: drafts.length > 0,
            error: w.loadErrors.get(row.file) ?? null,
            color: w.specColors.get(row.file) ?? colors.get(familyOf(row.name)) ?? 'white',
         })
         if (!expanded) continue
         for (const draft of drafts) {
            rows.push({
               kind: 'draft',
               file: row.file,
               draft,
               active: current && draft === this.st.drafts.active,
               depth: row.depth + 1,
            })
         }
      }
      return rows
   }

   get selected(): TreeRow | undefined {
      return this.rows[this.ix]
   }

   /** 't' / ←: focus the tree ON THE ACTIVE DRAFT (where you actually are), workflow row as fallback */
   focus(): void {
      const w = this.st.workflows
      if (w.files.length === 0) {
         this.st.exec.notice = 'no workflow tree — start the tui in a folder containing **/*.cflow.ts'
         return
      }
      if (w.currentPath != null) {
         this.expandedFiles.add(w.currentPath)
         // the cursor must land ON the current row: unfold any ancestor dir
         // hiding it (snapshot: the loop deletes while iterating)
         let changed = false
         const collapsed = [...this.collapsedDirs]
         for (const dir of collapsed) {
            if (w.currentPath.startsWith(`${dir}/`)) {
               this.collapsedDirs.delete(dir)
               changed = true
            }
         }
         if (changed) this.persistFolds()
      }
      this.st.mode = 'tree'
      const rows = this.rows
      const draftIx = rows.findIndex((r) => r.kind === 'draft' && r.active)
      const ix = draftIx === -1 ? rows.findIndex((r) => r.kind === 'workflow' && r.current) : draftIx
      this.ix = ix === -1 ? 0 : ix
   }

   // ---- viewport (his small-terminal overflow repro 2026-07-31) ----

   /** measured height of the tree panel Box (TreePanel measureElement); 0 = not measured yet */
   viewH: number = 0
   setViewH(h: number): void {
      this.viewH = h
   }

   /** rows available for tree content: measured panel height minus the panel's
    * own chrome (2 border rows, the filter line when visible, the loading
    * line). Pre-measure fallback: termRows minus the header+keybar estimate —
    * one frame only, the measurement replaces it. */
   get viewBudget(): number {
      const h = this.viewH > 0 ? this.viewH : Math.max(5, this.st.termRows - 5)
      const filterLine = this.filtering || this.filter !== '' ? 1 : 0
      const loadingLine = this.st.workflows.loading ? 1 : 0
      return Math.max(1, h - 2 - filterLine - loadingLine)
   }

   /** the visible slice, selection always inside, markers within the budget */
   get window(): ListWindow {
      return listWindow({ count: this.rows.length, selected: this.ix, budget: this.viewBudget })
   }

   /** esc/t inside the tree, → on a draft row, `v` anywhere: back to the vars list */
   blur(): void {
      this.filtering = false
      this.st.mode = 'nav'
   }

   move(delta: number): void {
      const len = this.rows.length
      if (len === 0) return
      this.ix = (this.ix + delta + len) % len
   }

   // ---- `/` filter ----

   beginFilter(): void {
      this.filtering = true
   }

   filterInput(ch: string): void {
      this.filter += ch
      this.clampToSelectable()
   }

   filterBackspace(): void {
      this.filter = this.filter.slice(0, -1)
      this.clampToSelectable()
   }

   /** esc while the filter owns the keys: drop it, stay in the tree */
   clearFilter(): void {
      this.filter = ''
      this.filtering = false
      this.clampToSelectable()
   }

   /** filter edits reshape rows: keep the cursor on a workflow row when one exists */
   private clampToSelectable(): void {
      const rows = this.rows
      this.ix = Math.min(this.ix, Math.max(0, rows.length - 1))
      if (rows[this.ix]?.kind !== 'workflow') {
         const first = rows.findIndex((r) => r.kind === 'workflow')
         if (first !== -1) this.ix = first
      }
   }

   /** →: unfold the dir/workflow under the cursor; on a draft row there is
    * nothing left to unfold, so → continues rightwards into the vars panel */
   unfold(): void {
      const row = this.selected
      if (row == null) return
      if (row.kind === 'dir') {
         this.collapsedDirs.delete(row.path)
         this.persistFolds()
      } else if (row.kind === 'workflow') this.expandedFiles.add(row.file)
      else this.blur()
   }

   /** ←: fold under the cursor; on an already-folded row, jump to the parent */
   fold(): void {
      const row = this.selected
      if (row == null) return
      if (row.kind === 'dir') {
         this.collapsedDirs.add(row.path)
         this.persistFolds()
         return
      }
      if (row.kind === 'draft') {
         const ix = this.rows.findIndex((r) => r.kind === 'workflow' && r.file === row.file)
         if (ix !== -1) this.ix = ix
         this.expandedFiles.delete(row.file)
         return
      }
      if (row.expanded) {
         this.expandedFiles.delete(row.file)
         return
      }
      // nothing to fold on the workflow itself: climb to its parent dir row
      for (let ix = this.ix - 1; ix >= 0; ix--) {
         const r = this.rows[ix]
         if (r?.kind === 'dir' && r.depth < row.depth) {
            this.ix = ix
            return
         }
      }
   }

   /** ⏎: toggle a dir, load the workflow (into 'default'), or load the exact draft */
   async commit(): Promise<void> {
      const row = this.selected
      if (row == null) return
      if (row.kind === 'dir') {
         if (this.filter !== '') return // folds are ignored under a filter: toggling would be a silent no-op
         if (row.expanded) this.collapsedDirs.add(row.path)
         else this.collapsedDirs.delete(row.path)
         this.persistFolds()
         return
      }
      // picking a result ends the filter session (the narrowed tree did its job)
      this.filter = ''
      this.filtering = false
      if (row.kind === 'workflow') return this.st.workflows.commit(row.file)
      return this.st.workflows.commit(row.file, row.draft)
   }

   /** n: new draft — current workflow only (a draft snapshots its LIVE var values) */
   promptNewDraft(): void {
      const row = this.selected
      if (row?.kind === 'dir') return
      if (row != null && row.file !== this.st.workflows.currentPath) {
         this.st.exec.notice = 'load that workflow first (⏎) — a new draft snapshots its live vars'
         return
      }
      this.st.drafts.promptNew('tree')
   }

   /** f2/c/x on a draft row: rename / duplicate / delete (file ops, work on ANY workflow's drafts) */
   draftOp(op: 'rename' | 'duplicate' | 'delete'): void {
      const row = this.selected
      if (row?.kind !== 'draft') {
         this.st.exec.notice = 'select a draft row (unfold a workflow with →)'
         return
      }
      if (op === 'rename') return this.st.drafts.promptRename(row.draft, row.file, 'tree')
      if (op === 'duplicate') return this.st.drafts.promptDuplicate(row.draft, row.file, 'tree')
      this.st.drafts.deleteDraft(row.draft, row.file)
      this.ix = Math.min(this.ix, Math.max(0, this.rows.length - 1))
   }
}
