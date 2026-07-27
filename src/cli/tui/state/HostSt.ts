import { makeAutoObservable, reaction, runInAction } from 'mobx'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

type HostAction = { key: 'refresh' | 'restart' | 'clear-queue' | 'interrupt'; label: string }

export type HostStatus = 'unknown' | 'up' | 'down'

const PROBE_EVERY_MS = 5000
const PROBE_TIMEOUT_MS = 3000

/** host panel (`h`): stats about the connected host + maintenance actions */
export class HostSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<HostSt, 'st'>(this, { st: false })
      void this.probe()
      const timer = setInterval(() => void this.probe(), PROBE_EVERY_MS)
      timer.unref?.()
      this.st.disposers.push(() => clearInterval(timer))
      // switching workflows can switch hosts: back to unknown, re-probe now
      this.st.disposers.push(
         reaction(
            () => this.st.wf,
            () => {
               runInAction(() => {
                  this.status = 'unknown'
                  this.statusVia = null
               })
               void this.probe()
            },
         ),
      )
   }

   /** live reachability — down is a state, not an error: the dot is the loud surface */
   status: HostStatus = 'unknown'
   /** 'ws' when the live socket is open, 'http' when only the probe reaches the host */
   statusVia: 'ws' | 'http' | null = null

   /** http is the ground truth: a half-open ws keeps isOpen=true forever, and
    * trusting it would re-create the exact silent-death this dot exists to expose */
   private async probe(): Promise<void> {
      const host = this.host
      let ok = false
      try {
         const res = await fetch(`${host.getServerHostHTTP()}/api/prompt`, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
         })
         void res.body?.cancel()
         ok = res.ok
      } catch {
         ok = false
      }
      if (this.host !== host) return // workflow switched mid-flight: stale verdict
      runInAction(() => {
         this.status = ok ? 'up' : 'down'
         this.statusVia = ok ? (host.isConnected ? 'ws' : 'http') : null
      })
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
         { label: 'status', value: this.status + (this.statusVia != null ? ` (${this.statusVia})` : '') },
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
