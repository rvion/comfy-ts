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
PRIVATE host `sdk.d.ts` at all — the frozen invariant below is exactly what
keeps that clone (and CI) green. The ONE exception is the Comfy Cloud shared
catalog, which is account-generic by construction and lives committed under
`examples/comfy-cloud/` (see "Cloud & remote hosts" below).

## File structure

```
src/index.ts               public entry: re-exports everything below
src/state.ts               ComfyTS singleton (global `comfyts`), path resolution, lazy registry
src/types/index.ts         shared branded types (AbsolutePath, Maybe, Result, …)
src/types/comfy-sdk.ts     base global Comfy.* namespace + Hosts registry + SdkForHost<ID>
src/host/                  per-server connection layer
   ComfyHost.ts            central class: ws lifecycle, schema fetch, sdk regen, msg routing,
                           host.fetch/fetchFile (the ONE authed http path, see "Cloud & remote hosts")
   hostUrl.ts              pure url layer: parseHostBase (url-first OR legacy host/port/https
                           → {scheme,host,port,basePath}), renderHttpBase/renderWsUrl
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
   discoverWorkflows.ts    module discovery: cflow scan, PACKAGED examples dir
                           (resolved from import.meta, never cwd), pure merge
   run-tui.tsx             entry: discovery, resilient first load, keyboard
                           protocols, mount, dispose
src/litegraph/             ComfyUI saved-workflow JSON format, 3 layers (see
                           "Workflow import pipeline" below):
   LiteGraph*.ts           TOLERANT wire schemas (arktype + IsEqual TS mirror):
                           model what upstream actually serializes, v0.4 tuple
                           links AND v1 object links, subgraph definitions
   CanonicalWorkflow.ts    the ONE strict internal type (zero optional fields);
                           everything downstream consumes only this
   normalizeWorkflow.ts    parseWorkflowJson: validate → normalize → expand;
                           throws WorkflowNormalizeError, never casts
   expandSubgraphs.ts      inlines definitions.subgraphs instances (remapped
                           ids, boundary rewiring, widget promotion)
   convertFlowToLiteGraphJSON.ts  EXPORT path (our own emission, v0.4 tuples)
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
   Registry keyed by id: same id → the SAME instance back (the parsed base quad
   scheme/host/port/basePath + apiKey PRESENCE must match, loud throw otherwise —
   the key value never appears in the error). `connect()` is idempotent (cached
   ready promise) — one ws per host, ever.
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
   A MISSING cache never fails the import: `loadSchemaFromCache` degrades to
   the base types with a LOUD log (a fresh consumer project has no
   `.comfy-ts/hosts/<id>/` yet — the bundled examples must still open in the
   TUI) and stays retryable (not memoized until the file exists); `run()`
   fetches the real schema through `connect()` anyway. The ws connect path is
   untouched: `shouldUseSchemaCache` only routes to the cache when the file
   exists.
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
   TUI runs in the ALTERNATE SCREEN (run-tui, TTY only; quitting resets SGR
   and erases the alt screen BEFORE restoring — ED also deletes iTerm inline
   images, otherwise the last protocol image and stray background colors
   survive into the shell). `p` OPENS THE
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
   second OSC paint on top, its cell box sized from the latent's REAL
   dimensions via image-meta so iTerm doesn't letterbox a mismatched rect;
   pixel: sharp composites the latent thumb onto
   the last output at gravity northeast, then ONE half-block render —
   string-level overlay was tried and dropped, its space padding reads as
   black bars); `last output` ignores
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
   hand-rolled OSC 1337 escape at that rect on EVERY stdout flush (write
   hook + mobx reaction for byte-only changes), via raw stdout with cursor
   save/restore (content row 6 — calibrated by playtest on iTerm2
   2026-07-27, row 5 painted one line too high). The repaint is SYNCHRONOUS
   within the same flush and the whole batch (ink frame + images) is
   wrapped in DEC 2026 synchronized-update markers, so the terminal never
   presents the erased-frame intermediate state — the deferred
   (setImmediate) repaint was the native-mode flicker (his repro); tiny
   writes (<64 bytes, e.g. terminal queries) skip the repaint — protocol
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
   (one code path). DISCOVERY (`src/cli/tui/discoverWorkflows.ts`): with NO
   argument the cwd scan is MERGED with the examples PACKAGED with comfy-ts
   (`bundledExamplesDir` walks up from `import.meta.url` to the nearest NAMED
   package.json — works from a consumer's `node_modules/comfy-ts/dist/cli.js`
   AND from this repo's `src/cli/tui/`; missing examples dir or a foreign
   package name = silently absent, no package.json at all = loud throw). The
   merge (`mergeWorkflowSources`, pure + headless-tested) dedupes by realpath
   (run-tui realpaths both sides) and ALWAYS groups bundled files under a dim
   non-selectable `comfy-ts examples` section row at the tree's bottom, even
   when the cwd scan already found them (repo dev: `./examples` is under cwd).
   An explicit dir/file argument keeps that scope only, no bundled merge.
   RUNTIME: `.cflow.ts` modules need bun — node refuses to strip types under
   node_modules, exactly where the packaged examples live, and `bunx comfy-ts`
   runs the bin's `#!/usr/bin/env node` shebang under NODE. So the `tui`
   subcommand RE-EXECS itself through bun when `process.versions.bun` is
   absent (comfy-ts-cli.ts, stdio inherit, exit code forwarded); when bun is
   not installed it stays on node, drops the bundled merge with a loud
   logError (node cannot import them anyway), and user files still get node's
   own type stripping.
   RESILIENCE: the initial module is the first CANDIDATE that loads (file arg
   first); a module whose import throws or that exports no DefinedWorkflow
   becomes a RED `✗` tree row (`WorkflowsSt.loadErrors`, cleared on a later
   successful load; ⏎ retries and surfaces the error in exec.error) instead
   of crashing the TUI — only zero loadable modules exits, loudly, per file. The tree NESTS each workflow's drafts under it (←/→ fold/
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
   (stripAnsi in utils/ansi.ts), cp1252-mangled UTF-8 repaired
   (utils/mojibake.ts — the Windows server decodes its own UTF-8 output as
   cp1252, so `█` arrives as `â–ˆ`; repair reverses the cp1252 map and
   re-decodes, falling back to the original on any unmappable or invalid
   byte), blank lines dropped, ring capped at 400.
   LogsPanel (titled `comfy host logs`) sits at the BOTTOM of the center
   column, below the progress line and the outputs box (~8 rows, 4 when the
   terminal is short, error-ish lines red), hidden while an overlay owns
   the vars area (typing space > logs); stream failures surface AS a log
   line, not on the console. Switching hosts best-effort unsubscribes the old one (it stays
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

## Workflow import pipeline (litegraph → canonical → prompt)

Full design: `tmp/20260729-format-grind-design.md` (session doc); the durable
contract is here. Rémi's constraint (2026-07-29, binding): tolerant input
schemas model loose upstream reality; ONE normalization step produces ONE
canonical strict type; optionality never leaks past normalization; a
validation failure is a loud typed error, never a cast.

```
unknown ──LiteGraphJSON_ark──▶ LiteGraphJSON (loose wire type)
        ──normalizeWorkflow──▶ CanonicalWorkflow (strict, no optionals)
        ──convertLiteGraphToPrompt(schema, canonical)──▶ ComfyApiJson
```

- **Wire layer** (`LiteGraph*.ts`): arktype schemas + `IsEqual` TS mirrors,
  relaxed to the corpus (widget.config?, root config/groups/extra?,
  group font_size/color?, widgets_values array OR object, inputs.link?,
  outputs?; field is `bgcolor`, lowercase, like upstream). Links are a union:
  v0.4 6-tuple (`LiteGraphLinkTuple`) | v1 object. `definitions.subgraphs`
  (hybrid files: v0.4 root, v1-shaped interiors) validated via
  `LiteGraphSubgraphDef`. arktype's undeclared-key tolerance stays on.
- **Canonical layer** (`CanonicalWorkflow.ts`): plain TS, ZERO optional
  fields — semantic absence is `null`, serializer noise gets a default.
  Links object-form only. `mode` is `'normal' | 'muted' | 'bypassed'`
  (0/1/3 collapse to normal). Widget values are ONE shape
  `{ positional: unknown[], named: Record<string, unknown> }` covering array
  form, object form (VHS_*), and subgraph promotion overrides. Cosmetic-only
  wire fields are dropped; a new consumer ADDS a field to canonical rather
  than reading the raw document.
- **Normalize is an explicit typed function, NOT arktype morphs** (decided:
  subgraph expansion is whole-document graph surgery a value-scoped morph
  can't express; morphs also break the IsEqual mirror pattern and our typed
  errors). `parseWorkflowJson(unknown)` is the single entry;
  `ComfyHost.importWorkflowJson` goes through it (the import validation gate).
  Subgraph expansion: iterative, nested defs supported (depth cap → typed
  cycle error), fresh numeric ids, boundary links (-10/-20) rewired (instance
  inputs map to def slots BY NAME — instances may serialize a subset; a name
  matching NO def input is a typed `subgraph-io-mismatch`, never a silent
  positional fallback — corpus-absent, so loud is safe), BOTH
  widget-promotion eras (properties.proxyWidgets pairs; io-widget order),
  PLUS named overrides on the instance itself keyed by def-input name (that
  is how a NESTED instance receives its outer values: promotion writes them
  to `named`, so the next expansion pass must read them back — named wins
  over positional, matching the converter), only `normal`-mode instances
  expand (muted drop, bypassed left for the converter's passthrough).
- **Converter owns EXECUTION semantics** on canonical input only: virtual
  skip set (`Note, MarkdownNote, Reroute, PrimitiveNode` + isVirtualNode —
  closed set, PrimitiveString/Int are real backend nodes), mute skip, bypass
  passthrough (see below), named-then-positional widget resolution (offset
  advances past named-shadowed slots whenever a positional array exists).
  Inlined PrimitiveNode values are GUARDED scalars (string/number/boolean/
  null) — a non-scalar value is a typed `invalid-widget-value`, never a cast
  into the prompt. Failures are `WorkflowConvertError` with a `code`
  (`unknown-node`, `dangling-link`, `unknown-dynamic-combo-option`, …)
  naming the feature — never a misleading generic message.
- **Bypass passthrough mirrors frontend `ExecutableNodeDTO._getBypassSlotIndex`**
  (ComfyUI_frontend `src/lib/litegraph/src/subgraph/ExecutableNodeDTO.ts`,
  verified 2026-07-29, corrected same day after review): the match type starts
  as the CONSUMER input's declared type and is RE-DERIVED at each bypass hop
  from the picked pass-through input's own type — the frontend's bypass branch
  in `resolveOutput` calls `resolveInput(matchingIndex, visited)` WITHOUT the
  type param, so every hop matches on the input it walked through, not on the
  original consumer (the link's own type is never the criterion). Type
  matching is `isValidConnection` parity: exact, `*`, or any member of a
  comma-separated multi-type. Parent-input pick order: match type `*`/''
  short-circuits to the input at the SAME slot index as the resolved output
  (else input 0); otherwise prefer the same-slot input when its type is
  connection-valid against both the output type and the match type; else
  first EXACT match; else first wildcard-tolerant match. The first
  type-matching input wins even when unlinked (then the consumer resolves
  unconnected, like the frontend's null link).
- **Widget-ness is decided from the input CONFIG, never from a type-name
  whitelist** (`src/sdk-generator/inputWidgetKind.ts`, `classifyWidgetInput`).
  2026 object_info spells widget inputs as arbitrary STRING types
  (`COMBO`, `COMFY_DYNAMICCOMBO_V3`, `IMAGECOMPARE`, …); upstream's own
  decision is a frontend widget REGISTRY we cannot mirror, but every
  registry-backed spelling carries a config signal, verified against
  ComfyUI_frontend `litegraphService.addNodeInput` + backend
  `comfy_api/latest/_io.py` (2026-07-29). Signals, in precedence order:
  1. `forceInput: true` → SLOT (frontend gates widget creation on it).
  2. array type / `E_*` union → combo widget.
  3. `widgetType: <name>` → widget of that type (frontend:
     `widgets.get(inputSpec.widgetType ?? inputSpec.type)`; e.g. Preview3D
     `model_file` multi-type union with `widgetType: "STRING"`).
  4. primitive type (INT/FLOAT/STRING/BOOLEAN) → widget.
  5. `options: [...]` array → combo family: entries shaped `{key, inputs}`
     → DYNAMIC COMBO, else plain COMBO widget.
  6. `template` object WITH a nested `input` section → AUTOGROW container;
     `template` WITHOUT one (`{template_id, allowed_types}`) is
     COMFY_MATCHTYPE_V3, a SLOT — `template` alone is ambiguous on purpose.
  7. `socketless: true` → widget with no socket (IMAGECOMPARE, COLOR).
  8. else → slot.
  Seed phantom: a widget consumes 2 values when its config carries a TRUTHY
  `control_after_generate` (booleans and string modes like `'fixed'`, the
  windows-1 SeedNode spelling — the frontend creates the control widget on
  truthiness); when the KEY is absent (2024 era) the legacy
  INT-named-seed/noise_seed heuristic applies. A serialized input
  entry carrying a `widget` marker overrides a slot verdict (era drift:
  the file proves that frontend serialized a widget value).
- **Dynamic inputs mirror backend expansion** (`_io.py
  get_finalized_class_inputs`): DYNAMIC COMBO consumes 1 positional value
  (the option key, typed throw when the key is not in `options`) THEN the
  selected branch's inputs inline, recursively (branch widgets emit as
  dotted prompt keys `decl.sub`, branch slots arrive as dotted serialized
  inputs and resolve like any link). AUTOGROW consumes ZERO widget values —
  the backend force-inputs widget templates, so instances are always link
  slots named `decl.<name_i>` (template `names` list or `prefix`+ordinal);
  the declaration itself is never required by name, but the first
  `template.min` instances are required WHEN the template input section is
  `required` — missing/unlinked ones throw typed `missing-required-input`.
- **Absent widget value → schema-default fill, never a throw** (decided
  2026-07-29). ComfyUI itself default-fills: loading an old file under a
  newer schema creates the grown widget with its schema default and the
  prompt serializes that default (frontend `getWidgetDefaultValue`), so a
  typed throw would reject files ComfyUI runs fine — the wrong model of
  reality. Fill order: config `default`, else INT/FLOAT 0, BOOLEAN false,
  STRING '', combo first option, custom widgets `null` (never DROP a
  required key: the backend accepts explicit null, `execute(x=None)`, but
  errors on absence). Fills are logged through the converter's verbose LOG.
  Typed throws remain for what IS a defect: garbage values in strict scalar
  domains (`invalid-widget-value`, non-string dynamic-combo keys included),
  a dynamic-combo key absent from the HOST's options
  (`unknown-dynamic-combo-option` — its OWN code because it is usually
  version drift, the template newer than the host's node, same class as
  `unknown-node`), missing required autogrow instances.
- **Array widget values emit wrapped as `{__value__: [...]}`** — the
  backend reads any bare 2-list in a prompt as a LINK reference
  (`execution.py validate_inputs`), so the frontend wraps arrays and
  unwraps server-side; we mirror it. Custom-widget values (IMAGECOMPARE
  `{before, after}` UI state) pass through as objects — `ComfyApiNodeJson`
  input values include the object form.
- **Metric split** (`scripts/check-templates.ts`): the sweep runs the FULL
  chain per file (parse → ark → normalize → convert) against ONE cached
  object_info (`.comfy-ts/hosts/windows-1/` when present, else the committed
  `tests/fixtures/object_info.json`, printed loudly). THREE acceptable
  non-defect outcomes are counted APART from converter defects, each in its
  own visible bucket:
  1. `unknown-node` — template needs a custom node this host lacks (sweeping
     779 templates against one cached object_info makes this expected).
  2. `incomplete-template` — `missing-required-input` on a file from a
     BLUEPRINT corpus (`comfyui-blueprints`, `workflow-templates-blueprints`):
     those repos are subgraph libraries, every file a fragment meant to be
     dropped INTO a workflow, so an unconnected required boundary input
     (e.g. GLSLShader autogrow `images.image0`) is the file's intended open
     boundary, not a converter bug. Source-based on purpose: the same error
     on a standalone-workflow corpus stays a defect.
  3. `host-drift` — `unknown-dynamic-combo-option`: the template's combo key
     is absent from THIS host's options (template newer than the host's node,
     e.g. recraftv4_1), same class as unknown-node.
  Structural success = ok + those three. The script prints the missing-node
  histogram ("install X to unlock N templates"), both new buckets, and the
  convert/normalize defect causes.
- **Compat ratchet** (`tests/template-ratchet.test.ts`): every committed
  fixture under `tests/fixtures/workflows/` (auto-enrolled via readdirSync)
  must schema-pass, normalize, and structurally convert against the committed
  2024 object_info — `unknown-node` is the one acceptable convert outcome.
  Compat only moves forward; a converter change that breaks a fixture goes red
  in CI, not in the next sweep.
- Fixtures: real corpus files copied verbatim under `tests/fixtures/workflows/`
  (`.prettierignore` already exempts `tests/fixtures/**` — fixtures are DATA);
  execution-semantics permutations (e.g. bypass rewiring) mutate a small
  fixture in-test instead of multiplying files.

## Cloud & remote hosts (designed 2026-07-30, code landed same day)

Ground truth: `.rv-journal/cloud-audit.md` (the 2026-07-29 inventory: 16 bare
fetch sites, no auth path, ws without options, `/api` prefix stragglers) and
the imported provider docs in `agent/external-docs/comfy-cloud/` (one .md per
upstream page, frontmatter `url:` + `importedAt:`). Comfy Cloud facts, probed
2026-07-30 against the live service: base `https://cloud.comfy.org`,
ComfyUI-compatible protocol under `/api/*`, auth header `X-API-Key`, ws at
`wss://cloud.comfy.org/ws`, `/api/user` → `{id, status}` on a valid key,
object_info ≈ 9.3 MB / 3573 node types. This section is the decided contract;
the connectivity code below is BUILT (headless-tested against Bun.serve stubs).
Live cloud proving is still pending — never from tests, CI has no key.

### ComfyHostData: url-first form

- `ComfyHostData` gains `url?: string` — a full base URL as pasted from a
  provider (`https://cloud.comfy.org`, `https://xxx.modal.run`,
  `http://192.168.1.5:8188/comfy`). Exactly ONE of `url` or the legacy
  `host` + `port` (+ `https?`) spelling is required; the legacy spelling keeps
  working untouched (every existing example and consumer compiles as-is).
  Loud throw when both or neither are given.
- The constructor parses ONCE into a normalized quad `{scheme: 'http'|'https',
  host, port, basePath}` (port defaults 80/443 from the scheme; basePath is
  `''` or `/segment…` with no trailing slash). Parsing + rendering are PURE
  (`src/host/hostUrl.ts`: `parseHostBase`, `renderHttpBase`, `renderWsUrl`) so
  they test headless without the comfyts global. `getServerHostHTTP()` /
  `getWSUrl()` render from the quad (`host.base`) and OMIT the port when it is
  the scheme default, so `https://cloud.comfy.org` round-trips clean while
  `host: '192.168.1.5', port: 8188` renders exactly as today. A url carrying
  `?query`/`#hash`, a non-http(s) scheme, or a mixed url+host/port spelling
  throws loud at construction.
- `comfyts.host()` identity check extends to the whole quad + apiKey presence
  (never the key VALUE in the error message). Equivalent spellings unify: a
  legacy host/port triple and a `url:` parsing to the same quad return the
  same registered instance.

### apiKey — value never in the repo

- `ComfyHostData` gains `apiKey?: string`, sent as `X-API-Key` on every HTTP
  request and on the ws upgrade. The VALUE is never persisted to any tracked
  file: examples read `process.env.COMFY_CLOUD_API_KEY` (on this machine:
  `rv-secret get comfy-cloud/api-key`, mirrored at
  `.rv-private/comfy-cloud-api-key`, both gitignored) and THROW a loud typed
  error naming the env var when it is absent. The banned-keywords guard
  machine-blocks the key shape (`re:comfyui-[a-z0-9]{16,}` — see
  `scripts/check-banned.ts` regex rows) in staged content, paths, and commit
  messages.
- Auth failures are loud and specific: 401 invalid key, 402 insufficient
  credits, 429 subscription inactive (per the imported error table) — the
  helper below maps them to typed errors instead of generic HTTP noise.

### host.fetch — the ONE http path (kills the 16-site debt)

- `host.fetch(route, init?, p?)` on ComfyHost: joins basePath, injects
  `X-API-Key` when set, merges optional `data.headers` (Modal-style extra
  headers), throws the typed auth errors above (`ComfyHostAuthError`, code
  401/402/429). EVERY host-bound fetch site routes through it —
  the audit's list of 16: ComfyHost `postJSON_/fetchJSON_/fetchRawLogs/
  subscribeLogs`, ComfyManager ×4, ComfyUploader, loraManagerApi,
  ComfyExecution image downloads ×2, `ComfyWorkflow.start`, `cli/gen.ts`
  (which now registers a real `comfyts.host` from its `--host` url and takes
  `--api-key` / `COMFY_CLOUD_API_KEY`), `tui HostSt.probe`. After the sweep, a
  direct `fetch(` against a host URL outside ComfyHost is a defect
  (grep-enforceable).
- `/api` prefix preference moves INTO the helper: try `/api<route>` first,
  fall back to the bare route on 404/405, remember the winner per host (one
  probe, not per call; when the remembered spelling later 404s the OTHER one
  is still tried, memo unchanged — mixed servers exist). That is today's
  `fetchJSON_`/`postJSON_` pattern centralized — the two stragglers the audit
  found (`POST /prompt` in ComfyWorkflow.start, `POST /upload/image` in
  ComfyUploader) get it for free. Required by Comfy Cloud, harmless locally.
  Routes served BARE only by design (`/internal/logs/*`, already-prefixed
  extension routes, server-relative preview paths) pass
  `p: { apiPrefix: false }` and skip the probe entirely.
- `/api/view` downloads: the cloud answers 302 to a temporary signed URL.
  fetch only auto-strips `Authorization`/cookies on cross-origin redirects —
  a CUSTOM `X-API-Key` header would be forwarded to the storage host. So
  binary downloads use `redirect: 'manual'` + a clean UNAUTHED fetch of the
  `Location` target (exactly the imported docs' own pattern). One code path:
  a `host.fetchFile(route)` variant next to `host.fetch`.
- Local-only surfaces (`/internal/logs/*`, ComfyUI-Manager routes, the
  lora-manager extension) 404 on cloud hosts: the TUI degrades to its quiet
  placeholder states instead of erroring — down/absent is a STATE, not a
  console spam.

### ws auth

- Verified against the live cloud by ws-upgrade handshake probe (2026-07-30,
  HTTP/1.1): no auth → 401, bad token → 401, and ALL THREE of `?token=<key>`
  (the documented spelling), `X-API-Key: <key>`, `Authorization: Bearer <key>`
  → 101. We send the HEADER: `ResilientWebSocketClient` gains
  `options.headers` (a THUNK, re-read on every reconnect) passed to
  `new WebSocket(url, { headers })` (the `ws` package supports it; we are not
  browser-bound), keeping the key out of URLs and proxy logs. `getWSUrl()`
  never puts the token in the query string (today it appends no params at
  all; a future `?clientId=<uuid>` is the only one it may ever carry).

### The committed cloud SDK catalog

- `.comfy-ts/hosts/` stays NEVER-COMMIT: those are private machine
  inventories. Comfy Cloud is different in kind — every account sees the same
  managed model catalog, so its generated sdk is a SHARED artifact. Committed
  home: `examples/comfy-cloud/sdk.d.ts`, host id `comfy-cloud`, regenerated
  deliberately via `bun run gen:sdk:cloud` (codegen gains an explicit outPath;
  the cloud host id never writes into `.comfy-ts/hosts/` — two sdk.d.ts files
  declaring the same `Comfy.Hosts` id would double-declare globals).
- tsconfig wiring: ZERO new config. The root tsconfig `include` already
  carries `examples`, so the committed catalog typechecks cloud examples on a
  fresh clone; `tsconfig.lib.json` excludes examples, so the portable gate and
  its no-generated-sdk invariant are untouched.
- Privacy rule (binding, every regeneration): before committing a generated
  cloud sdk, SCAN it for user-specific strings — emails, personal lora/model
  names, account ids, absolute local paths — and require the catalog to read
  account-generic (managed model names only). Mechanics: the banned-keywords
  pre-commit guard runs on the staged file anyway; on top of it, eyeball the
  diff of union types (loras, checkpoints, embeddings) for anything that names
  a PERSON rather than a product. A cloud sdk that fails the sniff test stays
  uncommitted until the offending strings are understood.

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
- optionality never crosses `normalizeWorkflow`: every consumer of an IMPORTED
  workflow JSON (converter, sweeps, TUI) reads `CanonicalWorkflow` only, and
  `CanonicalWorkflow` has no optional fields. A schema/normalize failure throws
  a typed error, never a lying cast. (The EXPORT path builds its complete v0.4
  document from scratch and is exempt by construction.)

Renaming a file, moving a responsibility, or changing a frozen invariant requires
updating this doc FIRST. Signatures live in the files — read them, don't duplicate here.
