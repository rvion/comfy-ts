# Goals & feature matrix

The 7 goals (2026-07-24). This table is the truth about where each stands — never claim ✅ in README for anything not ✅ here.

## G1 — create & execute workflows from TypeScript

Builder API (`workflow.builder.KSampler({…})`), execution over ws with progress, asset upload/retrieve, DX goodies (`auto()` slot inference, functional input signals, `HasSingle` shortcuts), smart abstractions leaning on content addressing: uploads are hash-named (`MediaImage.hash` → `enumName`) and deduped against the host schema before any byte is sent.

- ✅ builder + execution + live progress (`run({ log, onProgress })`) + `execution.images`
- ✅ Vars + `defineWorkflow` (tweak & re-run, fresh graph per run)
- ✅ hash-named upload dedupe (`ComfyUploader`)
- 🔶 more content-addressed asset flows (local cache by hash) — planned

## G2 — fully type-safe per host

One generated SDK per host: `Comfy.<HostNs>.{IN,OUT,Node,Builder,Slots,Accepts,Union,…}`
+ `Comfy.Hosts` registry + `SdkForHost<ID>`. Model names, samplers, loras, embeddings are literal unions FROM THE ACTUAL HOST.

- ✅ per-host namespace codegen + typed `workflow.builder`
- ✅ base fallback types (lib compiles with no sdk on disk)

## G3 — discovery codegen from the ComfyUI-Manager registry

Types for every KNOWN custom node / plugin / model in the ecosystem (`src/manager/generated/Known*.ts` from ComfyUI-Manager JSONs), so `host.installCustomNodeByTitle('…')` autocompletes across the whole ecosystem.

- ✅ registry mirror + generated Known* unions (`bun run gen:manager`)
- 🔶 refresh workflow + docs

## G4 — import both ComfyUI JSON formats into code

`api.json` (prompt format) and `workflow.json` (litegraph graph format) → `ComfyWorkflow`.

- ✅ api format: `host.importApiJson(json)` (round-trip tested)
- ✅ litegraph format: `host.importWorkflowJson(json)` — handles muted nodes, Note/Reroute/PrimitiveNode; tested on real saved workflows (8 + 32 nodes) and on a build→export→import round-trip

## G5 — export both formats from code

- ✅ `workflow.toApiJson(idMode?)` → api.json (links remapped per id scheme)
- ✅ `await workflow.toWorkflowJson()` → workflow.json, autolayouted by default (`{ layout: false }` to skip)

## G6 — local AND remote hosts

`ComfyInstallType` distinguishes local / remote-over-ssh. A locality-aware media retrieval fast-path was on the roadmap here and was DROPPED (his call 2026-07-31): the saver × save matrix (G9, README) already gives every placement — same-machine users pick `SaveImage` with no `save:` and read the server's own `output/` file, one write, zero copies. No hidden path derivation to maintain.

- ✅ type distinction + ssh helpers (`ssh-host-manager/`: config upsert, remote exec — port-forward tunnels DELETED 2026-07-27: they died silently, connect straight to the host instead)
- ✅ cloud hosts: `url:`-first config + `apiKey` (X-API-Key on http AND the ws upgrade), one authed `host.fetch` with /api-prefix fallback, 302 signed-url downloads, binary type-4 preview frames. Ran live end to end against cloud.comfy.org 2026-07-30 (one 512x512 txt2img: ws progress streamed, output image downloaded). Committed account-generic catalog sdk at `examples/comfy-cloud/sdk.d.ts` (`bun run gen:sdk:cloud`) + `examples/rvion/05-comfy-cloud.cflow.ts`

## G7 — sidekick CLI

