// pty-less TUI smoke driver (run by lora-info.test.ts, never by bun test
// directly): mounts the REAL TuiApp on a pipe stdout with the LORAS overlay
// open and a lora-manager mirror on disk, so the test can assert the overlay
// renders the model name and the trigger words nobody typed.
// Synthetic fixture only, and logic only: this asserts what renders, never how it looks.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { render } from 'ink'
import { join } from 'pathe'
import { TuiApp } from 'src/cli/tui/components/TuiApp.tsx'
import { TuiSt } from 'src/cli/tui/state/TuiSt.ts'
import { buildLoraMirror, reloadLoraInfoCache, writeLoraMirror } from 'src/host/loraInfoCache.ts'
import type { LmLoraItem } from 'src/host/loraManagerApi.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

const AURORA = 'styles\\aurora-ink-v3.safetensors'
const BRASS = 'styles\\brass-gears.safetensors'

const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-loras-smoke-')) })
const host = comfy.host({ id: 'smoke-host', host: '127.0.0.1', port: 65497 })

const page: unknown = JSON.parse(readFileSync('tests/fixtures/lm-loras-list.synthetic.json', 'utf8'))
writeLoraMirror(
   buildLoraMirror({
      hostId: 'smoke-host',
      hostUrl: 'http://127.0.0.1:65497',
      fetchedAt: '2026-07-31T00:00:00.000Z',
      items: (page as { items: LmLoraItem[] }).items,
   }),
)
reloadLoraInfoCache()

const wf = host.defineWorkflow({
   id: 'loras-smoke',
   vars: { loras: v.loras([AURORA, BRASS]) },
   build: () => {},
})

const st = new TuiSt(wf)
st.selIx = 0
st.activate() // kind 'loras' → the loras overlay (mode 'overlay-loras')
if (st.mode !== 'overlay-loras') throw new Error(`expected overlay-loras, got ${st.mode}`)

const app = render(<TuiApp st={st} />)
// one tick so ink commits a frame before unmount flushes it to the pipe
await new Promise((resolve) => setTimeout(resolve, 100))
app.unmount()
await app.waitUntilExit()
st.dispose()
console.log('SMOKE_OK')
process.exit(0)
