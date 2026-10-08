// the panel's own confirm and text prompt, drawn in the page (DialogLayer). Never window.prompt /
// confirm / alert: sk gui's WKWebView implements no js panel, so there they return null / false
// at once and the button that asked does nothing; browsers also suppress them after a few.
// tests/serve-web-dialog.test.ts guards that no panel source calls the native ones
import { makeAutoObservable } from 'mobx'

export type DialogRequest =
   | { kind: 'confirm'; message: string; ok: string; danger: boolean; resolve(ok: boolean): void }
   | { kind: 'prompt'; message: string; value: string; resolve(value: string | null): void }

export class DialogSt {
   current: DialogRequest | null = null

   constructor() {
      makeAutoObservable(this)
   }

   confirm(p: { message: string; ok?: string; danger?: boolean }): Promise<boolean> {
      this.cancel()
      return new Promise((resolve) => {
         this.current = { kind: 'confirm', message: p.message, ok: p.ok ?? 'ok', danger: p.danger ?? false, resolve }
      })
   }

   /** the typed text on ok, null on cancel */
   prompt(p: { message: string; value: string }): Promise<string | null> {
      this.cancel()
      return new Promise((resolve) => {
         this.current = { kind: 'prompt', message: p.message, value: p.value, resolve }
      })
   }

   setValue(value: string): void {
      if (this.current?.kind === 'prompt') this.current = { ...this.current, value }
   }

   accept(): void {
      const c = this.current
      if (c == null) return
      this.current = null
      if (c.kind === 'confirm') c.resolve(true)
      else c.resolve(c.value)
   }

   cancel(): void {
      const c = this.current
      if (c == null) return
      this.current = null
      if (c.kind === 'confirm') c.resolve(false)
      else c.resolve(null)
   }
}

export const dialogs = new DialogSt()

/** the lines of a source that call a native browser dialog */
export function nativeDialogCalls(source: string): string[] {
   return source.split('\n').filter((line) => /\b(window|globalThis)\.(prompt|confirm|alert)\s*\(/.test(line))
}
