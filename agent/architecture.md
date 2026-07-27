# Architecture

## Stack

- **Runtime**: Bun (scripts, tests); library ships dual ESM/CJS via tsdown for node ≥20 consumers
- **Language**: TypeScript strict, `module: nodenext`, absolute `src/...ts` imports
- **Validation**: ArkType (all wire payloads: object_info, ws messages, manager JSONs)
- **Images**: sharp (re-encode) + image-meta (introspection)
- **Lint/Fmt**: oxlint + oxfmt (3-space, single quotes, no semi, 120 cols)
- **Testing**: bun test
- **Publish**: npm `comfy-ts` (tsdown → dist/, dts emitted by tsgo; `src/` also shipped for `comfy-ts/src/*` subpath imports)

## The `.comfy-ts/` folder (consumer contract)

Every repo using comfy-ts gets ONE `.comfy-ts/` folder at its root:

```
.comfy-ts/
   hosts/<host-id>/object_info.json   raw schema dump from the host
   hosts/<host-id>/embeddings.json    embeddings list
   hosts/<host-id>/sdk.d.ts           generated typed SDK (per host)
   outputs/                           generated images / workflows
```

This repo eats its own dogfood: `.comfy-ts/hosts/windows-1/` is generated
locally (`bun run gen:sdk`) and included by tsconfig, so examples typecheck
against the REAL host types on this machine. It is NOT committed and never
will be: a host dump is that machine's entire model/lora inventory plus its
filesystem paths (~10 MB), i.e. someone's private setup. A clean clone has no
`sdk.d.ts` at all — the frozen invariant below is exactly what keeps that
clone (and CI) green.

## File structure

```
src/index.ts               public entry: re-exports everything below
src/state.ts               ComfyTS singleton (global `comfyts`), path resolution, lazy registry
src/types/index.ts         shared branded types (AbsolutePath, Maybe, Result, …)
src/types/comfy-sdk.ts     base global Comfy.* namespace + Hosts registry + SdkForHost<ID>
src/host/                  per-server connection layer
   ComfyHost.ts            central class: ws lifecycle, schema fetch, sdk regen, msg routing
   ComfyManager.ts         ComfyUI-Manager plugin HTTP API (install plugins/models, reboot)
   ComfyUploader.ts        image upload with hash-dedupe against host schema
   ComfyWorkflowBuilder.ts runtime builder (one factory per schema node, dynamic)
   ResilientWebsocket.ts   auto-reconnect ws wrapper
   Requirements.ts         requirement types for matchRequirements
   loraManagerApi.ts       ComfyUI-Lora-Manager extension client (list + previews)
src/runner/                execution
   ComfyWorkflow.ts        live graph, prompt JSON emission, POST /prompt, progress
   ComfyExecution.ts          one execution: done promise (success AND failure), images + imageErrors
   ComfyWsApi.ts           arktype schemas of every ws message
   MediaImage.ts           MediaImage: lazy buffer/metadata/hash, sharp pipelines, upload helpers
   ComfyWorkflowLayout.ts  autolayout for exported litegraph JSON
src/graph/                 programmatic node graph (ComfyNode, ComfyNodeOutput, auto())
src/vars/                  Vars (v.*) + DefinedWorkflow: the tweak & re-run contract
src/cli/                   sidekick CLI (gen, outline, tui)
src/cli/tui/               ink+mobx TUI, per build/app-state-tree doctrine:
   state/TuiSt.ts          ROOT state tree (one instance); children get `st` backref
   state/EditorSt.ts       line/multiline editor (code-point ops)
   state/PickerSt.ts       choice + size overlays (fuzzy filter, WxH custom)
   state/LorasSt.ts        loras overlay (filter, tick/untick, strengths, bulk,
                           lora-manager preview into the preview panel)
   state/WorkflowsSt.ts    module loading + host set (data layer under TreeSt)
   state/TreeSt.ts         left tree: workflows + nested drafts, fold/unfold, focus
   state/HostSt.ts         host panel: stats + actions (re-codegen SDK, restart) + live up/down probe
   state/LogsSt.ts         server console lines: /internal/logs backfill + ws 'logs' stream, chunk→line assembly
   components/LogsPanel.tsx  last server log lines below the vars panel
   state/DraftsSt.ts       named var snapshots, autosave reaction (owned disposer)
   state/SettingsSt.ts     persisted TUI settings (.comfy-ts/settings.json):
                           preview mode + last draft per workflow
   state/ExecSt.ts         run/progress/outputs/notice/clipboard/open
   state/PreviewSt.ts      preview renders, panel sizing, `p` settings menu (panel/renderer/while-running)
   components/*.tsx        stateless views: TuiApp (layout+keys), VarsPanel,
                           overlays, PreviewPanel, StatusBar
   keys.ts                 modified-⏎ translation for xterm modifyOtherKeys
   run-tui.tsx             entry: scan, load module, keyboard protocols, mount,
                           dispose
src/litegraph/             ComfyUI saved-workflow JSON format (types + arktype), converter
src/sdk-generator/         object_info parsing + per-host codegen (see agent/sdk-codegen.md)
src/manager/               ComfyUI-Manager registry mirror (json/ + generated/ + loaders)
src/ssh-host-manager/      ssh config upsert + remote-exec helpers for remote GPU boxes
src/image-utils/           png/webp/exif metadata extraction
src/utils/                 bang, CodeBuffer, ansi, log, toposort, …
scripts/                   bun-run tooling (gen-sdk-from-cache, sdk-outline, check-banned)
.githooks/                 git hooks (pre-commit + commit-msg → scripts/check-banned.ts);
                           activated via core.hooksPath (`bun run hooks:install`)
examples/                  runnable `*.cflow.ts` workflow modules (self-dogfooding via tsconfig path 'comfy-ts')
tests/                     bun tests (headless) + fixtures
```

