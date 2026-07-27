// tiny chalk-compatible terminal styler (chainable), keeps chalk out of the deps
const codes = {
   bold: [1, 22],
   underline: [4, 24],
   red: [31, 39],
   green: [32, 39],
   yellow: [33, 39],
   blue: [34, 39],
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
