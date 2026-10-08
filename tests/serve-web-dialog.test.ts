// the "new master prompt" and "new llm" buttons did nothing in sk gui: its WKWebView implements no
// js panel, so window.prompt returned null at once (and window.confirm false, so no delete ever ran)
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import { DialogSt, nativeDialogCalls } from 'src/cli/serve/web/state/dialog.ts'

const WEB = 'src/cli/serve/web'

function sources(dir: string): string[] {
   return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? sources(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : [],
   )
}

describe('panel dialogs are drawn in the page', () => {
   it('the guard catches a native dialog call and lets its lookalikes pass', () => {
      expect(nativeDialogCalls("const name = window.prompt('name', 'x')")).toHaveLength(1)
      expect(nativeDialogCalls('if (window.confirm(`delete?`)) go()')).toHaveLength(1)
      expect(nativeDialogCalls('globalThis.alert("hi")')).toHaveLength(1)
      expect(
         nativeDialogCalls(
            "await dialogs.confirm({ message: 'x' })\nconst confirm = () => go()\nconfirm()\ne.prompt = 'x'",
         ),
      ).toEqual([])
   })

   // why we think it is actually a bug, and not just meaning spec should change: a button that
   // creates, renames or deletes must do it in the panel's own window, and there these calls are no-ops
   it('no panel source calls window.prompt, confirm or alert', () => {
      const offenders = sources(WEB).flatMap((f) =>
         nativeDialogCalls(readFileSync(f, 'utf8')).map((l) => `${f}: ${l.trim()}`),
      )
      expect(offenders).toEqual([])
   })

   it('a prompt resolves with the edited text on accept, null on cancel', async () => {
      const d = new DialogSt()
      const named = d.prompt({ message: 'name', value: 'refine-x' })
      d.setValue('refine-manga')
      d.accept()
      expect(await named).toBe('refine-manga')
      const cancelled = d.prompt({ message: 'name', value: 'x' })
      d.cancel()
      expect(await cancelled).toBeNull()
      expect(d.current).toBeNull()
   })

   it('a confirm resolves true on accept, false on cancel, and a newer ask cancels the older', async () => {
      const d = new DialogSt()
      const first = d.confirm({ message: 'delete?' })
      const second = d.confirm({ message: 'restart?' })
      expect(await first).toBe(false)
      d.accept()
      expect(await second).toBe(true)
   })
})