## Key abstractions & data flow

1. `ComfyTS.create()` → returns the existing global `comfyts` or creates+registers
   it (path resolution + registry). Safe to call from EVERY module — the TUI
   imports many workflow modules into one process. `new ComfyTS()` still throws
   on a second instance (create() is the multi-module path).
2. `comfyts.host({ id: 'windows-1', host, port })` → `ComfyHost<'windows-1'>`.
   Registry keyed by id: same id → the SAME instance back (host/port must match,
   loud throw otherwise). `connect()` is idempotent (cached ready promise) —
   one ws per host, ever.
3. `host.connect()` → ws connect → `fetchAndUpdateSchema()` → GET /object_info +
   /embeddings → arktype-validate → `ComfySchema` → `ComfyUIObjectInfoParsed` →
   `codegenSDK({hostId})` → write `.comfy-ts/hosts/<id>/sdk.d.ts`.
4. `host.workflow()` → `ComfyWorkflow<'windows-1'>`; `workflow.builder`
   is typed `Comfy.Windows1.Builder` (via `SdkForHost`), each call creates a `ComfyNode`.
5. `workflow.run({ log, onProgress })` → `start()` freezes an ExecutionSnapshot
   (apiJson + workflowJson), POSTs /prompt; ws messages route
   `ComfyHost.onMessage` → `routeOrBuffer` → `ComfyExecution.onPromptRelatedMessage`;
   progress emits per message; executed images land in `execution.images: MediaImage[]`;
   `execution.done` resolves on success AND failure (check `status`).
