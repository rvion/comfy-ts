---
description: Set up comfy-ts in this project, install it and generate the typed SDK of a ComfyUI host. Use when a project starts using comfy-ts or adds a ComfyUI host.
argument-hint: "[host-url] [host-id]"
---

Set up comfy-ts in this project. Arguments: $ARGUMENTS

The host url is where ComfyUI listens (default `http://127.0.0.1:8188`); ask for it when none is given and the default does not answer. The host id is a short stable name of your choice (`local`, `my-gpu`): it names the generated types, so never change it later.

1. Install with the project's package manager: `bun add comfy-ts` (or npm, pnpm, yarn). Workflow modules run under bun, so check `bun --version` too.
2. Read `node_modules/comfy-ts/guide-for-agents.md`, section "Setup flow", and do each step for this host: `bunx comfy-ts gen --id <host-id> --host <host-url>`, the tsconfig `include`, the `.gitignore` line. A Comfy Cloud host also needs `--api-key` or `COMFY_CLOUD_API_KEY`.
3. Add `@./node_modules/comfy-ts/guide-for-agents.md` as a line of the project's `CLAUDE.md`, so every session knows the library.
4. Check: `.comfy-ts/hosts/<host-id>/sdk.d.ts` exists and the project still typechecks.

Report the host id, the node count `gen` printed, and every file you changed.
