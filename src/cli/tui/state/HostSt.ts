import { makeAutoObservable, runInAction } from 'mobx'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

type HostAction = { key: 'refresh' | 'restart' | 'clear-queue' | 'interrupt'; label: string }

/** host panel (`h`): stats about the connected host + maintenance actions */
export class HostSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<HostSt, 'st'>(this, { st: false })
   }

   ix: number = 0
   /** action key while one runs (actions are serialized) */
   running: HostAction['key'] | null = null

   readonly actions: HostAction[] = [
      { key: 'refresh', label: 're-codegen SDK (refetch object_info + reload workflow)' },
      { key: 'restart', label: 'restart ComfyUI (manager reboot)' },
      { key: 'clear-queue', label: 'clear pending queue' },
      { key: 'interrupt', label: 'interrupt current run' },
   ]

   get host(): ComfyHost {
      return this.st.wf.host
   }

   get stats(): { label: string; value: string }[] {
      const schema = this.host.schema
      return [
         { label: 'node types', value: String(schema.nodes.length) },
         { label: 'loras', value: String(schema.getLoras().length) },
         { label: 'embeddings', value: String(schema.data.embeddings.length) },
         { label: 'queue', value: String(this.st.queue.remaining) },
         { label: 'ws', value: this.host.getWSUrl() },
      ]
   }

   begin(): void {
      this.st.mode = 'host'
      this.ix = 0
   }

   blur(): void {
      this.st.mode = 'nav'
   }

   move(delta: number): void {
      const len = this.actions.length
      this.ix = (this.ix + delta + len) % len
   }

   async commit(): Promise<void> {
      const action = this.actions[this.ix]
      if (action == null || this.running != null) return
      if (action.key === 'refresh') return this.refreshSdk()
      if (action.key === 'restart') return this.restartComfy()
      if (action.key === 'clear-queue') return this.st.queue.clearPending()
      return this.st.queue.interrupt()
   }

   /** refetch object_info, regen the sdk, then cache-busted reload of the current
    * module so dynamic var options (v.loras…) see the new values */
   private async refreshSdk(): Promise<void> {
      runInAction(() => {
         this.running = 'refresh'
      })
      try {
         await this.host.fetchAndUpdateSchema()
         await this.st.workflows.reload(this.st.drafts.active ?? 'default')
         runInAction(() => {
            const schema = this.host.schema
            this.st.exec.notice = `SDK regenerated: ${schema.nodes.length} node types, ${schema.getLoras().length} loras`
         })
      } catch (e) {
         runInAction(() => {
            this.st.exec.error = extractErrorMessage(e)
         })
      } finally {
         runInAction(() => {
            this.running = null
         })
      }
   }

   private async restartComfy(): Promise<void> {
      runInAction(() => {
         this.running = 'restart'
      })
      try {
         await this.host.manager.restartComfyUI()
         runInAction(() => {
            this.st.exec.notice = 'reboot requested — the ws reconnects when the host is back'
         })
      } catch (e) {
         // the server dropping the connection mid-reboot IS the expected shape
         runInAction(() => {
            this.st.exec.notice = `reboot requested (${extractErrorMessage(e)}) — the ws reconnects when the host is back`
         })
      } finally {
         runInAction(() => {
            this.running = null
         })
      }
   }
}
