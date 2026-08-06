import { makeAutoObservable, reaction, runInAction } from 'mobx'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

type HostAction = { key: 'refresh' | 'restart' | 'clear-queue' | 'interrupt'; label: string }

export type HostStatus = 'unknown' | 'up' | 'down'

const PROBE_EVERY_MS = 5000
const PROBE_TIMEOUT_MS = 3000
/** ws message younger than this = the host is alive, whatever http says */
export const WS_ALIVE_MS = 10_000

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * PURE probe verdict (headless-tested). http ok is proof enough; on http
 * failure a RECENTLY TALKING open ws still means up — ComfyUI is
 * single-threaded and stalls new connects mid-generation while established
 * sockets stream (observed: a host shown 'offline' in the header
 * while the browser tab generated fine). A half-open socket receives
 * nothing, so the recency window never revives one.
 */
export function probeVerdict(p: { httpOk: boolean; wsOpen: boolean; lastWsMessageAt: number | null; now: number }): {
   status: HostStatus
   via: 'ws' | 'http' | null
} {
   if (p.httpOk) return { status: 'up', via: p.wsOpen ? 'ws' : 'http' }
   if (p.wsOpen && p.lastWsMessageAt != null && p.now - p.lastWsMessageAt < WS_ALIVE_MS)
      return { status: 'up', via: 'ws' }
   return { status: 'down', via: null }
}

