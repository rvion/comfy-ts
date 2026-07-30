import { readFileSync, realpathSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { render } from 'ink'
import { dirname, resolve } from 'pathe'
import { COMFY_TS_TUI_ENV } from 'src/cli/tui-env.ts'
import { settingsPathFor } from 'src/state.ts'
import { mergeWorkflowSources, scanCflowFiles } from 'src/cli/tui/discoverWorkflows.ts'
import { bundledExamplesDir } from 'src/exampleAssets.ts'
import { findDefinedWorkflow } from 'src/cli/tui/findDefinedWorkflow.ts'
import { installProtocolImagePainter } from 'src/cli/tui/protocolImagePainter.ts'
import { TuiApp } from 'src/cli/tui/components/TuiApp.tsx'
import { TuiSt } from 'src/cli/tui/state/TuiSt.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { logError } from 'src/utils/log.ts'
import type { DefinedWorkflow } from 'src/vars/DefinedWorkflow.ts'

/** the module the last session was on, IF it is still in this run's tree
 * (settings write: SettingsSt; exported for the headless test) */
export function rememberedWorkflow(
   workflowFiles: string[],
   settingsPath = settingsPathFor(process.cwd()),
): string | null {
   try {
      const raw: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'))
      if (raw == null || typeof raw !== 'object') return null
      const last = (raw as Record<string, unknown>).lastWorkflow
      return typeof last === 'string' && workflowFiles.includes(last) ? last : null
   } catch {
      return null // no settings yet, or unreadable json — the default pick is fine
   }
}

export async function runTui(args: string[]): Promise<number> {
   // no arg = cwd scan MERGED with the examples packaged with comfy-ts; an
   // explicit dir/file arg keeps that scope only (a file arg is preselected)
   const target = args.find((a) => !a.startsWith('--'))

   // the module contract: files check `import.meta.main` (false here) so their
   // standalone run block is skipped; this env var covers in-run tweaks
   process.env[COMFY_TS_TUI_ENV] = '1'
   process.env.COMFY_TS_QUIET = '1' // info chatter off; the TUI owns the screen

   // realpath both sides: scanned paths derive from cwd, bundled ones from
   // import.meta — a symlinked cwd must not defeat the dedupe
   const abs = realpathSync(resolve(target ?? '.'))
   const isDir = statSync(abs).isDirectory()
   const scanned = scanCflowFiles(isDir ? abs : dirname(abs))
   const scannedPlusArg = isDir || scanned.includes(abs) ? scanned : [abs, ...scanned]
   // no bun = no bundled examples: node refuses to import TypeScript under
   // node_modules (the cli re-execs into bun when it can, comfy-ts-cli.ts)
   const canImportBundled = process.versions.bun != null
   const examplesDir = canImportBundled ? bundledExamplesDir() : null
   if (!canImportBundled && target == null)
      logError('packaged examples skipped: importing .cflow.ts from node_modules needs bun (bunx --bun comfy-ts tui)')
   // rvion/ (the numbered didactic sequence) ahead of the zoo: with no file
   // arg the FIRST LOADABLE bundled module is the opening workflow, and that
   // must stay 01-txt2img, not the zoo's alphabetical head (the tree itself
   // stays alphabetical — this only orders the load candidates)
   const bundledFiles =
      examplesDir == null
         ? []
         : scanCflowFiles(realpathSync(examplesDir)).sort(
              (a, b) => Number(!a.includes('/rvion/')) - Number(!b.includes('/rvion/')) || a.localeCompare(b),
           )
   const discovery = mergeWorkflowSources({
      explicitTarget: target != null,
      scanned: scannedPlusArg,
      bundledFiles,
   })
   const workflowFiles = discovery.files
   if (workflowFiles.length === 0) {
      console.error(`[comfy-ts tui] no **/*.cflow.ts found under ${abs}`)
      return 1
   }

   // initial module = the file arg, else the workflow the LAST session was on
   // (settings read straight from disk: the comfyts global only exists once a
   // module imports), else the first candidate that LOADS: a module whose
   // import throws (missing schema cache, bad code) or that exports no
   // DefinedWorkflow becomes a red row in the tree, never a crash
   const preferred =
      !isDir && workflowFiles.includes(abs) ? abs : target == null ? rememberedWorkflow(workflowFiles) : null
   const candidates = preferred != null ? [preferred, ...workflowFiles.filter((f) => f !== preferred)] : workflowFiles
   const loadErrors = new Map<string, string>()
   let first: string | null = null
   let wf: DefinedWorkflow | null = null
   for (const file of candidates) {
      try {
         const mod: Record<string, unknown> = await import(pathToFileURL(file).href)
         const found = findDefinedWorkflow(mod)
         if (found == null)
            throw new Error(`${file} exports no DefinedWorkflow — export the result of host.defineWorkflow(...)`)
         first = file
         wf = found
         break
      } catch (e) {
         loadErrors.set(file, extractErrorMessage(e))
      }
   }
   if (first == null || wf == null) {
      console.error(`[comfy-ts tui] no loadable workflow module among ${candidates.length} file(s):`)
      for (const [file, err] of loadErrors) console.error(`   ${file}: ${err}`)
      return 1
   }

   const st = new TuiSt(wf, { workflowFiles, currentFile: first, bundledFiles: discovery.bundled, loadErrors })
   // ALT SCREEN (TTY only): deterministic absolute coordinates for the protocol
   // image painter + no scrollback pollution / clipped first row.
   // modifyOtherKeys mode 1 rides along: vscode/xterm.js then ENCODES modified ⏎
   // (so ⇧⏎ stops arriving as a plain-`\r` commit) as `CSI 27;mods;13~` —
   // translated in TuiApp via keys.ts. Mode 1 only touches keys without
   // well-known sequences (mode 2 would re-encode ctrl+letters and break the
   // editor keys); unsupporting terminals ignore it.
   const altScreen = process.stdout.isTTY === true
   if (altScreen) process.stdout.write('\u001b[?1049h\u001b[H\u001b[>4;1m')
   // RAW MODE BEFORE RENDER: ink's kittyKeyboard auto-detect sends its `CSI ? u`
   // query from the Ink constructor, but raw mode only turns on later when
   // useInput mounts. In that window the terminal's `CSI ? 0 u` reply is echoed
   // by termios (ECHOCTL) as literal `^[[?0u` into the first frame (his repro).
   // Raw mode off = echo on, so flip it ourselves first (inside the try so the
   // finally always restores); ink owns it afterwards and restores cooked mode
   // on exit.
   // REAL images over the preview panel rect on OSC-1337 terminals (repaints
   // after every stdout flush + on image change — NOT a React effect)
   const uninstallPainter = installProtocolImagePainter(st)
   try {
      if (process.stdin.isTTY === true) process.stdin.setRawMode(true)
      // kittyKeyboard auto: ink queries `CSI ? u` and enables CSI-u encoding
      // where supported (iTerm2 3.5+/WezTerm/kitty/ghostty) — ⇧⏎ parsed natively
      const app = render(<TuiApp st={st} />, { kittyKeyboard: { mode: 'auto' } })
      // dispose: flush reactions/listeners + close every ws opened by loaded modules
      st.onExit = () => st.dispose()
      await app.waitUntilExit()
      st.dispose()
   } finally {
      // ink restores cooked mode on clean exit; this covers a throw before mount
      if (process.stdin.isTTY === true) process.stdin.setRawMode(false)
      uninstallPainter()
      // reset colors + erase WHILE STILL in the alt screen: ED deletes iTerm
      // inline images too — without this the last protocol image and stray
      // background colors survive into the shell (his repro)
      if (altScreen) process.stdout.write('\u001b[0m\u001b[2J\u001b[H\u001b[>4;0m\u001b[?1049l')
   }
   return 0
}
