import { makeAutoObservable, runInAction } from 'mobx'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { stripAnsi } from 'src/utils/ansi.ts'
import type { LogEntry } from 'src/runner/ComfyWsApi.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

const MAX_LINES = 400

/** fold write chunks into p.lines (mutated), returns the new partial tail.
 * `\n` commits a line, `\r` resets the partial (tqdm redraws collapse to
 * their last state), ANSI stripped, blank lines dropped. */
export function assembleLogChunks(p: { lines: string[]; partial: string; entries: LogEntry[] }): string {
   let partial = p.partial
   for (const entry of p.entries) {
      for (const piece of stripAnsi(entry.m).split(/(\r\n|\n|\r)/)) {
         if (piece === '\n' || piece === '\r\n') {
            if (partial.trim() !== '') p.lines.push(partial)
            partial = ''
         } else if (piece === '\r') {
            partial = ''
         } else if (piece !== '') {
            partial += piece
         }
      }
   }
   return partial
}

/** server console mirror: /internal/logs/raw backfill + ws 'logs' stream.
 * Entries are write CHUNKS, not lines — assembled here (`\n` commits,
 * `\r` resets the partial, so tqdm redraws collapse to their last state). */
export class LogsSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<LogsSt, 'st'>(this, { st: false })
      this.attach(this.st.wf.host)
      this.st.disposers.push(() => {
         if (this.attached != null) {
            this.attached.onLogs = null
            this.attached.onSession = null
         }
      })
   }

   lines: string[] = []
   /** chunk tail not yet closed by \n — rendered live (tqdm progress) */
   partial: string = ''

   private attached: ComfyHost | null = null

   /** follow the CURRENT workflow's host (re-called on workflow switch) */
   attach(host: ComfyHost): void {
      if (this.attached === host) return
      if (this.attached != null) {
         this.attached.onLogs = null
         this.attached.onSession = null
         // best-effort: switched-away hosts stay connected (loadedHosts), so
         // without this their ws keeps carrying chunks nobody reads; the
         // server drops the sub on disconnect anyway, hence the swallowed error
         if (this.attached.isConnected && this.attached.comfySessionId !== 'temp') {
            void this.attached.subscribeLogs({ enabled: false, clientId: this.attached.comfySessionId }).catch(() => {})
         }
      }
      this.attached = host
      this.lines = []
      this.partial = ''
      host.onLogs = (p) => this.feed(p.entries)
      // per-sid server state: every (re)connect needs a fresh subscribe
      host.onSession = (sid) => void this.hydrate(host, sid)
      if (host.isConnected && host.comfySessionId !== 'temp') void this.hydrate(host, host.comfySessionId)
   }

   /** backfill BEFORE subscribe: entries emitted in the gap are lost, which is
    * the right trade — the reverse order would clobber streamed entries at the
    * reset, and the backfill re-covers the recent past anyway */
   private async hydrate(host: ComfyHost, sid: string): Promise<void> {
      try {
         const raw = await host.fetchRawLogs()
         // attach() switched hosts or the sid rolled again mid-fetch: stale snapshot
         if (this.attached !== host || host.comfySessionId !== sid) return
         runInAction(() => {
            this.lines = []
            this.partial = ''
         })
         this.feed(raw.entries)
         await host.subscribeLogs({ enabled: true, clientId: sid })
      } catch (e) {
         if (this.attached !== host) return
         // the panel is the loud surface: stream failures land as a log line
         this.feed([{ t: '', m: `[comfy-ts] server log stream unavailable: ${extractErrorMessage(e)}\n` }])
      }
   }

   feed(entries: LogEntry[]): void {
      runInAction(() => {
         this.partial = assembleLogChunks({ lines: this.lines, partial: this.partial, entries })
         if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES)
      })
   }

   /** last rows to render, live partial included */
   tail(n: number): string[] {
      const rows = this.partial.trim() !== '' ? [...this.lines, this.partial] : this.lines
      return rows.slice(-n)
   }
}
