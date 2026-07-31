// pty-less TUI smoke driver (run by image-picker.test.ts, never by bun test
// directly): mounts the REAL TuiApp on a pipe stdout — ink writes the final
// frame at unmount on a non-TTY — with the image picker overlay open, so the
// test can assert the overlay OPENS and LISTS entries. Logic only: judging
// looks is a human's call.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { render } from 'ink'
import { join } from 'pathe'
import { TuiApp } from 'src/cli/tui/components/TuiApp.tsx'
import { TuiSt } from 'src/cli/tui/state/TuiSt.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

const root = mkdtempSync(join(tmpdir(), 'comfy-ts-tui-smoke-'))
const imagesDir = join(root, 'pics')
mkdirSync(join(imagesDir, 'portraits'), { recursive: true })
writeFileSync(join(imagesDir, 'alpha.png'), 'stub')
writeFileSync(join(imagesDir, 'beta.jpg'), 'stub')

const comfy = new ComfyTS({ rootPath: root })
const host = comfy.host({ id: 'smoke-host', host: '127.0.0.1', port: 65498 })
const wf = host.defineWorkflow({
   id: 'tui-smoke',
   vars: { image: v.image('', { folder: imagesDir }) },
   build: () => {},
})

const st = new TuiSt(wf)
st.selIx = 0
st.activate() // kind 'image' → the picker overlay (mode 'overlay-image')
if (st.mode !== 'overlay-image') throw new Error(`expected overlay-image, got ${st.mode}`)

const app = render(<TuiApp st={st} />)
// one tick so ink commits a frame before unmount flushes it to the pipe
await new Promise((resolve) => setTimeout(resolve, 100))
app.unmount()
await app.waitUntilExit()
st.dispose()
console.log('SMOKE_OK')
process.exit(0)