6. re-run contract: `host.defineWorkflow({ vars, build })` → `DefinedWorkflow` —
   `build(b, varValues, wf)` re-executes per `run()`; it may be ASYNC (uploads
   etc. — the wf param feeds `MediaImage.loadInWorkflow_*`). `run()` starts with
   `await host.connect()` (idempotent), so modules import OFFLINE from the
   schema cache (`loadSchemaFromCache`) and connect lazily on first run.
   Drivers: scripts (`import.meta.main` guard for standalone blocks) and
   `comfy-ts tui <module>`. EVERY example is such a module (`*.cflow.ts`).
   Var kinds: text/int/float/seed/toggle/choice + `v.loras(options, initial?)`
   (multi-select over a DYNAMIC options list — a RegExp resolves against the
   host's loras at define time (`bindHost`), or feed it host discovery like
   `host.schema.getLoras(regex?)`, NEVER a hardcoded inventory; selection
   empty by default; `activeLoras()` normalizes to
   `{lora_name, strength_model, strength_clip}[]` for a standard LoraLoader
   chain) + `v.size` ({width,height}, SDXL-bucket presets, `WxH` custom entry)
   + `v.prompt` (PromptVar, kind 'text'): its BUILD value is a
   `PromptValue { positive, negative }` — `//` lines are comments (stripped),
   `- ` lines are NEGATIVE prompt lines (comma-joined into `.negative`), and
   with `{ loraKeywordsFrom: lorasVar }` the ACTIVE loras' hand-assigned
   keywords prefix `.positive` (`src/vars/loraKeywords.ts`, persisted
   `.comfy-ts/lora-keywords.json`, assigned via ⌃K in the loras overlay).
   Vars expose `outValue(): Out` (what the graph consumes) next to
   `toJSON()` (what drafts persist): `ComfyVarBase<T, Out>` declares it
   abstract, `ComfyVar<T> = ComfyVarBase<T, T>` returns the raw value —
   PromptVar is the one var whose Out differs. `VarValues` maps outValue()
   return types; `varValues()` calls it. `defineWorkflow.vars` may be a
   LAMBDA (`(v) => V`, resolved once at define time) so cross-referencing
   vars can be created inline — the lambda RECEIVES `v` (no import), typed
   `BoundVars<ID>` so `v.loras(regex)` yields the host's generated
   lora-name union with no user-side cast.
   A seed is MODE + NUMBER (`+ N` increment / `- N` decrement / `= N` fixed /
   `? N` reroll): `SeedVar.advance()` applies the mode after EVERY
   `DefinedWorkflow.run()` (library-level — scripts get auto-increment too).
   Drafts persist vars via `ComfyVar.toJSON()`/`loadJSON()` (seed stores
   `{mode, value}`; legacy plain numbers load as `= N`).
7. TUI editing: inline single-line editor for numbers; text/choice/loras open a
   modal overlay (ink has no z-order — the overlay REPLACES the vars panel while
   open). Text overlay = real-multiline editor (⏎ saves, ⇧⏎/⌥⏎ newline;
   line motion is ALWAYS line-wise, never buffer-wise: Home/End, ⌘←→ (kitty
   `super`) AND ⌃A/⌃E all land on the LOGICAL line's start/end, and pressing
   again when already there hops to the previous/next line's start/end.
   ⌃A/⌃E must share that meaning because "natural text editing" terminals
   (iTerm2 preset, VS Code on macOS) translate ⌘←/⌘→ into ^A/^E before the
   app ever sees a ⌘ — that translation, not the kitty path, is what most
   setups use. There is no buffer-start/end motion key (⌃U/⌃K still kill to
   the buffer bounds). Also ⌥↑↓ move the logical line, ⌘//⌃//⌥/ toggle
   `// ` comments — comment lines render dim gray, the current logical line
   is background-highlighted);
   choice overlay = fuzzy-filterable option list; loras overlay = tick/untick +
   per-item strength stepping. ⌃R runs from ANY mode (plain letters type into
   filters/editors; a bare ⌘ chord only reaches the app on kitty-protocol
   terminals — elsewhere it is intercepted or rewritten to a control byte).
   ⇧⏎ needs a terminal that ENCODES modified ⏎ (plain `\r` is
   ambiguous): run-tui enables BOTH the kitty keyboard protocol (ink 7
   `kittyKeyboard: auto` — parsed natively) and xterm modifyOtherKeys mode 1
   (vscode/xterm.js — its `CSI 27;mods;13~` reaches useInput unparsed as
   literal input, translated by `src/cli/tui/keys.ts`); elsewhere ⌥⏎.
8. TUI lora previews: while the loras overlay is open, the `(p)review` panel
   shows the SELECTED lora's preview image, resolved through the optional
   ComfyUI-Lora-Manager extension (`src/host/loraManagerApi.ts`: paged
   `GET /api/lm/loras/list` → `folder/file_name` → `preview_url`, ark-soft-
   validated wire tolerance). No extension / no preview → quiet placeholder
   line, everything else keeps working. Preview fetches only accept `image/*`
   content-types (ComfyUI SPA-fallbacks missing files to 200 index.html) and
   successful bytes are cached at `.comfy-ts/cache/lora-previews/<sha1(url)>`
   (gitignored, read before any fetch).
