import { makeAutoObservable, runInAction } from 'mobx'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** live server queue length (ws 'status' messages) + queue actions */
export class QueueSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<QueueSt, 'st'>(this, { st: false })
      this.attach(this.st.wf.host)
      this.st.disposers.push(() => {
         if (this.attached != null) this.attached.onStatus = null
      })
   }

   /** prompts waiting on the server (excludes the one running) */
   remaining: number = 0

   private attached: ComfyHost | null = null

   /** follow the CURRENT workflow's host (re-called on workflow switch) */
   attach(host: ComfyHost): void {
      if (this.attached === host) return
      if (this.attached != null) this.attached.onStatus = null
      this.attached = host
      this.remaining = 0
      host.onStatus = (p) => {
         runInAction(() => {
            this.remaining = p.queueRemaining
         })
      }
   }

   async clearPending(): Promise<void> {
      try {
         await this.st.wf.host.clearQueue()
         runInAction(() => {
            this.st.exec.notice = 'pending queue cleared'
         })
      } catch (e) {
         runInAction(() => {
            this.st.exec.error = extractErrorMessage(e)
         })
      }
   }

   async interrupt(): Promise<void> {
      try {
         await this.st.wf.host.interrupt()
         runInAction(() => {
            this.st.exec.notice = 'interrupt requested'
         })
      } catch (e) {
         runInAction(() => {
            this.st.exec.error = extractErrorMessage(e)
         })
      }
   }
}
