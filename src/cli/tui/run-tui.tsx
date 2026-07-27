import { readdirSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { render } from 'ink'
import { dirname, join, resolve } from 'pathe'
import { COMFY_TS_TUI_ENV } from 'src/cli/tui-env.ts'
import { findDefinedWorkflow } from 'src/cli/tui/findDefinedWorkflow.ts'
import { installProtocolImagePainter } from 'src/cli/tui/protocolImagePainter.ts'
import { TuiApp } from 'src/cli/tui/components/TuiApp.tsx'
import { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** recursive scan for the workflow-module naming convention */
function scanCflowFiles(dir: string): string[] {
   const hits = readdirSync(dir, { recursive: true })
      .map((f) => join(dir, String(f)))
      .filter((f) => f.endsWith('.cflow.ts') || f.endsWith('.cflow.tsx'))
   return hits.sort()
}

export async function runTui(args: string[]): Promise<number> {
   // no arg = scan cwd; a file arg ALSO scans its folder (file preselected)
   const target = args.find((a) => !a.startsWith('--')) ?? '.'

   // the module contract: files check `import.meta.main` (false here) so their
   // standalone run block is skipped; this env var covers in-run tweaks
   process.env[COMFY_TS_TUI_ENV] = '1'
   process.env.COMFY_TS_QUIET = '1' // info chatter off; the TUI owns the screen

   const abs = resolve(target)
   const isDir = statSync(abs).isDirectory()
   const scanned = scanCflowFiles(isDir ? abs : dirname(abs))
   const workflowFiles = isDir || scanned.includes(abs) ? scanned : [abs, ...scanned]
   const first = isDir ? workflowFiles[0] : abs
   if (first == null) {
      console.error(`[comfy-ts tui] no **/*.cflow.ts found under ${abs}`)
      return 1
   }

   const mod: Record<string, unknown> = await import(pathToFileURL(first).href)
   const wf = findDefinedWorkflow(mod)
   if (wf == null) {
      console.error(
         `[comfy-ts tui] ${first} exports no DefinedWorkflow — export the result of host.defineWorkflow(...)`,
      )
      return 1
   }

   const st = new TuiSt(wf, { workflowFiles, currentFile: first })
   // ALT SCREEN (TTY only): deterministic absolute coordinates for the protocol
   // image painter + no scrollback pollution / clipped first row.
   // modifyOtherKeys mode 1 rides along: vscode/xterm.js then ENCODES modified ⏎
   // (so ⇧⏎ stops arriving as a plain-`\r` commit) as `CSI 27;mods;13~` —
   // translated in TuiApp via keys.ts. Mode 1 only touches keys without
   // well-known sequences (mode 2 would re-encode ctrl+letters and break the
   // editor keys); unsupporting terminals ignore it.
   const altScreen = process.stdout.isTTY === true
   if (altScreen) process.stdout.write('\u001b[?1049h\u001b[H\u001b[>4;1m')
   // REAL images over the preview panel rect on OSC-1337 terminals (repaints
   // after every stdout flush + on image change — NOT a React effect)
   const uninstallPainter = installProtocolImagePainter(st)
   try {
      // kittyKeyboard auto: ink queries `CSI ? u` and enables CSI-u encoding
      // where supported (iTerm2 3.5+/WezTerm/kitty/ghostty) — ⇧⏎ parsed natively
      const app = render(<TuiApp st={st} />, { kittyKeyboard: { mode: 'auto' } })
      // dispose: flush reactions/listeners + close every ws opened by loaded modules
      st.onExit = () => st.dispose()
      await app.waitUntilExit()
      st.dispose()
   } finally {
      uninstallPainter()
      // reset colors + erase WHILE STILL in the alt screen: ED deletes iTerm
      // inline images too — without this the last protocol image and stray
      // background colors survive into the shell (his repro)
      if (altScreen) process.stdout.write('\u001b[0m\u001b[2J\u001b[H\u001b[>4;0m\u001b[?1049l')
   }
   return 0
}
