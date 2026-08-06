// tiny chalk-compatible terminal styler (chainable), keeps chalk out of the deps
const codes = {
   bold: [1, 22],
   dim: [2, 22],
   underline: [4, 24],
   red: [31, 39],
   green: [32, 39],
   yellow: [33, 39],
   blue: [34, 39],
   cyan: [36, 39],
   gray: [90, 39],
   greenBright: [92, 39],
} as const

type StyleName = keyof typeof codes
export type Styler = ((s: string) => string) & { [k in StyleName]: Styler }

function styler(open: string = '', close: string = ''): Styler {
   const fn = (s: string): string => open + s + close
   return new Proxy(fn, {
      get(_target, prop: string) {
         const c = codes[prop as StyleName]
         if (c == null) throw new Error(`unknown ansi style: ${prop}`)
         return styler(`${open}\x1b[${c[0]}m`, `\x1b[${c[1]}m${close}`)
      },
   }) as Styler
}

export const ansi: Styler = styler()

// CSI sequences + lone ESC-letter escapes (server logs re-rendered inside ink)
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[A-Za-z]/g

export function stripAnsi(s: string): string {
   return s.replace(ANSI_RE, '')
}

/** colors only where they can be seen: a real terminal, NO_COLOR unset, TERM not 'dumb'.
 * A piped or redirected stdout gets plain text, so `serve > log` stays greppable */
export function colorsAvailable(): boolean {
   const env = globalThis.process?.env ?? {}
   if (env.NO_COLOR != null && env.NO_COLOR !== '') return false
   if (env.TERM === 'dumb') return false
   if (env.FORCE_COLOR != null && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true
   return globalThis.process?.stdout?.isTTY === true
}
