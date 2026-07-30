# comfy-ts

## 1.1.0

The model zoo release: 46 ready-to-run cloud workflows, a real image picker
in the TUI, and a registry mirror that doubled.

### The example zoo

- `examples/comfy-cloud/`: 45 new workflow modules transcribed from the
  official ComfyUI templates, named `<family>-<mode>` across 32 model
  families: t2i (sdxl, sd3.5, flux1, flux2, qwen-image, z-image, chroma,
  hidream, omnigen2, kandinsky5, krea2, and more), i2i edits, t2v and i2v
  video (wan 2.1/2.2, ltxv, hunyuan video 1.5, svd, kandinsky5), t2a audio
  (ace-step, stable-audio, chatterbox). Every file typechecks against the
  committed Comfy Cloud catalog SDK and builds a problems-free graph
  offline; each header names its source template and run command.
- `examples/README.md` + a shared `cloudHost.ts` helper: one host setup, one
  pattern. Keyless machines can still open everything in the TUI; standalone
  runs ask for `COMFY_CLOUD_API_KEY` with a clear message.
- Video/audio examples print where the result landed host-side (their
  outputs are not downloadable images yet).

### `v.image` + the TUI image picker

- New var kind `v.image(path, { folder?, extensions? })`: a plain path
  string (hand-editable in drafts), `~` expansion, typed loud error when a
  build needs an image and none is set.
- The TUI opens a full image picker on image vars: browse the disk, filter
  as you type, favorite folders, recent picks, live preview of the
  highlighted image in the preview panel. Favorites/recents/last folder
  persist to a human-editable `.comfy-ts/image-picker.json`.
- `examples/images/`: six bundled sample images (picsum.photos, Unsplash
  sourced, free to use) with exact sizes in the filename
  (`bear_1024x1024.jpg`…); `exampleImagePath('dog_512x512.jpg')` resolves
  them from the installed package, so every i2i example runs out of the box.

### Ecosystem registry, doubled

- The ComfyUI-Manager mirror moved to the canonical Comfy-Org sources and
  regenerated: 5882 plugins (was 2569), 41204 known custom node names (was
  19278), 540 models. Every registry row is validated individually; a parse
  report (accepted / skipped with causes) prints at every regeneration.
- New npm keywords + description; the README gained hosts, codegen, and
  examples sections reflecting all of the above.

## 1.0.0

The 1.0: every Comfy is supported (local, LAN, Comfy Cloud, any provider),
the official template corpus imports at 99.5%, and the TUI works out of the
box with zero arguments.

### Cloud and remote hosts

- New host config spelling: `comfy.host({ id, url })` takes a full base url
  as pasted from a provider (`https://cloud.comfy.org`,
  `https://xxx.modal.run`, base paths supported). The legacy
  `{ host, port, https? }` spelling is unchanged; use exactly one of the two.
- `apiKey` rides `X-API-Key` on every request AND the websocket upgrade;
  `headers` merges extra auth pairs (Modal style). Auth failures are typed:
  invalid key (401), insufficient credits (402), subscription inactive (429).
- Routes prefer the `/api/*` spelling with automatic fallback for older
  local servers; output downloads follow Comfy Cloud's signed-url redirect
  without leaking the key cross-origin.
- Binary websocket preview frames of type 3 and 4 (image + metadata, the
  Comfy Cloud spelling) now feed latent previews; unknown frame types log
  once instead of throwing.
- `comfy-ts gen` gained `--api-key` (or `COMFY_CLOUD_API_KEY`) and `--out`.
  The full Comfy Cloud catalog ships in the repo as a browsable generated
  SDK (`examples/comfy-cloud/sdk.d.ts`, 3574 nodes) with a runnable
  [example](examples/rvion/05-comfy-cloud.cflow.ts).

### workflow.json import, rebuilt

- One entry point: `parseWorkflowJson(unknown)` validates with tolerant
  schemas that model what ComfyUI actually serializes today (v0.4 tuple
  links AND v1 object links, hybrid files), then normalizes into one strict
  canonical form. Genuinely invalid input throws a typed
  `WorkflowNormalizeError`; conversion failures throw `WorkflowConvertError`
  with a code naming the feature.
- Subgraphs: `definitions.subgraphs` instances are expanded (nested
  subgraphs, widget promotion in both serializer eras, boundary io by name).
- Execution semantics fixed: Note/MarkdownNote/Reroute/PrimitiveNode are
  skipped as virtual, bypass (mode 4) rewires inputs through to outputs the
  way the frontend does (previously executed as a normal node), muted
  parents resolve unconnected, object-form `widgets_values` resolve by name.
- 2026 widget spellings understood: widget-ness is decided from the input
  CONFIG (COMBO options, dynamic combos, autogrow containers, socketless
  widgets), and positional value arrays shorter than the current schema
  fill from schema defaults.
- Measured on the full official template corpus (762 workflow files from
  Comfy-Org): 100% schema-pass, 99.5% convert structurally.
- `host.importWorkflowJson` now takes `unknown` and validates.

### TUI

- `bunx comfy-ts tui` with no argument never opens empty: it scans your
  project's `*.cflow.ts` (node_modules excluded) AND the examples bundled
  with the package, grouped apart in the tree. An explicit dir or file
  argument scans just that.
- A module that fails to load shows as a red ✗ row (retry with ⏎) instead
  of crashing the TUI; a missing schema cache degrades to base types with a
  loud message instead of throwing at import.

### Packaging

- The npm tarball now ships `examples/` and `guide-for-agents.md`. Add
  `@./node_modules/comfy-ts/guide-for-agents.md` to your `CLAUDE.md` and
  your coding agent knows the whole library.

### Breaking

- `convertLiteGraphToPrompt` consumes the new canonical form; import errors
  are typed (`WorkflowNormalizeError` / `WorkflowConvertError`) instead of
  ad-hoc throws, and the former `UnknownCustomNode` error class folded into
  the `unknown-node` error code.
- `host.loadSchemaFromCache()` with no cache on disk no longer throws: it
  logs and continues on permissive base types (call `connect()` or run
  `gen` to sharpen).

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
