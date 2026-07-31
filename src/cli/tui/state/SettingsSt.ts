import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { makeAutoObservable, reaction, runInAction } from 'mobx'
import { dirname } from 'pathe'
import { protocolCapable } from 'src/cli/tui/state/PreviewSt.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

export type PreviewRenderer = 'native' | 'pixel'
export type PreviewDuringRun = 'latent' | 'latent-small' | 'last-output'

export type PreviewSettings = {
   previewPanel: boolean
   previewRenderer: PreviewRenderer
   previewDuringRun: PreviewDuringRun
}

/** read stored preview settings, migrating the legacy single `previewMode`
 * (native|ansi|off) into the three independent axes */
export function migratePreviewSettings(raw: Record<string, unknown>, defaults: PreviewSettings): PreviewSettings {
   const out = { ...defaults }
   const legacy = raw.previewMode
   if (legacy === 'native') out.previewRenderer = 'native'
   if (legacy === 'ansi') out.previewRenderer = 'pixel'
   if (legacy === 'off') out.previewPanel = false
   if (typeof raw.previewPanel === 'boolean') out.previewPanel = raw.previewPanel
   if (raw.previewRenderer === 'native' || raw.previewRenderer === 'pixel') out.previewRenderer = raw.previewRenderer
   if (
      raw.previewDuringRun === 'latent' ||
      raw.previewDuringRun === 'latent-small' ||
      raw.previewDuringRun === 'last-output'
   )
      out.previewDuringRun = raw.previewDuringRun
   return out
}

/** persisted TUI settings at `.comfy-ts/settings.json` (LOCAL state, gitignored) */
export class SettingsSt {
   constructor(private st: TuiSt) {
      this.load()
      // a non-protocol terminal can't do native — fall the stored setting back to pixel
      if (this.previewRenderer === 'native' && !protocolCapable()) this.previewRenderer = 'pixel'
      makeAutoObservable<SettingsSt, 'st'>(this, { st: false })
      this.st.disposers.push(
         reaction(
            () => this.snapshotJson(),
            (json) => this.write(json),
            { delay: 300 },
         ),
      )
      // the delayed reaction can be cancelled by dispose with a write pending —
      // and lastWorkflow's whole point is exit state: flush on the way out
      this.st.disposers.push(() => this.write(this.snapshotJson()))
   }

   private snapshotJson(): string {
      return JSON.stringify({
         previewPanel: this.previewPanel,
         previewRenderer: this.previewRenderer,
         previewDuringRun: this.previewDuringRun,
         lastDraft: this.lastDraft,
         lastWorkflow: this.lastWorkflow,
         hostOverrideId: this.hostOverrideId,
         collapsedDirs: this.collapsedDirs,
         saveToDisk: this.saveToDisk,
      })
   }

   previewPanel: boolean = true
   previewRenderer: PreviewRenderer = protocolCapable() ? 'native' : 'pixel'
   previewDuringRun: PreviewDuringRun = 'latent'
   /** module basename → the draft that was active last time (reopened on load) */
   lastDraft: Record<string, string> = {}
   /** path of the last OPEN workflow module — a no-arg `tui` reopens it (his ask 2026-07-30) */
   lastWorkflow: string | null = null
   /** the `h` host override, by host id (re-resolved once that host registers) */
   hostOverrideId: string | null = null
   /** folded tree dirs (hand-tuned state persists, like every other surface) */
   collapsedDirs: string[] = []
   /** the vars-panel save toggle (architecture item 14): off = outputs stay in memory */
   saveToDisk: boolean = true

   rememberDraft(moduleKey: string, draft: string): void {
      this.lastDraft[moduleKey] = draft
   }

   private load(): void {
      const path = comfyts.settingsPath
      if (!existsSync(path)) return
      try {
         const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
         if (raw == null || typeof raw !== 'object') return
         const o = raw as Record<string, unknown>
         const preview = migratePreviewSettings(o, {
            previewPanel: this.previewPanel,
            previewRenderer: this.previewRenderer,
            previewDuringRun: this.previewDuringRun,
         })
         this.previewPanel = preview.previewPanel
         this.previewRenderer = preview.previewRenderer
         this.previewDuringRun = preview.previewDuringRun
         if (o.lastDraft != null && typeof o.lastDraft === 'object')
            this.lastDraft = { ...(o.lastDraft as Record<string, string>) }
         if (typeof o.lastWorkflow === 'string') this.lastWorkflow = o.lastWorkflow
         if (typeof o.hostOverrideId === 'string') this.hostOverrideId = o.hostOverrideId
         if (Array.isArray(o.collapsedDirs)) this.collapsedDirs = o.collapsedDirs.filter((d) => typeof d === 'string')
         if (typeof o.saveToDisk === 'boolean') this.saveToDisk = o.saveToDisk
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
