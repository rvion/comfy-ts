#!/usr/bin/env node
// sidekick CLI: `bunx comfy-ts <command>` — codegen without writing any code
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runGen } from 'src/cli/gen.ts'
import { runLoras } from 'src/cli/loras.ts'
import { runOutline } from 'src/cli/outline.ts'

const HELP = `comfy-ts — typed SDK codegen for ComfyUI

Usage:
   comfy-ts gen --id <host-id> [--host http://127.0.0.1:8188] [--api-key <key>] [--out <sdk-path>]
         fetch object_info + embeddings from a live ComfyUI host and write
         .comfy-ts/hosts/<host-id>/{object_info.json,embeddings.json,sdk.d.ts}
         (--api-key or COMFY_CLOUD_API_KEY authenticates via X-API-Key;
         --out relocates ONLY the sdk.d.ts, e.g. a committed cloud catalog)

   comfy-ts outline [file] [--lines N] [--section Name]
         outline a generated sdk.d.ts (defaults to the first one in .comfy-ts/hosts/)

   comfy-ts loras [--id <host-id>] [--host http://…] [--api-key <key>]
         mirror what the optional ComfyUI-Lora-Manager extension knows about
         every lora into .comfy-ts/hosts/<id>/loras.json: real model names,
         civitai trigger words, tags, base model, preview urls. The TUI then
         fuzzy-matches loras by their human name and auto-injects their trigger
         words into v.prompt (⌃K still overrides, per lora). --id defaults to
         the only host folder on disk, --host to the url the last sync used

   comfy-ts tui [dir | workflow-module.ts]
         interactive tweak & re-run over **/*.cflow.ts modules (exporting
         host.defineWorkflow(...)); no arg scans cwd + the examples bundled
         with comfy-ts, an explicit dir/file limits to it (file preselected)

   comfy-ts serve [dir | workflow-module.ts] [--port 8288] [--host 127.0.0.1]
         drafts as a local HTTP generation API: POST /generate/<module>/<draft>
         with { ...vars } overriding the draft's values (blocking; raw image
         bytes under Accept: image/*), GET /drafts self-describes every var,
         GET /outputs/... serves the results. Open / in a browser for the web
         panel. No bundled examples, no auth, and any origin may call it: use
         --host beyond localhost only on a network you trust.

   comfy-ts help
`

async function main(): Promise<number> {
   const [cmd, ...rest] = process.argv.slice(2)
   if (cmd === 'gen') return runGen(rest)
   if (cmd === 'outline') return runOutline(rest)
   if (cmd === 'loras') return runLoras(rest)
   if (cmd === 'tui' || cmd === 'serve') {
      // .cflow.ts workflow modules need bun: node refuses to strip types under
      // node_modules, exactly where the packaged examples live — and the bin's
      // node shebang means `bunx comfy-ts tui|serve` lands here under NODE. Hop
      // to bun when we are not already in it; without bun, degrade loudly.
      if (process.versions.bun == null) {
         const self = fileURLToPath(import.meta.url)
         const res = spawnSync('bun', [self, cmd, ...rest], { stdio: 'inherit' })
         if (res.error == null) return res.status ?? 1
         console.error(
            `[comfy-ts ${cmd}] bun not found (${res.error.message}) — continuing under node: the examples packaged in node_modules cannot load here, and your own .cflow.ts modules rely on node's type stripping`,
         )
      }
      if (cmd === 'serve') {
         const { runServe } = await import('src/cli/serve/run-serve.ts')
         return runServe(rest)
      }
      // lazy import: keeps ink/react out of the codegen paths
      const { runTui } = await import('src/cli/tui/run-tui.tsx')
      return runTui(rest)
   }
   console.log(HELP)
   return cmd == null || cmd === 'help' ? 0 : 1
}

// a thrown command (a flag with no value, an unreadable path) must print ONE
// clear line and exit non-zero, never a raw unhandled-rejection stack
process.exitCode = await main().catch((e: unknown) => {
   console.error(`[comfy-ts] 🔴 ${e instanceof Error ? e.message : String(e)}`)
   return 1
})
