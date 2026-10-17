// `tui`, `serve` and `run` import .cflow.ts modules, which need bun: the bin's
// node shebang re-execs the same command line through it
import { spawnSync } from 'node:child_process'

/** runs `bun <argv>` with the terminal inherited; `error` when bun cannot start */
export function hopToBun(argv: string[]): { code: number } | { error: Error } {
   const res = spawnSync('bun', argv, { stdio: 'inherit' })
   if (res.error == null) return { code: res.status ?? 1 }
   return { error: res.error }
}
