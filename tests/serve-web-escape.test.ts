// a popup closed with esc beeped in sk gui: WKWebView plays the system "invalid action" sound for
// a key the page leaves unhandled, and no esc handler of the panel called preventDefault
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import { onEscape, rawEscapeChecks } from 'src/cli/serve/web/state/escape.ts'

const WEB = 'src/cli/serve/web'

function sources(dir: string): string[] {
   return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? sources(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : [],
   )
}

describe('esc is claimed', () => {
   it('onEscape prevents the default on esc and runs close', () => {
      let prevented = false
      let closed = false
      const hit = onEscape({ key: 'Escape', preventDefault: () => (prevented = true) }, () => (closed = true))
      expect([hit, prevented, closed]).toEqual([true, true, true])
   })

   // control: any other key is left alone
   it('onEscape ignores other keys', () => {
      let prevented = false
      const hit = onEscape({ key: 'Enter', preventDefault: () => (prevented = true) }, () => {})
      expect([hit, prevented]).toEqual([false, false])
   })

   it('the guard catches a hand-written esc check and lets its lookalikes pass', () => {
      expect(rawEscapeChecks("if (e.key === 'Escape') close()")).toHaveLength(1)
      expect(rawEscapeChecks('if (ev.key !== "Escape") return')).toHaveLength(1)
      expect(rawEscapeChecks("onEscape(e, close)\nif (e.key === 'Enter') go()\nconst label = 'Escape'")).toEqual([])
   })

   // why we think it is actually a bug, and not just meaning spec should change: every esc
   // handler closes its popup; the beep on top is the window saying the key went unhandled
   it('no panel source tests for esc by hand: every handler goes through onEscape', () => {
      const offenders = sources(WEB)
         .filter((f) => !f.endsWith('state/escape.ts'))
         .flatMap((f) => rawEscapeChecks(readFileSync(f, 'utf8')).map((line) => `${f}: ${line.trim()}`))
      expect(offenders).toEqual([])
   })
})
