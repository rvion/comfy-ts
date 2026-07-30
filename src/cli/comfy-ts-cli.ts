#!/usr/bin/env node
// sidekick CLI: `bunx comfy-ts <command>` — codegen without writing any code
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runGen } from 'src/cli/gen.ts'
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

   comfy-ts tui [dir | workflow-module.ts]
         interactive tweak & re-run over **/*.cflow.ts modules (exporting
         host.defineWorkflow(...)); no arg scans cwd + the examples bundled
         with comfy-ts, an explicit dir/file limits to it (file preselected)

   comfy-ts help
`

async function main(): Promise<number> {
   const [cmd, ...rest] = process.argv.slice(2)
   if (cmd === 'gen') return runGen(rest)
   if (cmd === 'outline') return runOutline(rest)
   if (cmd === 'tui') {
      // .cflow.ts workflow modules need bun: node refuses to strip types under
      // node_modules, exactly where the packaged examples live — and the bin's
      // node shebang means `bunx comfy-ts tui` lands here under NODE. Hop to
      // bun when we are not already in it; without bun, runTui degrades loudly.
      if (process.versions.bun == null) {
         const self = fileURLToPath(import.meta.url)
         const res = spawnSync('bun', [self, 'tui', ...rest], { stdio: 'inherit' })
         if (res.error == null) return res.status ?? 1
         console.error(
            `[comfy-ts tui] bun not found (${res.error.message}) — continuing under node: the examples packaged in node_modules cannot load here, and your own .cflow.ts modules rely on node's type stripping`,
         )
      }
      // lazy import: keeps ink/react out of the codegen paths
      const { runTui } = await import('src/cli/tui/run-tui.tsx')
      return runTui(rest)
   }
   console.log(HELP)
   return cmd == null || cmd === 'help' ? 0 : 1
}

process.exitCode = await main()
