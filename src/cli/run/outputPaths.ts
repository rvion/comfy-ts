// where `comfy-ts run` writes each output. `--out a.png` and one output: exactly there, its
// extension swapped for the output's own when they differ (said on the line); several outputs
// are numbered (`a-1.png`); a dir keeps the server's filenames; no --out names them after the
// module and the prompt in the cwd. Pure: the caller says whether --out is a dir
import { basename, extname, join, resolve } from 'pathe'

export type Produced = { filename: string }
export type Destination = { path: string; note: string | null }

export function outputPaths(p: {
   out: string | null
   outIsDir: boolean
   module: string
   promptId: string
   items: readonly Produced[]
   cwd: string
}): Destination[] {
   const n = p.items.length
   if (p.out != null && p.outIsDir) {
      const dir = resolve(p.cwd, p.out)
      return p.items.map((it) => ({ path: join(dir, basename(it.filename)), note: null }))
   }
   const base = p.out == null ? join(p.cwd, `${p.module}-${p.promptId.slice(0, 8)}`) : resolve(p.cwd, p.out)
   const asked = p.out == null ? '' : extname(base)
   const stem = asked === '' ? base : base.slice(0, -asked.length)
   return p.items.map((it, ix) => {
      const own = extname(it.filename)
      const path = `${stem}${n > 1 ? `-${ix + 1}` : ''}${own}`
      const note =
         asked !== '' && own !== '' && asked.toLowerCase() !== own.toLowerCase()
            ? `the output is ${own}, not ${asked}`
            : null
      return { path, note }
   })
}

/** the transcript or text beside the first media output: same stem, `.txt` */
export function sidecarPath(mediaPath: string): string {
   const ext = extname(mediaPath)
   return `${ext === '' ? mediaPath : mediaPath.slice(0, -ext.length)}.txt`
}
