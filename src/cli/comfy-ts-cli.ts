#!/usr/bin/env node
// sidekick CLI: `bunx comfy-ts <command>` — codegen without writing any code
import { runGen } from 'src/cli/gen.ts'
import { runOutline } from 'src/cli/outline.ts'

const HELP = `comfy-ts — typed SDK codegen for ComfyUI

Usage:
   comfy-ts gen --id <host-id> [--host http://127.0.0.1:8188]
         fetch object_info + embeddings from a live ComfyUI host and write
         .comfy-ts/hosts/<host-id>/{object_info.json,embeddings.json,sdk.d.ts}

   comfy-ts outline [file] [--lines N] [--section Name]
         outline a generated sdk.d.ts (defaults to the first one in .comfy-ts/hosts/)

   comfy-ts tui [dir | workflow-module.ts]
         interactive tweak & re-run over **/*.cflow.ts modules (exporting
         host.defineWorkflow(...)); no arg scans cwd, a file arg preselects it

   comfy-ts help
`

async function main(): Promise<number> {
   const [cmd, ...rest] = process.argv.slice(2)
   if (cmd === 'gen') return runGen(rest)
   if (cmd === 'outline') return runOutline(rest)
   if (cmd === 'tui') {
      // lazy import: keeps ink/react out of the codegen paths
      const { runTui } = await import('src/cli/tui/run-tui.tsx')
      return runTui(rest)
   }
   console.log(HELP)
   return cmd == null || cmd === 'help' ? 0 : 1
}

process.exitCode = await main()
