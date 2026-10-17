// `tui`, `serve` and `run` import .cflow.ts modules, which need bun: the bin's
// node shebang re-execs the same command line through it. The wrapper is the pid
// a terminal, a supervisor or an agent holds and stops, so the child must never
// outlive it (agent/architecture.md item 10)
import { spawn } from 'node:child_process'
import { constants } from 'node:os'

const HOP_PARENT_ENV = 'COMFY_TS_HOP_PARENT'
const FORWARDED: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

/** runs `bun <argv>` with the terminal inherited, forwarding the stop signals;
 * resolves the child's exit code, or `error` when bun cannot start */
export function hopToBun(argv: string[]): Promise<{ code: number } | { error: Error }> {
   return new Promise((resolve) => {
      const child = spawn('bun', argv, {
         stdio: 'inherit',
         env: { ...process.env, [HOP_PARENT_ENV]: String(process.pid) },
      })
      const forward = (signal: NodeJS.Signals): void => {
         child.kill(signal)
      }
      for (const signal of FORWARDED) process.on(signal, forward)
      const done = (r: { code: number } | { error: Error }): void => {
         for (const signal of FORWARDED) process.off(signal, forward)
         resolve(r)
      }
      child.once('error', (error) => done({ error }))
      child.once('exit', (code, signal) => {
         if (code != null) return done({ code })
         done({ code: signal == null ? 1 : 128 + (constants.signals[signal] ?? 0) })
      })
   })
}

/** in the bun child: exit once the process that started it is gone. A SIGKILL to
 * the wrapper reaches no handler, so the child polls its own ppid, which changes
 * (to 1, or a subreaper) when its parent dies. It watches the ppid it started
 * with, not the wrapper pid: a version manager shim may sit between the two */
export function armHopChild(p: { intervalMs?: number } = {}): void {
   if (process.env[HOP_PARENT_ENV] == null) return
   // a grandchild has another parent: it must never inherit the watch
   Reflect.deleteProperty(process.env, HOP_PARENT_ENV)
   const parent = process.ppid
   setInterval(() => {
      if (process.ppid === parent) return
      console.error(`[comfy-ts] the process that started this one (pid ${parent}) is gone: exiting`)
      process.exit(1)
   }, p.intervalMs ?? 1000).unref()
}
