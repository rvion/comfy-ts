import { makeAutoObservable } from 'mobx'
import { draftKeyForFile, listDraftsForFile } from 'src/cli/tui/state/DraftsSt.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

export type TreeRow =
   | { kind: 'section'; label: string } // dim group header (bundled examples), never selectable
   | {
        kind: 'workflow'
        file: string
        name: string
        expanded: boolean
        current: boolean
        hasDrafts: boolean
        error: string | null
     }
   | { kind: 'draft'; file: string; draft: string; active: boolean }

/** the left `(t)ree`: workflows with their drafts nested under them */
export class TreeSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<TreeSt, 'st'>(this, { st: false })
   }

   ix: number = 0
   expandedFiles: Set<string> = new Set()

   get rows(): TreeRow[] {
      void this.st.drafts.version // fs-derived: recompute when drafts change
      const w = this.st.workflows
      const rows: TreeRow[] = []
      let sectionPushed = false
      for (const file of w.files) {
         // bundled examples come LAST in files: one section header before the first
         if (!sectionPushed && w.bundled.has(file)) {
            rows.push({ kind: 'section', label: 'comfy-ts examples' })
            sectionPushed = true
         }
         const current = file === w.currentPath
         const expanded = this.expandedFiles.has(file)
         const drafts = listDraftsForFile(file)
         rows.push({
            kind: 'workflow',
            file,
            name: draftKeyForFile(file),
            expanded,
            current,
            hasDrafts: drafts.length > 0,
            error: w.loadErrors.get(file) ?? null,
         })
         if (!expanded) continue
         for (const draft of drafts) {
            rows.push({ kind: 'draft', file, draft, active: current && draft === this.st.drafts.active })
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
      if (w.currentPath != null) this.expandedFiles.add(w.currentPath)
      this.st.mode = 'tree'
      const rows = this.rows
      const draftIx = rows.findIndex((r) => r.kind === 'draft' && r.active)
      const ix = draftIx === -1 ? rows.findIndex((r) => r.kind === 'workflow' && r.current) : draftIx
      this.ix = ix === -1 ? 0 : ix
   }

   /** esc/t inside the tree, → on a draft row, `v` anywhere: back to the vars list */
   blur(): void {
      this.st.mode = 'nav'
   }

   move(delta: number): void {
      const rows = this.rows
      const len = rows.length
      if (len === 0) return
      let ix = this.ix
      // hop over section headers (never selectable); bounded: wraps at most once
      for (let step = 0; step < len; step++) {
         ix = (ix + delta + len) % len
         if (rows[ix]?.kind !== 'section') break
      }
      this.ix = ix
   }

   /** →: unfold the workflow under the cursor; on a draft row there is nothing
    * left to unfold, so → continues rightwards into the vars panel */
   unfold(): void {
      const row = this.selected
      if (row == null || row.kind === 'section') return
      if (row.kind === 'workflow') this.expandedFiles.add(row.file)
      else this.blur()
   }

   /** ←: fold the workflow under the cursor; on a draft row, jump to (and fold) its parent */
   fold(): void {
      const row = this.selected
      if (row == null || row.kind === 'section') return
      this.expandedFiles.delete(row.file)
      if (row.kind === 'draft') {
         const ix = this.rows.findIndex((r) => r.kind === 'workflow' && r.file === row.file)
         if (ix !== -1) this.ix = ix
      }
   }

   /** ⏎: load the workflow (into 'default'), or the exact draft under the cursor */
   async commit(): Promise<void> {
      const row = this.selected
      if (row == null || row.kind === 'section') return
      if (row.kind === 'workflow') return this.st.workflows.commit(row.file)
      return this.st.workflows.commit(row.file, row.draft)
   }

   /** n: new draft — current workflow only (a draft snapshots its LIVE var values) */
   promptNewDraft(): void {
      const row = this.selected
      if (row?.kind === 'section') return
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
