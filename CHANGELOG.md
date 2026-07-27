# comfy-ts

## 0.4.0

Everything user-facing that landed since 0.3.0. No breaking changes.

### Host awareness in the TUI

- The `(h)ost` header box carries a LIVE reachability dot: green when the
  host answers, red when it doesn't, gray while unknown. The truth comes
  from an HTTP probe every 5s, so a dead host turns red even when a
  half-open websocket still claims to be connected. While down, the box
  shows the probe loop working: a spinner during the attempt, then a
  `↻ Ns` countdown to the next one.
- New `comfy host logs` panel below the run area: the ComfyUI server
  console streams into the TUI (backfill + live follow, ANSI stripped,
  progress-bar redraws collapsed to their latest state, error lines red).
  If the server sends no latent previews mid-run, the preview panel says
  so and names the fix (`--preview-method auto`).

### Preview settings menu

- `p` no longer blind-cycles: it opens a settings menu inside the preview
  panel. Three independent, persisted settings: `panel` on/off, `renderer`
  native (real images) / pixel (half-blocks), and `while running` latent /
  latent small / last output. `latent small` keeps the last output as the
  big image with the live latent in the top-right corner; `last output`
  ignores latent frames entirely. ←→ change values, ⏎/p/esc close.
- Native rendering is now flicker-free (repaints are synchronized with the
  frame that damaged them, DEC 2026) and the terminal is restored clean on
  quit (no leftover image, no stray colors).

### Library

- `ComfyHost.onSession(sid)` fires on every websocket session assignment
  (first connect AND reconnects) — the hook for per-session server state.
- `ComfyHost.onLogs` + `subscribeLogs({ enabled, clientId })` +
  `fetchRawLogs()` expose ComfyUI's `/internal/logs` console stream; the
  `logs` websocket message type is part of the typed `WsMsg` union.

## 0.3.0

Everything user-facing that landed since 0.2.0. Breaking changes are marked 💥.

### The re-run contract: `defineWorkflow` + vars

- `host.defineWorkflow({ id, vars, build })` declares the knobs once; `build`
  re-executes against the current values on every `run()`, producing a fresh
  graph each time. Var kinds: `v.text` `v.int` `v.float` `v.seed` `v.toggle`
  `v.choice` `v.size` `v.loras` `v.prompt`.
- `vars` may be a LAMBDA receiving `v`: `vars: (v) => ({ loras: v.loras(/krea/i), … })`
  so cross-referencing vars share one scope, with the host's generated types
  injected (no import, no user-side cast).
- `v.loras` accepts a RegExp directly (resolved against the host's real lora
  list at define time) or any dynamic list such as `host.schema.getLoras(/xl/i)`.
  `activeLoras(vars.loras)` normalizes to `{ lora_name, strength_model,
  strength_clip }[]` for a standard `LoraLoader` chain.
- `v.prompt` yields a structured `{ positive, negative }` at build time: `//`
  lines are comments, `- ` lines are negative prompt lines, and with
  `{ loraKeywordsFrom: lorasVar }` the active loras' trigger words prefix the
  positive prompt.
- `v.seed` is a MODE plus a number (`+ N` increment, `- N` decrement, `= N`
  fixed, `? N` reroll), advanced after every run, so a queued batch gets
  distinct seeds.

### Execution

- `workflow.run({ log, onProgress })` reports live progress; `run({ log: true })`
  renders a single updating console line. `execution.done` resolves on success
  AND failure (inspect `status`), and `execution.images` are `MediaImage`s on
  disk.
- `start()` freezes an `ExecutionSnapshot` (api json + workflow json) at send
  time, so the live workflow stays editable while a run is in flight.
- Failed image retrievals land in `execution.imageErrors` instead of hanging
  `done`.

### The TUI (`bunx comfy-ts tui`)

- Keyboard-first three-panel terminal UI over every `*.cflow.ts` in a folder:
  workflow tree with drafts nested under each workflow, vars panel, preview.
- Drafts: named var-value snapshots per workflow, always-in-a-draft, debounced
  autosave, full CRUD; the last active draft per workflow is remembered.
- Preview panel: live latent previews while a run is in flight, then the final
  output. `p` cycles native → ansi → off; on iTerm2 / WezTerm / VS Code
  terminals "native" paints the REAL image, elsewhere truecolor half-blocks.
- `r` during a run queues another prompt on the server; progress, previews and
  outputs follow every queued run, not just the first.
- Multiline prompt editor with readline word ops, line-wise motion, `// `
  comment toggling, `- ` negative lines, and the injected lora keywords shown
  as non-editable chrome.
- Host panel: node/lora/embedding counts, live server queue length, re-codegen
  the SDK, restart ComfyUI, clear the pending queue, interrupt the current run.

### Imports, exports, ecosystem

- `toApiJson()` / `toWorkflowJson()` (autolayouted litegraph JSON, drag it into
  the ComfyUI editor) and the reverse `host.importApiJson()` /
  `host.importWorkflowJson()`.
- ComfyUI-Manager registry mirror: install custom nodes and models, plus
  generated `Known*` unions over the whole ecosystem.
- ComfyUI-Lora-Manager support: lora preview images in the TUI when the
  extension is present, quietly skipped when it is not.

### 💥 Breaking

- The great renaming, pre-1.0: `ComfyPrompt` → `ComfyExecution`,
  `sendPrompt`/`sendPromptAndWaitUntilDone` → `start()`/`run()`,
  `prompt.finished` → `execution.done`, `json_forPrompt()`/`json_workflow()` →
  `toApiJson()`/`toWorkflowJson()`, `CONNECT()`/`DISCONNECT()` →
  `connect()`/`disconnect()`, `createEmptyWorkflow()` → `workflow()`,
  `MediaImageL` → `MediaImage`, `nameInCushy` → `nodeKey`, `src/livegraph/` →
  `src/graph/`.
- `ComfyUIObjectInfoParsed` and `ComfySchema` merged into one `ComfySchema`.

### Under the hood

- Dual ESM/CJS build via tsdown (TypeScript 7 / tsgo emits the dts), oxlint +
  oxfmt, bun test.
- The library typechecks with NO generated sdk on disk, which is what a fresh
  clone and CI see.

## 0.2.0

### Minor Changes

- setup repo