9. TUI preview: REAL images on capable terminals, half-blocks elsewhere. The
   TUI runs in the ALTERNATE SCREEN (run-tui, TTY only). `p` OPENS THE
   PREVIEW SETTINGS MENU inside the panel itself (mode 'preview', host-panel
   interaction: ↑↓ row, ←→/⏎/space cycle value, p/esc back — the panel
   renders even while hidden so the menu is always reachable). Three
   independent, individually-persisted settings (SettingsSt; the legacy
   single `previewMode` value migrates on load, see
   `migratePreviewSettings`): `panel` on/off (off hides the panel), `renderer`
   native/pixel (native = protocol images, auto-downgraded and cycle-skipped
   on non-protocol terminals; pixel = ▄ half-blocks), and `while running`
   latent / latent small / last output. `latent` paints the live latent full-
   panel; `latent small` keeps the LAST OUTPUT as the big image with the
   latent small in the panel's top-right corner in BOTH renderers (native:
   second OSC paint on top; pixel: line-level composition — the top strip's
   rows are replaced whole by the right-aligned ~40% latent render,
   `overlayTopRight`, no mid-line escape surgery); `last output` ignores
   latent frames entirely (renderLatent short-circuits). Any settings change
   re-renders the last output. Run start clears LATENTS ONLY — the last
   output must survive so 'latent small' / 'last output' have a big image;
   the full preview reset belongs to workflow switches. NO-LATENTS DETECTION: PreviewSt tracks
   `latentSeenThisRun`; when a run is ≥20% in (the gate keeps healthy runs
   from red-flashing before their first frame), latents are wanted, and
   none arrived, the panel title appends a red `no latents!` and the empty
   panel explains the server-side fix (`--preview-method auto`) — the
   2026-07-27 silent failure, surfaced. On iTerm-protocol terminals (TERM_PROGRAM
   iTerm.app/WezTerm/vscode, LC_TERMINAL iTerm2;
   `COMFY_TS_NO_ITERM_IMAGES=1` opts out) the preview panel reserves its cell
   rect as BLANK lines and `protocolImagePainter.ts` re-emits a
   hand-rolled OSC 1337 escape at that rect after EVERY stdout flush (write
   hook + mobx reaction), via raw stdout with cursor save/restore (content
   row 6 — calibrated by playtest on iTerm2 2026-07-27, row 5 painted one
   line too high) — protocol
   images cannot go THROUGH ink (layout shreds the escape, repaints erase the
   cells) but overlay-painting after each repaint works. Geometry derives
   from the SAME observables as the layout (termCols, preview.width/height,
   header height 3). Elsewhere `src/utils/ansiImage.ts` renders truecolor ▄
   half-blocks (why terminal-image was dropped in 4b). Panel sources: live
   latent previews during a run (binary ws frames → `host.onLatentPreview`,
   jpegs passed through), last output after (pre-shrunk once via sharp
   ≤896px), selected lora while the loras overlay is open. Full-res hatch
   elsewhere: `o` opens the OS viewer.
