// what `comfy-ts serve` prints on launch. PURE: takes the already-described
// modules and gives back lines, so tests read the layout without a server and
// without a tty. Colors are a parameter, never a probe done in here.
import { ansi, stripAnsi } from 'src/utils/ansi.ts'

export type StartupModule = {
   key: string
   hostId: string
   /** the POST routes, ready to print */
   routes: string[]
   /** one line per var (renderDescriptorLine) */
   varLines: string[]
}

export type StartupInput = {
   modules: StartupModule[]
   bind: string
   port: number
   /** every address this bind answers on (reachableAddresses) */
   urls: string[]
   color: boolean
}

const RULE_WIDTH = 64

/** 100.64.0.0/10 is the CGNAT range tailscale hands out — worth naming, it is the one
 * you want when the phone is not on the same wifi */
export function addressNote(addr: string): string {
   const octets = addr.split('.').map(Number)
   const second = octets[1] ?? 0
   if (octets[0] === 100 && second >= 64 && second <= 127) return 'tailnet'
   if (addr === '127.0.0.1' || addr === 'localhost') return 'this machine'
   return ''
}

function paint(color: boolean): {
   title: (s: string) => string
   name: (s: string) => string
   dim: (s: string) => string
   url: (s: string) => string
   warn: (s: string) => string
} {
   const id = (s: string): string => s
   if (!color) return { title: id, name: id, dim: id, url: id, warn: id }
   return {
      title: (s) => ansi.bold(s),
      name: (s) => ansi.bold.cyan(s),
      dim: (s) => ansi.gray(s),
      url: (s) => ansi.green(s),
      warn: (s) => ansi.yellow(s),
   }
}

/** a box that stays square whatever the colors do: padding measures the VISIBLE text */
export function boxed(lines: string[], p: { color: boolean } = { color: false }): string[] {
   const width = Math.max(...lines.map((l) => stripAnsi(l).length), 0)
   const edge = (l: string, r: string): string => `${l}${'─'.repeat(width + 2)}${r}`
   const border = (s: string): string => (p.color ? ansi.gray(s) : s)
   return [
      border(edge('┌', '┐')),
      ...lines.map((l) => `${border('│')} ${l}${' '.repeat(width - stripAnsi(l).length)} ${border('│')}`),
      border(edge('└', '┘')),
   ]
}

export function renderStartupLines(p: StartupInput): string[] {
   const c = paint(p.color)
   const loopback = p.bind === '127.0.0.1' || p.bind === 'localhost' || p.bind === '::1'
   const primary = `http://${p.urls[0] ?? p.bind}:${p.port}/`
   const out: string[] = []

   const count = `${p.modules.length} workflow${p.modules.length === 1 ? '' : 's'}`
   out.push(c.title(`comfy-ts serve · ${count} · ${primary}`))
   if (!loopback)
      out.push(c.warn(`⚠️  bound to ${p.bind} — this API has NO AUTH and runs workflows on your ComfyUI host`))

   for (const mod of p.modules) {
      out.push('', c.dim('─'.repeat(RULE_WIDTH)))
      out.push(`${c.name(mod.key)} ${c.dim(`host: ${mod.hostId}`)}`)
      for (const route of mod.routes) out.push(c.dim(`   POST ${route}`))
      out.push(...mod.varLines)
   }
   out.push(c.dim('─'.repeat(RULE_WIDTH)), '')

   // the box is the last thing on screen: where the ui is, and how to reach it elsewhere
   const box: string[] = [
      `${c.title('web ui')}   ${c.url(primary)}`,
      `${c.dim('json api')} ${c.dim(`${primary}drafts`)}`,
   ]
   if (p.urls.length > 1) {
      box.push('', c.dim('also reachable at:'))
      for (const url of p.urls.slice(1)) {
         const note = addressNote(url)
         box.push(`  ${c.url(`http://${url}:${p.port}/`)}${note === '' ? '' : c.dim(`  (${note})`)}`)
      }
   }
   if (loopback) {
      box.push('', c.dim('to open it from your phone or another machine:'))
      box.push(c.dim(`  comfy-ts serve --host 0.0.0.0   (--bind is the same flag)`))
      box.push(c.dim('  every reachable url gets printed here, tailnet included'))
   }
   out.push(...boxed(box, { color: p.color }))
   return out
}
