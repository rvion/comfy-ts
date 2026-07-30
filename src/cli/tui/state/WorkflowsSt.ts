import { pathToFileURL } from 'node:url'
import { makeAutoObservable, runInAction } from 'mobx'
import { basename, resolve } from 'pathe'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { findDefinedWorkflow } from 'src/cli/tui/findDefinedWorkflow.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { DefinedWorkflow } from 'src/vars/DefinedWorkflow.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** workflow-module data layer: scanned files, module loading, opened-host set (TreeSt is the UI over it) */
export class WorkflowsSt {
   constructor(
      private st: TuiSt,
      public files: string[],
      currentPath: string | null = null,
      bundled: Set<string> = new Set(),
      loadErrors: Map<string, string> = new Map(),
   ) {
      this.currentPath = currentPath
      this.bundled = bundled
      this.loadErrors = loadErrors
      makeAutoObservable<WorkflowsSt, 'st'>(this, { st: false })
   }

   /** path of the currently loaded workflow module (display + selection) */
   currentPath: string | null
   loading: boolean = false

   /** the subset of files that came from the PACKAGED examples (grouped apart in the tree) */
   bundled: Set<string>

   /** per-file load failures (import threw / no DefinedWorkflow export) — red rows in the tree,
    * cleared by a later successful load; ⏎ on the row retries */
   loadErrors: Map<string, string>

   /** spec.color of every module seen loading — overrides the tree's family palette */
   specColors: Map<string, string> = new Map()

   recordSpecColor(path: string, wf: DefinedWorkflow): void {
      if (wf.spec.color != null) this.specColors.set(path, wf.spec.color)
   }

   /**
    * every host seen across switches. Modules are import-cached, so a
    * switched-away host must stay connected (switching back reuses it) — exit
    * disconnects them all.
    */
   loadedHosts: Set<ComfyHost> = new Set()

   disconnectAllHosts(): void {
      this.loadedHosts.add(this.st.wf.host)
      for (const host of this.loadedHosts) host.disconnect()
   }

   /** load a workflow module; `draft` null => the remembered draft, else that exact draft */
   async commit(path: string, draft: string | null = null): Promise<void> {
      if (path === this.currentPath) {
         // same module: only the draft changes
         if (this.loading) return
         if (draft == null) this.st.drafts.activateRemembered()
         else this.st.drafts.activate(draft)
         this.st.mode = 'nav'
         return
      }
      return this.load(path, draft, false)
   }

   /** cache-busted re-import of the CURRENT module: defineWorkflow re-executes,
    * so dynamic var option lists (v.loras over getLoras()…) pick up fresh schema values */
   async reload(draft: string): Promise<void> {
      const path = this.currentPath
      if (path == null) return
      return this.load(path, draft, true)
   }

   private async load(path: string, draft: string | null, bustCache: boolean): Promise<void> {
      if (this.loading) return
      runInAction(() => {
         this.loading = true
      })
      try {
         const url = pathToFileURL(resolve(path)).href + (bustCache ? `?v=${Date.now()}` : '')
         const mod: Record<string, unknown> = await import(url)
         const wf = findDefinedWorkflow(mod)
         if (wf == null) throw new Error(`${path} exports no DefinedWorkflow`)
         runInAction(() => {
            this.loadErrors.delete(path)
            this.loadedHosts.add(this.st.wf.host)
            this.loadedHosts.add(wf.host)
            this.recordSpecColor(path, wf)
            this.st.wf = wf
            // a module import may have registered the host a persisted override names
            this.st.applyPersistedHostOverride()
            this.st.queue.attach(this.st.runHost)
            this.st.logs.attach(this.st.runHost)
            this.currentPath = path
            this.st.settings.lastWorkflow = path
            this.st.selIx = 0
            this.st.mode = 'nav'
            this.st.exec.resetForWorkflow(`${basename(path)}`)
            // after the reset: a bad draft json must stay visible as exec.error
            if (draft == null) this.st.drafts.activateRemembered()
            else this.st.drafts.activate(draft)
            this.st.preview.reset()
         })
      } catch (e) {
         runInAction(() => {
            const msg = extractErrorMessage(e)
            this.loadErrors.set(path, msg)
            this.st.mode = 'nav'
            this.st.exec.error = msg
         })
      } finally {
         runInAction(() => {
            this.loading = false
         })
      }
   }
}
