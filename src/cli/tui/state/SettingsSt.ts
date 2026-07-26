import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { makeAutoObservable, reaction, runInAction } from 'mobx'
import { dirname } from 'pathe'
import { protocolCapable } from 'src/cli/tui/state/PreviewSt.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

export type PreviewMode = 'native' | 'ansi' | 'off'

/** persisted TUI settings at `.comfy-ts/settings.json` (LOCAL state, gitignored) */
export class SettingsSt {
   constructor(private st: TuiSt) {
      this.load()
      // a non-protocol terminal can't do native — fall the stored setting back to ansi
      if (this.previewMode === 'native' && !protocolCapable()) this.previewMode = 'ansi'
      makeAutoObservable<SettingsSt, 'st'>(this, { st: false })
      this.st.disposers.push(
         reaction(
            () => JSON.stringify({ previewMode: this.previewMode, lastDraft: this.lastDraft }),
            (json) => this.write(json),
            { delay: 300 },
         ),
      )
   }

   previewMode: PreviewMode = protocolCapable() ? 'native' : 'ansi'
   /** module basename → the draft that was active last time (reopened on load) */
   lastDraft: Record<string, string> = {}

   setPreviewMode(mode: PreviewMode): void {
      this.previewMode = mode
      this.st.preview.onModeChanged()
   }

   /** `p` cycles native → ansi → off (native skipped when the terminal can't do it) */
   cyclePreviewMode(): void {
      const order: PreviewMode[] = protocolCapable() ? ['native', 'ansi', 'off'] : ['ansi', 'off']
      const next = order[(order.indexOf(this.previewMode) + 1) % order.length] ?? 'off'
      this.setPreviewMode(next)
      this.st.exec.notice = `preview: ${next}`
   }

   rememberDraft(moduleKey: string, draft: string): void {
      this.lastDraft[moduleKey] = draft
   }

   private load(): void {
      const path = comfyts.settingsPath
      if (!existsSync(path)) return
      try {
         const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
         if (raw == null || typeof raw !== 'object') return
         const o = raw as { previewMode?: unknown; lastDraft?: unknown }
         if (o.previewMode === 'native' || o.previewMode === 'ansi' || o.previewMode === 'off')
            this.previewMode = o.previewMode
         if (o.lastDraft != null && typeof o.lastDraft === 'object')
            this.lastDraft = { ...(o.lastDraft as Record<string, string>) }
      } catch {
         // corrupt settings must never block the TUI — start from defaults
      }
   }

   private write(json: string): void {
      const path = comfyts.settingsPath
      try {
         mkdirSync(dirname(path), { recursive: true })
         writeFileSync(path, json)
      } catch (e) {
         runInAction(() => {
            this.st.exec.notice = `settings save failed: ${String(e)}`
         })
      }
   }
}
