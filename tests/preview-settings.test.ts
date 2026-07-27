import { describe, expect, it } from 'bun:test'
import { migratePreviewSettings, type PreviewSettings } from 'src/cli/tui/state/SettingsSt.ts'

const DEFAULTS: PreviewSettings = { previewPanel: true, previewRenderer: 'native', previewDuringRun: 'latent' }

describe('migratePreviewSettings', () => {
   it('maps the legacy single previewMode onto the axes', () => {
      expect(migratePreviewSettings({ previewMode: 'native' }, DEFAULTS)).toEqual({
         previewPanel: true,
         previewRenderer: 'native',
         previewDuringRun: 'latent',
      })
      expect(migratePreviewSettings({ previewMode: 'ansi' }, DEFAULTS).previewRenderer).toBe('pixel')
      expect(migratePreviewSettings({ previewMode: 'off' }, DEFAULTS).previewPanel).toBe(false)
   })

   it('new-shape keys pass through and win over legacy', () => {
      const out = migratePreviewSettings(
         { previewMode: 'off', previewPanel: true, previewRenderer: 'pixel', previewDuringRun: 'last-output' },
         DEFAULTS,
      )
      expect(out).toEqual({ previewPanel: true, previewRenderer: 'pixel', previewDuringRun: 'last-output' })
   })

   it('garbage falls back to the defaults', () => {
      expect(
         migratePreviewSettings({ previewMode: 42, previewRenderer: 'vulkan', previewDuringRun: null }, DEFAULTS),
      ).toEqual(DEFAULTS)
   })
})
