import { EventEmitter } from 'node:events'
import { render } from 'ink'
import { runInAction } from 'mobx'
import { TuiApp } from 'src/cli/tui/components/TuiApp.tsx'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/**
 * mounts the REAL TuiApp in this process on a fake terminal and returns the last frame once
 * renders stop. debug mode: ink writes every frame whole and unthrottled, so no guessed sleep.
 * logic only: this asserts what renders, never how it looks.
 */
export async function tuiFrame(st: TuiSt, p: { rows?: number; columns?: number } = {}): Promise<string> {
   const rows = p.rows ?? 24
   const columns = p.columns ?? 80
   // TuiSt keeps one row back for vscode's clipped first row, as it does from process.stdout
   runInAction(() => {
      st.termRows = rows - 1
      st.termCols = columns
   })
   const frames: string[] = []
   const stdout = Object.assign(new EventEmitter(), {
      rows,
      columns,
      isTTY: false,
      write: (s: string): boolean => {
         frames.push(s)
         return true
      },
   })
   // a tty-shaped stdin that never delivers a key: useInput needs raw mode to mount
   const stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode: (): void => {},
      setEncoding: (): void => {},
      ref: (): void => {},
      unref: (): void => {},
      read: (): null => null,
   })
   const app = render(<TuiApp st={st} />, { stdout, stdin, debug: true, patchConsole: false, exitOnCtrlC: false })
   // a measured panel re-renders from an effect: wait until a few macrotasks pass with no new frame
   let quiet = 0
   for (let i = 0; i < 200 && quiet < 3; i++) {
      const n = frames.length
      await new Promise((r) => setTimeout(r, 0))
      quiet = frames.length === n && n > 0 ? quiet + 1 : 0
   }
   // the frame on screen, before unmount appends its closing newline
   const frame = (frames.at(-1) ?? '').replace(/\n+$/, '')
   app.unmount()
   await app.waitUntilExit()
   return frame
}
