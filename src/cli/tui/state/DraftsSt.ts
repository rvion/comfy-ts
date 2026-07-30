import {
   copyFileSync,
   existsSync,
   mkdirSync,
   readdirSync,
   readFileSync,
   renameSync,
   rmSync,
   writeFileSync,
} from 'node:fs'
import { makeAutoObservable, reaction } from 'mobx'
import { dirname, join } from 'pathe'
import { moduleName } from 'src/cli/tui/treeRows.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import type { TuiMode, TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** module basename (`01-txt2img`) keys the draft folder — knowable for EVERY tree file without importing it */
export function draftKeyForFile(file: string): string {
   return moduleName(file)
}

export function draftsDirForFile(file: string): string {
   return comfyts.resolveFromDrafts(draftKeyForFile(file))
}

function listDraftsInDir(dir: string): string[] {
   if (!existsSync(dir)) return []
   return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort()
}

/** draft names stored for a workflow module (fs read — pair with DraftsSt.version for reactivity) */
export function listDraftsForFile(file: string): string[] {
   return listDraftsInDir(draftsDirForFile(file))
}

/**
 * named var-value snapshots at `.comfy-ts/drafts/<module-basename>/<name>.json`
 * (LOCAL state, gitignored). The active draft autosaves debounced; the TUI is
 * ALWAYS in a draft (`default` unless another one is activated).
 */
