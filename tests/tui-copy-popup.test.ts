import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyTS } from 'src/state.ts'

// comfyts-singleton pattern (image-picker.test.ts precedent): own temp root,
// restore whatever another test file registered
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'copy-host'>

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-copy-')) })
   host = comfy.host({ id: 'copy-host', host: '127.0.0.1', port: 65498 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
})

afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

describe('jsonHead (the clipboard-proof body)', () => {
   it('caps lines, truncates wide ones, marks the cut', async () => {
      const { jsonHead } = await import('src/cli/tui/state/ExecSt.ts')
      expect(jsonHead('a\nb', 5)).toEqual(['a', 'b'])
      expect(jsonHead('a\nb\nc', 2)).toEqual(['a', 'b', '…'])
      const wide = 'x'.repeat(100)
      expect(jsonHead(wide, 5)[0]).toBe(`${'x'.repeat(75)}…`)
   })
})

describe('copy popup (his repro: `c` silently did nothing)', () => {
   it('a FAILING build ends in a loud red popup, ⏎ closes back to nav', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'copy-fail-test',
         vars: { steps: v.int(8) },
         build: () => {
            // stands in for the real failure mode: an i2i build whose image
            // upload dies against an unreachable host
            throw new Error('upload failed: host unreachable')
         },
      })
      const st = new TuiSt(wf)
      await st.exec.copyWorkflowJson()
      expect(st.mode).toBe('overlay-copy')
      expect(st.exec.copyPopup?.ok).toBe(false)
      expect(st.exec.copyPopup?.title).toContain('FAILED')
      expect(st.exec.copyPopup?.lines.join('\n')).toContain('host unreachable')
      st.exec.closeCopyPopup()
      expect(st.mode).toBe('nav')
      expect(st.exec.copyPopup).toBeNull()
      st.dispose()
   })
})
