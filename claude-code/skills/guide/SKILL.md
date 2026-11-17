---
description: Background for projects that use comfy-ts, the typed TypeScript SDK for ComfyUI. Use when code imports comfy-ts, touches a *.cflow.ts module or a .comfy-ts/ folder, or builds, runs, converts or debugs ComfyUI workflows from TypeScript.
argument-hint: "[question about comfy-ts]"
---

# comfy-ts

comfy-ts generates one typed SDK per ComfyUI host and builds workflows in TypeScript with autocomplete on every node, then runs them over the host's websocket.

Before you write or change comfy-ts code, read the guide of the installed version: `node_modules/comfy-ts/guide-for-agents.md` (in a workspace it can sit in a parent `node_modules`). It holds the workflow pattern, the var kinds, running, import and export, and the gotchas. No such file means comfy-ts is not installed yet: set it up first.

Where things are:

- `.comfy-ts/hosts/<id>/sdk.d.ts`: the generated types of host `<id>`. Grep it, never read it whole: the first `  <NodeName>: {` block lists that node's inputs, the next one its outputs. `bunx comfy-ts outline` lists its sections.
- `.comfy-ts/hosts/<id>/object_info.json`: the raw schema those types come from.
- `node_modules/comfy-ts/examples/`: working `*.cflow.ts` modules to copy patterns from.
- `bunx comfy-ts help`: every CLI command.

Model files, loras and enum values are literal unions of the real host: take them from `sdk.d.ts`, never invent one.

When the user typed a question with this command, answer it from the guide, the sdk and the examples.