export class DraftsSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<DraftsSt, 'st'>(this, { st: false })
      // active-draft autosave: var values + draft name are observable
      this.st.disposers.push(
         reaction(
            () => (this.active == null ? null : JSON.stringify(this.snapshot())),
            (json) => {
               if (json != null && this.active != null) this.write(this.active, json)
            },
            { delay: 300 },
         ),
      )
   }

   /** ALWAYS set after construction; null only transiently while activate() loads values */
   active: string | null = null
   list: string[] = []
   ix: number = 0
   /** bumped on every fs write/rename so fs-derived getters (tree rows) recompute */
   version: number = 0

   private get dir(): string {
      const cur = this.st.workflows.currentPath
      return cur != null ? draftsDirForFile(cur) : comfyts.resolveFromDrafts(this.st.wf.spec.id ?? 'workflow')
   }

   private snapshot(): Record<string, unknown> {
      // toJSON so seed persists {mode, value}; other vars round-trip their value
      return Object.fromEntries(this.st.entries.map(([k, varDef]) => [k, varDef.toJSON()]))
   }

   private write(name: string, json: string): void {
      const path = join(this.dir, `${name}.json`)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, json)
      this.version++
   }

   /** module key of the currently loaded workflow (settings.lastDraft is keyed by it) */
   private get moduleKey(): string {
      const cur = this.st.workflows.currentPath
      return cur != null ? draftKeyForFile(cur) : (this.st.wf.spec.id ?? 'workflow')
   }

   /** switch to a draft: load its stored values when the file exists, else it starts from current values */
   activate(name: string): void {
      this.active = null // the autosave expression must not see old values under the new name
      const path = join(this.dir, `${name}.json`)
      if (existsSync(path)) {
         try {
            const values: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf8'))
            for (const [k, varDef] of this.st.entries) if (k in values) varDef.loadJSON(values[k])
         } catch (e) {
            this.st.exec.error = extractErrorMessage(e)
         }
      }
      this.active = name
      this.st.settings.rememberDraft(this.moduleKey, name)
   }

   /** open the draft this workflow was last in (settings), else 'default' */
   activateRemembered(): void {
      const remembered = this.st.settings.lastDraft[this.moduleKey]
      if (remembered != null && remembered !== 'default' && existsSync(join(this.dir, `${remembered}.json`)))
         this.activate(remembered)
      else this.activate('default')
   }

   /** every workflow starts in a draft; kept for callers that want 'default' explicitly */
   activateDefault(): void {
      this.activate('default')
   }

   // ---- draft CRUD (also drives the tree's draft rows — `file` overrides the target workflow) ----

   private dirFor(file: string | undefined): string {
      return file != null ? draftsDirForFile(file) : this.dir
   }

   /** true when ops on `file` touch the ACTIVE draft bookkeeping */
   private isCurrent(file: string | undefined): boolean {
      return file == null || file === this.st.workflows.currentPath
   }

   private validName(rawName: string): string | null {
      const name = rawName.trim()
      if (/^[\w][\w .-]*$/.test(name)) return name
      this.st.exec.notice = `invalid draft name: '${rawName}'`
      return null
   }

   /** create a NEW draft from the current var values (current workflow only) */
   createNamed(rawName: string): boolean {
      const name = this.validName(rawName)
      if (name == null) return false
      if (existsSync(join(this.dir, `${name}.json`))) {
         this.st.exec.notice = `draft '${name}' already exists`
         return false
      }
      this.write(name, JSON.stringify(this.snapshot(), null, 2))
      this.active = name
      this.st.settings.rememberDraft(this.moduleKey, name)
      this.st.exec.notice = `new draft: ${name} (autosaves)`
      return true
   }

   rename(oldName: string, rawName: string, file?: string): boolean {
      const newName = this.validName(rawName)
      if (newName == null) return false
      if (newName === oldName) return true
      const dir = this.dirFor(file)
      const to = join(dir, `${newName}.json`)
      if (existsSync(to)) {
         this.st.exec.notice = `draft '${newName}' already exists`
         return false
      }
      const from = join(dir, `${oldName}.json`)
      if (existsSync(from)) renameSync(from, to)
      else if (this.isCurrent(file)) this.write(newName, JSON.stringify(this.snapshot(), null, 2))
      if (this.isCurrent(file) && this.active === oldName) {
         this.active = newName
         this.st.settings.rememberDraft(this.moduleKey, newName)
      }
      this.version++
      this.st.exec.notice = `draft renamed: ${oldName} → ${newName}`
      return true
   }

   duplicate(name: string, rawName: string, file?: string): boolean {
      const newName = this.validName(rawName)
      if (newName == null) return false
      const dir = this.dirFor(file)
      const from = join(dir, `${name}.json`)
      const to = join(dir, `${newName}.json`)
      if (!existsSync(from)) {
         this.st.exec.notice = `draft '${name}' has no file yet (edit a var first)`
         return false
      }
      if (existsSync(to)) {
         this.st.exec.notice = `draft '${newName}' already exists`
         return false
      }
      copyFileSync(from, to)
      this.version++
      this.st.exec.notice = `draft duplicated: ${name} → ${newName}`
      return true
   }

   deleteDraft(name: string, file?: string): void {
      const path = join(this.dirFor(file), `${name}.json`)
      if (existsSync(path)) rmSync(path)
      this.version++
      // deleting the draft you are IN falls back to default
      if (this.isCurrent(file) && this.active === name) this.activateDefault()
      this.st.exec.notice = `draft deleted: ${name}`
   }

   // ---- name prompts (ONE mechanism: EditorSt custom session → PromptOverlay) ----

   promptNew(returnMode: TuiMode = 'nav'): void {
      this.st.editor.beginCustom({
         title: 'new draft (from current values)',
         initial: '',
         onCommit: (raw) => {
            const ok = this.createNamed(raw)
            if (ok && returnMode === 'overlay-drafts') this.begin()
            return ok
         },
         returnMode,
      })
   }

   promptRename(name: string, file?: string, returnMode: TuiMode = 'nav'): void {
      this.st.editor.beginCustom({
         title: `rename draft '${name}'`,
         initial: name,
         onCommit: (raw) => {
            const ok = this.rename(name, raw, file)
            if (ok && returnMode === 'overlay-drafts') this.begin()
            return ok
         },
         returnMode,
      })
   }

   promptDuplicate(name: string, file?: string, returnMode: TuiMode = 'nav'): void {
      this.st.editor.beginCustom({
         title: `duplicate draft '${name}'`,
         initial: `${name}-copy`,
         onCommit: (raw) => {
            const ok = this.duplicate(name, raw, file)
            if (ok && returnMode === 'overlay-drafts') this.begin()
            return ok
         },
         returnMode,
      })
   }

   /** f2 in nav: rename the ACTIVE draft */
   beginRename(): void {
      this.promptRename(this.active ?? 'default')
   }

   begin(): void {
      this.list = listDraftsInDir(this.dir)
      this.st.mode = 'overlay-drafts'
      const ix = this.active == null ? -1 : this.list.indexOf(this.active)
      // row 0 = "new draft", rows 1.. = existing drafts
      this.ix = ix === -1 ? 0 : ix + 1
   }

   move(delta: number): void {
      const len = this.list.length + 1
      this.ix = (this.ix + delta + len) % len
   }

   /** draft name under the overlay cursor (row 0 is 'new') */
   get selectedName(): string | null {
      return this.ix === 0 ? null : (this.list[this.ix - 1] ?? null)
   }

   commit(): void {
      if (this.ix === 0) return this.promptNew('overlay-drafts')
      const name = this.selectedName
      if (name == null) return
      this.activate(name)
      this.st.exec.notice = `draft: ${name} (autosaves)`
      this.st.mode = 'nav'
   }
}