/** host panel (`h`): stats about the connected host + maintenance actions */
export class HostSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<HostSt, 'st'>(this, { st: false })
      void this.probeLoop()
      this.st.disposers.push(() => {
         this.disposed = true
         if (this.loopTimer != null) clearTimeout(this.loopTimer)
         if (this.spinTimer != null) clearInterval(this.spinTimer)
         if (this.countdownTimer != null) clearInterval(this.countdownTimer)
      })
      // switching workflows (or the `h` override) can switch hosts: back to
      // unknown, re-probe now. probeGen++ kills a chain that is mid-await (its
      // loopTimer isn't set yet, clearing timers alone would leave it alive →
      // duplicate chains forever)
      this.st.disposers.push(
         reaction(
            () => this.st.runHost,
            () => {
               runInAction(() => {
                  this.status = 'unknown'
                  this.statusVia = null
                  this.lastProbeError = null // the previous host's failure must not show under the new one
               })
               this.probeGen++
               if (this.loopTimer != null) clearTimeout(this.loopTimer)
               if (this.countdownTimer != null) clearInterval(this.countdownTimer)
               void this.probeLoop()
            },
         ),
      )
   }

   /** live reachability — down is a state, not an error: the dot is the loud surface */
   status: HostStatus = 'unknown'
   /** 'ws' when the live socket is open, 'http' when only the probe reaches the host */
   statusVia: 'ws' | 'http' | null = null
   /** why the last http probe failed (timeout, dns, http status) — the stats panel shows it */
   lastProbeError: string | null = null
   /** a probe is in flight (drives the spinner while down) */
   probing: boolean = false
   /** seconds until the next probe (shown while down) */
   retryInS: number = 0
   spinFrame: number = 0

   private disposed = false
   private probeGen = 0
   private loopTimer: NodeJS.Timeout | null = null
   private spinTimer: NodeJS.Timeout | null = null
   private countdownTimer: NodeJS.Timeout | null = null

   get spinner(): string {
      return SPIN_FRAMES[this.spinFrame % SPIN_FRAMES.length] ?? '⠋'
   }

   /** probe → schedule the next one (setTimeout chain: the countdown is exact) */
   private async probeLoop(): Promise<void> {
      const gen = this.probeGen
      await this.probe()
      if (this.disposed || gen !== this.probeGen) return
      const nextAt = Date.now() + PROBE_EVERY_MS
      runInAction(() => {
         this.retryInS = Math.ceil(PROBE_EVERY_MS / 1000)
      })
      if (this.countdownTimer != null) clearInterval(this.countdownTimer)
      this.countdownTimer = setInterval(() => {
         runInAction(() => {
            this.retryInS = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000))
         })
      }, 250)
      this.countdownTimer.unref?.()
      this.loopTimer = setTimeout(() => {
         if (this.countdownTimer != null) clearInterval(this.countdownTimer)
         void this.probeLoop()
      }, PROBE_EVERY_MS)
      this.loopTimer.unref?.()
   }

   /** http first — a half-open ws keeps isOpen=true forever, so isOpen alone
    * is never trusted. RECENT MESSAGES are: probeVerdict lets a talking ws
    * beat a stalled http probe (busy single-threaded server) */
   private async probe(): Promise<void> {
      const host = this.host
      runInAction(() => {
         this.probing = true
      })
      // spin interval is LOCAL: an old probe overlapping a reaction-started new
      // one must only clear its own, and only the installed one drives the flag
      const spin = setInterval(() => {
         runInAction(() => {
            this.spinFrame++
         })
      }, 120)
      spin.unref?.()
      this.spinTimer = spin
      let ok = false
      let probeError: string | null = null
      try {
         // host.fetch: /api preferred + auth header, so cloud hosts probe up too
         const res = await host.fetch('/prompt', { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
         void res.body?.cancel()
         ok = res.ok
         if (!ok) probeError = `http ${res.status}`
      } catch (e) {
         ok = false
         probeError = extractErrorMessage(e)
      } finally {
         clearInterval(spin)
         if (this.spinTimer === spin) {
            this.spinTimer = null
            runInAction(() => {
               this.probing = false
            })
         }
      }
      if (this.host !== host) return // workflow switched mid-flight: stale verdict
      const verdict = probeVerdict({
         httpOk: ok,
         wsOpen: host.isConnected,
         lastWsMessageAt: host.lastWsMessageAt,
         now: Date.now(),
      })
      runInAction(() => {
         this.status = verdict.status
         this.statusVia = verdict.via
         this.lastProbeError = probeError
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
      return this.st.runHost
   }

   get stats(): { label: string; value: string }[] {
      const schema = this.host.schema
      return [
         {
            label: 'status',
            value:
               this.status === 'down'
                  ? `down · ${this.probing ? `${this.spinner} probing…` : `retry in ${this.retryInS}s`}`
                  : this.status + (this.statusVia != null ? ` (${this.statusVia})` : ''),
         },
         // the WHY behind a down dot (or an up-via-ws with http stalling: busy server)
         ...(this.lastProbeError != null ? [{ label: 'http probe', value: this.lastProbeError }] : []),
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

   // ---- `h` host picker: override the host the current workflow runs against ----

   pickerIx: number = 0

   get pickerRows(): { host: ComfyHost | null; label: string; active: boolean }[] {
      const wfHost = this.st.wf.host
      const rows: { host: ComfyHost | null; label: string; active: boolean }[] = [
         { host: null, label: `workflow default (${wfHost.data.id})`, active: this.st.hostOverride == null },
      ]
      // the global registry: every host any imported module registered so far
      for (const host of comfyts.hosts.values()) {
         rows.push({
            host,
            label: `${host.data.id} (${host.base.host}:${host.base.port})`,
            active: this.st.hostOverride === host,
         })
      }
      return rows
   }

   beginPicker(): void {
      this.st.mode = 'overlay-hosts'
      const active = this.pickerRows.findIndex((r) => r.active)
      this.pickerIx = active === -1 ? 0 : active
   }

   cancelPicker(): void {
      this.st.mode = 'nav'
   }

   pickerMove(delta: number): void {
      const len = this.pickerRows.length
      if (len === 0) return
      this.pickerIx = (this.pickerIx + delta + len) % len
   }

   commitPicker(): void {
      const row = this.pickerRows[this.pickerIx]
      if (row == null) return
      this.st.setHostOverride(row.host)
      this.st.mode = 'nav'
      this.st.exec.notice =
         row.host == null
            ? `host override cleared — runs target the workflow's own host (${this.st.wf.host.data.id})`
            : `runs now target ${row.host.data.id} (overrides ${this.st.wf.host.data.id})`
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
         // restartComfyUI already resolves on the mid-reboot disconnect, so an error here is a
         // host that REFUSED. Reporting it as "requested" is how a dead button looks alive
         runInAction(() => {
            this.st.exec.notice = `🔴 reboot refused: ${extractErrorMessage(e)}`
         })
      } finally {
         runInAction(() => {
            this.running = null
         })
      }
   }
}
