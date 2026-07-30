# comfy-ts

Type-safe ComfyUI companion library for TypeScript, published on npm as `comfy-ts`.
Connects to any number of ComfyUI hosts (local or remote), generates ONE typed SDK
per host (`Comfy.<HostNs>.*` global namespaces), lets you build workflows
programmatically with full autocomplete, executes them over websocket, retrieves
outputs, and ships a sidekick CLI (codegen, sdk outline, interactive TUI).
Extracted from CushyStudio.
Stack: Bun, TypeScript strict (nodenext), oxlint + oxfmt, tsdown for dist, bun test.

🔴 FOR NOW: NEVER `git push`. Commit locally only — every change is reviewed
locally before anything reaches GitHub or npm.

## Quick start

- `bun run ci` — typecheck:lib + lint + format + imports + tests (the gate; what
  GitHub runs, portable to a clone with no host sdk on disk)
- `bun run ci:local` — the gate PLUS the full typecheck (examples included, needs
  a generated `.comfy-ts/hosts/*/sdk.d.ts`) — use this one while developing here
- `bun run gen:sdk` — regenerate `.comfy-ts/hosts/<id>/sdk.d.ts` from cached object_info
- `bun run sdk:outline` — inspect a generated sdk.d.ts section by section
- `bun run templates:fetch` — mirror every official Comfy-Org template/blueprint
  JSON into `.comfy-ts/templates/` (gitignored upstream data cache)
- `bun run templates:check` — compat sweep of that corpus against our litegraph
  schemas; the failure ranking is the format-grind worklist
- `bun run tui` opens the TUI over `**/*.cflow.ts` under cwd (tweak & re-run)
- `bun run hooks:install` activates the banned-keywords commit guard (`.githooks/`)
- examples in `examples/` are `*.cflow.ts` workflow modules: they import offline
  from the schema cache, connect to a live ComfyUI host on first run

Full spec in this folder — update docs BEFORE changing code.

## Two changelogs, and they never mix

- `.rv-journal/changelog.md` — PRIVATE (gitignored, stays on this machine).
  The engineering journal: session by session, what broke, which repro drove
  the fix, dead ends, who asked for what. Write here first, freely.
- `CHANGELOG.md` — PUBLIC, shipped in the npm tarball and on GitHub. Only what
  a USER of the library can observe: new API, changed behaviour, breaking
  renames. No session numbers, no repro anecdotes, no names, no intermediate
  states that were wrong before they were right.

A release rewrites the public entry FROM the journal; it never copies it.

**Always loaded every session** (`philosophy.md` is the WHY, on demand):

@coding.md

Read the matching doc before touching a surface:

| read when touching…                           | doc                     |
| --------------------------------------------- | ----------------------- |
| anything cloud / upstream service behavior    | `agent/external-docs/<source>/` — pasted or imported upstream .md pages, frontmatter `url:` + `importedAt:` (comfy-cloud/ seeded 2026-07-30) |
| goals & feature matrix (what the lib promises)| `agent/features.md`     |
| any file layout / class / data-flow question  | `agent/architecture.md` |
| the per-host codegen or `Comfy.*` namespaces  | `agent/sdk-codegen.md`  |
| recent changes / why a thing is the way it is | `.rv-journal/changelog.md` |
