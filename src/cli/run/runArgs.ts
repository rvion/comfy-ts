// `comfy-ts run [name] [--draft d] [--out p] [--json] [--verbose] [--help] [--<var> value | --<var>=value | --<toggle>]`
// Pure: the vars stay strings here, the module's own var kinds shape them later (flagValue)

export type RunArgs = {
   name: string | null
   draft: string
   out: string | null
   json: boolean
   /** the library's own log lines, on stderr */
   verbose: boolean
   help: boolean
   /** in command line order; `true` = a bare flag */
   vars: [string, string | true][]
}

const OWN = new Set(['draft', 'out'])

export function parseRunArgs(argv: readonly string[]): RunArgs | { error: string } {
   const r: RunArgs = { name: null, draft: 'default', out: null, json: false, verbose: false, help: false, vars: [] }
   for (let i = 0; i < argv.length; i++) {
      const a = argv[i]!
      if (a === '-h' || a === '--help') {
         r.help = true
         continue
      }
      if (a === '--json') {
         r.json = true
         continue
      }
      if (a === '--verbose') {
         r.verbose = true
         continue
      }
      if (!a.startsWith('--')) {
         if (r.name != null) return { error: `one module per run: got '${r.name}' and '${a}'` }
         r.name = a
         continue
      }
      const eq = a.indexOf('=')
      const key = eq < 0 ? a.slice(2) : a.slice(2, eq)
      if (key === '') return { error: `'${a}' names no var` }
      let value: string | true
      if (eq >= 0) value = a.slice(eq + 1)
      else {
         const next = argv[i + 1]
         if (next == null || next.startsWith('--')) value = true
         else {
            value = next
            i++
         }
      }
      if (OWN.has(key)) {
         if (value === true) return { error: `--${key} needs a value` }
         if (key === 'draft') r.draft = value
         else r.out = value
         continue
      }
      r.vars.push([key, value])
   }
   return r
}
