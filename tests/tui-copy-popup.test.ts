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

describe('copy popup (`c` used to silently do nothing)', () => {
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

describe('imageClipboardCommand (pure): platform command for copying image PIXELS', () => {
   it('darwin: osascript reads the file as a clipboard image class by extension', async () => {
      const { imageClipboardCommand } = await import('src/cli/tui/imageClipboard.ts')
      const png = imageClipboardCommand('darwin', '/tmp/out.png')
      expect(png?.cmd).toBe('osascript')
      expect(png?.args.join(' ')).toContain('«class PNGf»')
      expect(png?.args.join(' ')).toContain('/tmp/out.png')
      const jpg = imageClipboardCommand('darwin', '/tmp/out.jpg')
      expect(jpg?.args.join(' ')).toContain('JPEG picture')
   })

   it('linux: xclip targets the image mime by extension', async () => {
      const { imageClipboardCommand } = await import('src/cli/tui/imageClipboard.ts')
      const c = imageClipboardCommand('linux', '/tmp/out.png')
      expect(c?.cmd).toBe('xclip')
      expect(c?.args).toContain('image/png')
      expect(c?.args).toContain('/tmp/out.png')
   })

   it('win32: powershell Clipboard.SetImage, single-quoted so $ and backtick stay literal', async () => {
      const { imageClipboardCommand } = await import('src/cli/tui/imageClipboard.ts')
      const c = imageClipboardCommand('win32', "C:\\out$dir\\o'ut.png")
      expect(c?.cmd).toBe('powershell')
      const script = c?.args.join(' ') ?? ''
      expect(script).toContain('SetImage')
      // single-quoted PS string, inner quotes doubled — never a double-quoted
      // interpolating string ($ and ` in user paths)
      expect(script).toContain("'C:\\out$dir\\o''ut.png'")
      expect(script).not.toContain('"C:')
   })

   it('darwin: non-png/jpeg returns null — tagging raw webp bytes as PNGf would paste garbage with a green popup', async () => {
      const { imageClipboardCommand } = await import('src/cli/tui/imageClipboard.ts')
      expect(imageClipboardCommand('darwin', '/tmp/out.webp')).toBeNull()
   })
})

describe('imageClipboardStdinCommand (pure): png bytes over stdin, zero disk writes', () => {
   const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xab, 0x00, 0xff])

   it('darwin: the script itself rides stdin and carries a «data PNGf<hex>» literal', async () => {
      const { imageClipboardStdinCommand } = await import('src/cli/tui/imageClipboard.ts')
      const c = imageClipboardStdinCommand('darwin', bytes)
      expect(c.cmd).toBe('osascript')
      expect(c.args).toEqual(['-'])
      const script = new TextDecoder().decode(c.stdin)
      expect(script).toContain('«data PNGf89504E47AB00FF»')
      // the pixels live inside the script: no path anywhere
      expect(script).not.toContain('/')
   })

   it('win32: base64 rides stdin, the script rebuilds from a MemoryStream (no file, no quoting surface)', async () => {
      const { imageClipboardStdinCommand } = await import('src/cli/tui/imageClipboard.ts')
      const c = imageClipboardStdinCommand('win32', bytes)
      expect(c.cmd).toBe('powershell')
      const script = c.args.join(' ')
      expect(script).toContain('FromBase64String')
      expect(script).toContain('SetImage')
      expect(new TextDecoder().decode(c.stdin)).toBe(Buffer.from(bytes).toString('base64'))
   })

   it('linux: xclip reads the raw png bytes from stdin', async () => {
      const { imageClipboardStdinCommand } = await import('src/cli/tui/imageClipboard.ts')
      const c = imageClipboardStdinCommand('linux', bytes)
      expect(c.cmd).toBe('xclip')
      expect(c.args).toContain('image/png')
      expect(c.args).not.toContain('-i')
      expect(c.stdin).toEqual(bytes)
   })
})

describe('`i` copy last image: never silent, popup like c/C', () => {
   it('no output yet: a RED popup says so instead of doing nothing', async () => {
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({ id: 'copy-image-empty-test', vars: {}, build: () => {} })
      const st = new TuiSt(wf)
      await st.exec.copyLastImage()
      expect(st.mode).toBe('overlay-copy')
      expect(st.exec.copyPopup?.ok).toBe(false)
      expect(st.exec.copyPopup?.lines.join('\n')).toContain('no output image yet')
      st.exec.closeCopyPopup()
      st.dispose()
   })
})