10. TUI workflow tree + drafts: `comfy-ts tui <dir>` scans `**/*.cflow.ts`
   (the workflow-module naming convention) into a persistent LEFT panel titled
   `(t)ree` — `t` focuses it (mode 'tree'); the old `w` modal switcher is gone
   (one code path). The tree NESTS each workflow's drafts under it (←/→ fold/
   unfold, ⏎ loads a workflow into its `default` draft or a draft row
   directly); drafts are keyed by MODULE BASENAME
   (`.comfy-ts/drafts/<module-basename>/<draft>.json`) so the tree lists them
   all without importing modules. Panel borders carry their key as title:
   `(t)ree`, `(v)ars`, `(p)review` (the header boxes carry `(w)orkflow`,
   `(d)raft`, `(h)ost`) — a letter is advertised ONCE: the keybar lists only
   what no panel title already shows (`p` reappears there when the preview
   panel is hidden). Spatial nav is a round trip between the two panels:
   in the vars list ← focuses the tree ON THE ACTIVE DRAFT ROW (not the
   workflow root), → on a tree DRAFT row focuses the vars panel back (`v`
   does it from anywhere), → on a tree WORKFLOW row unfolds it, ← folds. In
   the vars list → activates/edits the var (seed row: `+`/`-`/`=`/`?` set
   the mode, `*` reroll). The TUI is ALWAYS in a
   draft: `default` auto-active per workflow (values loaded when its file
   exists), autosaved (debounced). Draft CRUD (tree draft rows AND the `d`
   overlay): `n` new, `e` rename, `c` duplicate, `x` delete — every name
   prompt is an EditorSt custom session rendered as `PromptOverlay`. The
   header is a row of labeled boxes `comfy-ts · (w)orkflow · (d)raft ·
   (h)ost` (`w` tree, `d` drafts, `h` host panel). The host box carries a
   LIVE reachability dot (green up / red down / gray unknown): HostSt owns
   `status`, refreshed every 5s by an HTTP probe of `/api/prompt` (3s
   timeout). The probe is the GROUND TRUTH even when the ws claims open — a
   half-open socket keeps `isOpen` true forever, trusting it would re-create
   the silent-dead-tunnel failure the dot exists to expose; ws-open only
   picks the `(ws)`/`(http)` label. Switching workflows resets the status to
   unknown and re-probes immediately; a stale in-flight verdict for the
   previous host is dropped. Down is a STATE, not an error: the dot is the
   loud surface, no console spam. While down the box also shows WHAT the
   probe loop is doing: a braille spinner during the in-flight probe, then
   `↻ Ns` counting down to the next attempt (probes self-schedule via
   setTimeout so the countdown is exact; nothing shown while up).
   THE SERVER CONSOLE IS IN THE TUI: LogsSt mirrors ComfyUI's log stream —
   backfill from GET `/internal/logs/raw`, then live ws `logs` messages
   after PATCH `/internal/logs/subscribe` with the CURRENT session id
   (ComfyHost.onSession fires on every sid change, so reconnects
   re-subscribe; ComfyHost.onLogs delivers entries). Entries are WRITE
   CHUNKS, not lines: LogsSt assembles them (`\n` commits a line, `\r`
   resets the partial — tqdm redraws collapse to their last state, and the
   live partial renders as the panel's last row). ANSI is stripped
   (stripAnsi in utils/ansi.ts), blank lines dropped, ring capped at 400.
   LogsPanel sits below the vars panel (~8 rows, 4 when the terminal is
   short, error-ish lines red), hidden while an overlay owns the vars area
   (typing space > logs); stream failures surface AS a log line, not on the
   console. Switching hosts best-effort unsubscribes the old one (it stays
   connected in loadedHosts and would keep streaming to nobody). The host panel shows
   the same status first, then stats (nodes/loras/embeddings/queue/ws) and
   runs actions: re-codegen SDK
   (fetchAndUpdateSchema + cache-busted module reload so var option lists
   refresh), restart ComfyUI via manager reboot, clear pending queue,
   interrupt the current run. The server queue length is LIVE
   (`ComfyHost.onStatus` ← ws 'status' → QueueSt); `r` during a run queues
   another prompt. QUEUED RUNS ARE FIRST-CLASS: ExecSt counts `inFlight` runs
   (`running` = `inFlight > 0`) and every launched run goes through the SAME
   path (progress callback, outputs, runCount, output preview) — the latent
   hook is installed when inFlight goes 0→1 and removed only at 0→ none, so
   queued prompts keep painting latents. The server executes prompts one at a
   time: a progress event carrying a NEW promptId means the next queued run
   started → progress resets and stale latents are cleared, so the UI visibly
   turns over between runs. Drafts are LOCAL state → gitignored. The LAST ACTIVE
   draft per workflow is remembered in `.comfy-ts/settings.json` (SettingsSt,
   debounced autosave, gitignored) — reopening a workflow (or the tui itself)
   lands back in that draft when its file still exists, else `default`.
   The vars panel is a COLUMN GRID (marker+label / kind / value): long values
   wrap INSIDE the value column (text capped ~300 chars in the row, full text
   in the editor overlay).

## Frozen invariants

- `bun run typecheck:lib` (src + scripts, `tsconfig.lib.json`) must pass with
  ZERO generated sdk.d.ts on disk — that is what a fresh clone and GitHub CI
  see. `SdkForHost` resolves to the base sdk EAGERLY when `Comfy.Hosts` is
  empty; without that guard the deferred conditional breaks host variance
  across state/ComfyHost/ComfyWorkflow/MediaImage. examples/ are excluded from
  that config: they name nodes and model files that exist only in a generated
  per-host sdk (`bun run typecheck` covers them locally, after `gen:sdk`).
- generated sdk files import ONLY `'comfy-ts'` (mapped to src/index.ts in-repo).
- one global singleton: `comfyts`. No second registration path.
- every wire payload has an arktype schema next to its TS type.

Renaming a file, moving a responsibility, or changing a frozen invariant requires
updating this doc FIRST. Signatures live in the files — read them, don't duplicate here.