`bunx comfy-ts gen --host http://… --id my-host` → writes `.comfy-ts/hosts/<id>/sdk.d.ts` (`--api-key`/`COMFY_CLOUD_API_KEY` for authed hosts, `--out` relocates the sdk — the committed cloud catalog); `bunx comfy-ts outline <file>` → section outline of a generated sdk; `bunx comfy-ts loras [--id my-host] [--host http://…]` → mirrors what the optional ComfyUI-Lora-Manager extension knows about every lora into `.comfy-ts/hosts/<id>/loras.json` (real model names, civitai trigger words, tags, base model, preview urls), so the TUI can fuzzy-match a lora by its human name and auto-inject its trigger words into the prompt; `bunx comfy-ts tui [module|dir]` → interactive tweak & re-run (no arg scans cwd PLUS the examples packaged with comfy-ts, deduped and grouped apart, so it never opens empty; an explicit dir/file arg keeps that scope only, a file arg scans its folder, all over `**/*.cflow.ts`; a module that fails to import is a red `✗` tree row, never a crash; under node the tui re-execs through bun, needed to import `.cflow.ts` from node_modules): left `(t)ree` panel of workflows with nested named drafts (autosaved under `.comfy-ts/drafts/<module-basename>/`, gitignored, last draft per workflow remembered in `.comfy-ts/settings.json`), vars panel as a column grid with live progress, modal overlays (multiline text, fuzzy choice, size presets, loras multi-select), seed modes (`+`/`-`/`=`/`?` — auto-increment/decrement/fixed/ reroll after every run), `v.prompt` with `//` comment lines (dim gray, stripped at build) + per-lora keywords (⌃K in the loras overlay, `.comfy-ts/lora-keywords.json`) auto-prefixed onto the prompt, multiline editor line ops (Home/End/⌘←→ line ends, ⌥↑↓ move line, ⌘/ comment, current line highlighted), `(p)review` panel (p cycles native → ansi → off; real OSC-1337 images on capable terminals, ANSI half-blocks elsewhere; live latent previews during a run, last output after, selected-lora previews via the optional ComfyUI-Lora-Manager extension, cached + content-type-guarded), ⌃R runs from any mode, `o` opens the last output in the OS viewer.

`bunx comfy-ts serve [module|dir]` → drafts as a local HTTP generation API: `POST /generate/<module>/<draft>` (or `/generate/<draft>` when unambiguous) with `{ ...vars }` overriding the draft's values, blocking response with output urls (or raw image bytes under `Accept: image/*`); `GET /drafts` self-describes every var (kind, allowed values, ranges, defaults) so a frontend can build a form; `GET /outputs/…` serves the results. Opening the same url in a BROWSER gets a react control panel: every var rendered as its matching web control (prompt textarea, sliders, seed mode buttons + 🎲, loras popup gallery with mirror display names + previews + strengths, size presets, image upload + preview), generate button with live progress + latent preview, output gallery with per-image copy/delete. Edits AUTOSAVE into the selected draft exactly like the TUI, and drafts duplicate from the form header. Draft files are read live (tweak in the TUI while serving) and never written. Binds 127.0.0.1:8288 by default. Full contract: agent/architecture.md item 12.

- ✅ gen / outline / loras / tui (tui look & feel not yet signed off by a human playtest)
- ✅ serve (drafts over HTTP, Rémi's GO 2026-07-31)
- 🔶 serve web UI (his ask 2026-08-05) — built, pending his browser playtest

## G8 — runs in the browser

`import { ComfyTS } from 'comfy-ts/web'`: the core library in a browser bundle — in-memory storage backend (the `ComfyStorage` seam), native WebSocket (api key as `?token=` on the upgrade, the probed cloud contract), pure-JS sha1, no sharp/ws/node:* in the graph (machine-guarded by `tests/web-bundle.test.ts`). Local/LAN hosts connect directly behind `--enable-cors-header`; Comfy Cloud lacks CORS and rides `comfy-ts serve`. Browser example: `examples/web/` (`bun examples/web/serve.ts`).

- ✅ web entry + storage seam + bundle guard (Rémi's full GO 2026-07-31)
- 🔶 browser playtest by a human — pending

## G9 — leave no traces (ephemeral outputs, his GO 2026-07-31)

Images that never persist: `SaveImageWebsocket` outputs stream over the ws and never touch the server disk (every image example uses it); local saving is OPT-IN (`run({ save })` — default keeps outputs in memory only); `ephemeral: true` rewrites `SaveImage` → `SaveImageWebsocket` in the sent prompt and scrubs the server history entry after the run (`host.deleteHistory`/`clearHistory`). Honest limits are part of the feature: uploads persist server-side (base64 loaders are the feature-detected alternative, absent on cloud), video/audio savers have no ws variant, server logs/RAM/cloud retention are out of reach. Contract: architecture.md item 14.

- ✅ ws output correlation + memory-default outputs + opt-in `save`
- ✅ `ephemeral` rewrite + history scrub + upload warning
- ✅ `loadInWorkflow_viaBase64Node` (feature-detected, windows-1 verified table)

## Non-goals

- no app-scale UI (CushyStudio's job), no LLM calls. The TUI and the serve web panel are sidekick surfaces over drafts; `comfy-ts serve` stays a thin LOCAL bridge — no auth, no multi-tenant, no hosted product.
- no support matrix beyond ComfyUI's own API surface.
