// pty-less SMALL-TERMINAL driver (run by tui-tree-viewport.test.ts, never by
// bun test directly): fakes a tiny terminal via SMOKE_ROWS, mounts the REAL
// TuiApp with more tree rows than fit, and lets the final pipe frame prove
// the frame never exceeds the terminal height (his overflow repro) and the
// tree windows itself with `…` markers.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { render } from 'ink'
import { join } from 'pathe'
import { TuiApp } from 'src/cli/tui/components/TuiApp.tsx'
import { TuiSt } from 'src/cli/tui/state/TuiSt.ts'
import { ComfyTS } from 'src/state.ts'

const rows = Number(process.env['SMOKE_ROWS'] ?? 14)
// a pipe stdout has no tty geometry: give it the faked one BEFORE TuiSt reads it
Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true })
Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true })

const root = mkdtempSync(join(tmpdir(), 'comfy-ts-tree-smoke-'))
const flows = join(root, 'flows')
mkdirSync(flows, { recursive: true })
const files: string[] = []
for (let i = 0; i < 25; i++) {
   const f = join(flows, `fam${String(i).padStart(2, '0')}-mode.cflow.ts`)
   writeFileSync(f, '// stub')
   files.push(f)
}

const comfy = new ComfyTS({ rootPath: root })
const host = comfy.host({ id: 'tree-smoke-host', host: '127.0.0.1', port: 65496 })
const wf = host.defineWorkflow({ id: 'tree-smoke', vars: {}, build: () => {} })

const st = new TuiSt(wf)
st.workflows.files = files
st.mode = 'tree'
st.tree.ix = 12 // mid-list: both `…` markers must show

const app = render(<TuiApp st={st} />)
// two ticks: frame 1 measures the panel, frame 2 windows to the measurement
await new Promise((resolve) => setTimeout(resolve, 100))
await new Promise((resolve) => setTimeout(resolve, 100))
app.unmount()
await app.waitUntilExit()
st.dispose()
console.log('SMOKE_OK')
process.exit(0)
