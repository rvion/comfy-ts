# comfy-ts

> Type-safe ComfyUI companion for TypeScript. Connect to any number of ComfyUI
> hosts, get ONE generated SDK per host (global `Comfy.<HostNs>.*` namespaces),
> build workflows in code with full autocomplete, execute them over websocket,
> get your images back. Plus a terminal UI to tweak and re-run any workflow.

[![CI](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/comfy-ts.svg)](https://www.npmjs.com/package/comfy-ts)

## Table of contents

- [Goals](#goals)
- [Install](#install)
- [Quick start](#quick-start)
- [The per-host typed SDK](#the-per-host-typed-sdk)
- [Vars: tweak and re-run](#vars-tweak-and-re-run)
- [The TUI](#the-tui)
- [The sidekick CLI](#the-sidekick-cli)
- [Examples](#examples)
- [The `.comfy-ts/` folder](#the-comfy-ts-folder)
- [Feature status](#feature-status)
- [DX goodies](#dx-goodies)
- [Related projects](#related-projects)

## Goals

1. **Create and execute workflows from TypeScript**, including uploading and
   retrieving assets, with smart abstractions leaning on content addressing
   (uploads are hash-named and deduped before any byte is sent).
2. **Fully type-safe, per host.** Every host you connect to gets its own
   generated SDK: node inputs, model names, samplers, loras, embeddings are
   literal types **from that actual install**.
3. **Ecosystem discovery codegen**: typed unions of every custom node,
   plugin, and model known to the ComfyUI-Manager registry.
4. **Import both ComfyUI JSON formats**: `api.json` (prompt) and
   `workflow.json` (litegraph graph) into code.
5. **Export both formats**: `api.json` for execution, plus an easy-to-read,
   autolayouted `workflow.json` you can drag into the ComfyUI editor.
6. **Local and remote instances**: same API whether Comfy runs next to you
   or on a GPU box over ssh.
7. **A sidekick CLI**: codegen and an interactive TUI, without writing a line
   of code.

## Install

```bash
bun add comfy-ts     # or npm / pnpm / yarn
```

Runs under Bun and node ≥ 20. Ships dual ESM/CJS.

## Quick start

A workflow module (from [`examples/01-txt2img.cflow.ts`](examples/01-txt2img.cflow.ts)):

```ts
import { ComfyTS, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'my-gpu', host: '127.0.0.1', port: 8188 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

export const txt2img = host.defineWorkflow({
   id: 'txt2img',
   vars: {
      prompt: v.text('a cozy house in a snowy forest, warm windows'),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      size: v.size({ width: 512, height: 512 }),
   },
   build: (b, vars) => {
      // b is typed: Comfy.MyGpu.Builder, autocomplete on EVERY node of THIS host
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'SD1.5\\v1-5-pruned-emaonly.ckpt' })
      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip: ckpt, text: vars.prompt }),
         negative: b.CLIPTextEncode({ clip: ckpt, text: 'blurry, low quality' }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 7,
         sampler_name: 'euler',
         scheduler: 'normal',
         denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae: ckpt }) })
   },
})

export default txt2img

// standalone run, skipped when a driver (e.g. the TUI) imports this module
if (import.meta.main) {
   const execution = await txt2img.run({ log: true }) // ▶ [██████░░] 71% · KSampler · 10s
   for (const img of execution.images) console.log(img.absPath) // downloaded outputs
   host.disconnect()
}
```

First time on a host, generate its schema cache and typed SDK once:

```bash
bunx comfy-ts gen --id my-gpu --host http://127.0.0.1:8188
```

(or replace `loadSchemaFromCache()` with `await host.connect()`, which fetches
the schema and writes the SDK itself). One tsconfig line activates the
generated types:

```jsonc
{ "include": ["src", ".comfy-ts/hosts/**/sdk.d.ts"] }
```

Before the first codegen, builder methods fall back to permissive base types.
Your code compiles either way; the types sharpen once the generated sdk is in
scope.

## The per-host typed SDK

Each host gets its own namespace inside the global `Comfy` namespace, plus a
registry entry, so several hosts coexist in one codebase:

```ts
declare global {
   namespace Comfy {
      namespace MyGpu {          // ← generated from THIS host's /object_info
         interface IN { … }      //   input types per node
         interface OUT { … }     //   output slots per node
         interface Builder { … } //   one factory per node
         interface Union { … }   //   every enum: model names, samplers, loras, …
         // + Node, Slots, Accepts, Producer, Embeddings, Schemas, NodeType
      }
      interface Hosts { 'my-gpu': MyGpu.Sdk }
   }
}
```

`workflow.builder` resolves through `Comfy.Hosts`, so a workflow created on
`comfy.host({ id: 'my-gpu', … })` is typed with **that** host's nodes and
models. Unknown host ids fall back to permissive base types.

## Vars: tweak and re-run

`host.defineWorkflow({ vars, build })` is the re-run contract: declare the
knobs once, and `build` re-executes with the current values on every `run()`,
producing a fresh graph each time.

```ts
export const asset = host.defineWorkflow({
   id: 'asset',
   vars: {
      prompt: v.text('spherical sheep'),
      seed: v.seed(517),
      steps: v.int(8, { min: 1, max: 40 }),
      size: v.size({ width: 1024, height: 1024 }),   // SDXL-bucket presets + WxH custom
      removeBg: v.toggle(true, 'remove bg'),
      ratio: v.choice(['square', 'wide'] as const, 'square'),
      loras: v.loras(/krea-?2/i),                    // multi-select, resolved against the host's real loras
   },
   build: async (b, vars, wf) => { /* typed builder code reading vars.* */ },
})

await asset.run({ log: true })
asset.vars.seed.randomize()
await asset.run({ log: true })
```

- var kinds: `v.text` / `v.int` / `v.float` / `v.seed` / `v.toggle` /
  `v.choice` / `v.size` / `v.loras` / `v.prompt`.
- `v.loras` takes a RegExp (resolved against the host's real lora list at
  define time) or any dynamic list such as `host.schema.getLoras(/xl/i)`;
  `activeLoras(vars.loras)` normalizes the selection to
  `{ lora_name, strength_model, strength_clip }[]`, ready for a standard
  `LoraLoader` chain.
- `v.prompt` builds a structured `{ positive, negative }`: `//` lines are
  comments (stripped), `- ` lines become the negative prompt, and
  `v.prompt({ loraKeywordsFrom: lorasVar })` prefixes the active loras'
  trigger keywords.
- `v.seed` is a mode plus a number (`+ N` / `- N` / `= N` / `? N`) and advances
  itself after every run, so a queued batch gets distinct seeds.
- `vars` may be a lambda that RECEIVES `v`, giving cross-referencing vars one
  scope with the host's own types injected:

```ts
export const asset = host.defineWorkflow({
   id: 'asset',
   vars: (v) => {
      const loras = v.loras(/krea-?2/i)
      return { loras, prompt: v.prompt('a cozy house', { loraKeywordsFrom: loras }) }
   },
   build: async (b, vars, wf) => { /* … */ },
})
```
- `build` may be async (image uploads etc., the third `wf` param feeds
  `MediaImage` upload helpers).
- `run()` opens with `await host.connect()`, which is idempotent (cached ready
  promise, one websocket per host, ever). Modules import OFFLINE from the
  schema cache and connect lazily on first run.
- `ComfyTS.create()` returns the existing global instance or creates it, and
  `comfy.host({ id })` is a registry (same id, same instance back). Many
  workflow modules can safely import each other, or be co-imported by the TUI,
  in one process.
- fast start: `connect()` reuses the `.comfy-ts/` schema cache when younger
  than 24h (`connect({ schema: 'refresh' })` forces a re-fetch,
  `{ schema: 'cache' }` never fetches).

Name your workflow modules `*.cflow.ts` and the TUI finds them.

## The TUI

```bash
bunx comfy-ts tui examples/      # a dir: scans **/*.cflow.ts
bunx comfy-ts tui my.cflow.ts    # a file: scans its folder, file preselected
bunx comfy-ts tui                # no arg: scans cwd
```

```
┌ comfy-ts ┐┌ (w)orkflow ─┐┌ (d)raft ─┐┌ (h)ost ──────────────────┐
│ comfy-ts ││ 01-txt2img  ││ default  ││ windows-1 (127.0.0.1:8085)│
└──────────┘└─────────────┘└──────────┘└──────────────────────────┘
┌ (t)ree ────────────┐┌ (v)ars ─────────────────────────────┐┌ (p)review ─────┐
│ ▾ 01-txt2img       ││ ▸ prompt  [text]  a cozy house in a… ││                │
│     default        ││   seed    [seed]  ? 42               ││  ▄▓▓▒▒░▄▄▓▒░░  │
│     night-take     ││   steps   [int]   20                 ││  ▓▒░▄▄▓▓▒▒░▄▓  │
│ ▸ 04-krea2-turbo   ││   size    [size]  512×512            ││  live latent / │
│                    ││   loras   [loras] (2) styleA, styleB ││  last output   │
└────────────────────┘└──────────────────────────────────────┘└────────────────┘
 ▶ [██████░░░░░░░░░░] 42% · KSampler · 12s · queue 1
 ↑↓ select · ← tree · ⏎/→ edit
 r run · s reroll+run · e rename draft · o open image · c/C copy wf/api · q quit
```

Keyboard-first, three panels, a persistent keybar showing every key available
in the current mode. Every panel and header box is titled with the key that
opens it, and no key is advertised twice.

- **(t)ree** (left): every `*.cflow.ts` workflow found, with its drafts nested
  under it. ↑↓ move, ← folds, → unfolds a workflow or hops into the vars panel
  from a draft row, ⏎ loads a workflow or a draft directly.
- **(v)ars** (center): the knobs of the loaded workflow. You are always in a
  draft (`default` auto-active per workflow); edits autosave to
  `.comfy-ts/drafts/`, `e` renames the active draft inline, `d` opens the
  drafts overlay (load / new / duplicate / delete). Drafts are named var-value
  snapshots, so one workflow carries many setups, and reopening a workflow
  lands back in the draft you left it in.
- **(p)review** (right, `p` cycles native → ansi → off): LIVE latent previews
  while a run is in flight (launch ComfyUI with `--preview-method auto`), then
  the final output. On iTerm2, WezTerm and VS Code terminals "native" paints
  the REAL image over the panel; everywhere else it renders truecolor
  half-blocks.
- **(h)ost** (header box): node / lora / embedding counts, live server queue
  length, and actions — re-run the SDK codegen, restart ComfyUI, clear the
  pending queue, interrupt the current run.

Editing a var opens the right surface for its kind: numbers edit inline
(readline word ops included), text and prompt vars open a real multiline editor
(⏎ saves, ⇧⏎ or ⌥⏎ inserts a newline, ⌘←→ and ⌃A/⌃E move by logical line, ⌥↑↓
move a line, ⌘/ toggles a `// ` comment), choice and size open a
fuzzy-filterable picker (type `WxH` for a custom size), loras open a
multi-select overlay (type to filter, space ticks, ←→ steps strengths, ⌃A/⌃N
tick/untick all filtered, ⌃K assigns that lora's trigger keywords). A seed row
takes `+` `-` `=` `?` to set its mode and `*` to reroll. If the host has the
[ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager)
extension installed, the preview panel shows the selected lora's preview image
while you browse; without it, everything else keeps working.

Global keys: `r` run, `s` reroll seed + run, `o` open the last output in the
OS image viewer (full resolution), `c` copy workflow.json, `C` copy api.json,
`⌃R` run from any mode, `q` quit. Pressing `r` while a run is in flight QUEUES
another prompt on the server (built from the values as they are right now), and
the progress bar, latent preview and outputs follow each queued run in turn.

## The sidekick CLI

```bash
bunx comfy-ts gen --id my-gpu --host http://127.0.0.1:8188
# → .comfy-ts/hosts/my-gpu/{object_info.json, embeddings.json, sdk.d.ts}

bunx comfy-ts outline                          # what's inside that 2MB sdk.d.ts?
bunx comfy-ts outline --section Builder --lines 40

bunx comfy-ts tui [dir | module.cflow.ts]      # see above
```

## Examples

Runnable from the repo (they expect a live ComfyUI). Every example is a
`*.cflow.ts` workflow module: run it standalone with bun, or point the TUI at
`examples/`.

| example                                                                          | shows                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`examples/01-txt2img.cflow.ts`](examples/01-txt2img.cflow.ts)                   | typed builder, vars, execution, downloaded outputs                                                                       |
| [`examples/02-img2img-upload.cflow.ts`](examples/02-img2img-upload.cflow.ts)     | hash-named deduped upload, img2img, async build                                                                          |
| [`examples/03-export-workflow-json.cflow.ts`](examples/03-export-workflow-json.cflow.ts) | OFFLINE graph building, export api.json + readable workflow.json                                                 |
| [`examples/04-krea2-turbo-t2i.cflow.ts`](examples/04-krea2-turbo-t2i.cflow.ts)   | a real pipeline: krea2 turbo + `v.loras` multi-select stack (standard LoraLoader chain) + RMBG cutout → transparent png |

## The `.comfy-ts/` folder

Every repo using comfy-ts gets one `.comfy-ts/` folder at its root:

```
.comfy-ts/
   hosts/<host-id>/object_info.json   raw schema dump from the host
   hosts/<host-id>/embeddings.json    embeddings list
   hosts/<host-id>/sdk.d.ts           the generated typed SDK (per host)
   outputs/                           images and workflows produced by runs
   drafts/<module-basename>/<name>.json   named var snapshots from the TUI
   settings.json                      TUI settings (preview mode, last draft)
   lora-keywords.json                 trigger keywords you assigned to loras
   cache/                             lora preview images, refetchable
```

Everything under `.comfy-ts/` is local state: gitignore it. `hosts/` in
particular is a full dump of that machine's models, loras and paths (often
~10MB per host), so committing it publishes your setup — regenerate it instead
with `bun run gen:sdk` or a first `connect()`. In a PRIVATE repo, committing
`hosts/` is what buys you typed CI. This repo does not commit it, and the
library is built to typecheck with no generated SDK on disk at all.

## Feature status

| feature                                                        | status |
| -------------------------------------------------------------- | :----: |
| typed workflow builder + execution + progress + outputs        |   ✅   |
| vars + `defineWorkflow` tweak and re-run                       |   ✅   |
| structured prompts (`v.prompt`: negatives, comments, keywords) |   ✅   |
| TUI drafts, persisted settings, queued runs                    |   ✅   |
| per-host namespace codegen (`Comfy.<HostNs>.*`)                |   ✅   |
| idempotent connect, resilient websocket, latent previews       |   ✅   |
| hash-named, deduped image upload                               |   ✅   |
| export api.json + autolayouted workflow.json                   |   ✅   |
| import api.json into a live workflow                           |   ✅   |
| import workflow.json (litegraph → api conversion)              |   ✅   |
| sidekick CLI (`gen`, `outline`, `tui`)                         |   ✅   |
| ComfyUI-Manager registry mirror + Known\* ecosystem unions     |   ✅   |
| install custom nodes / models via ComfyUI-Manager              |   ✅   |
| locality-aware media retrieval fast-path (local vs remote)     |   🔶   |
| content-addressed local asset cache                            |   🔶   |

✅ working and exercised · 🔶 partial / in progress

## DX goodies

- **`auto<T>()`**: leave a slot blank; comfy-ts wires the most recent node
  producing the right type.
- **functional inputs**: any input accepts `(producers) => value`, with
  `producers` narrowed to the nodes able to output the expected type.
- **`HasSingle` shortcuts**: pass a whole node wherever it has exactly one
  output of the expected type (`model: ckpt` instead of `ckpt._MODEL`).
- **problems, not crashes**: invalid graphs accumulate precise messages in
  `workflow.problems` before Comfy ever sees them.

## Related projects

- [CushyStudio](https://github.com/rvion/CushyStudio), where this library was born.
- [@saintno/comfyui-sdk](https://www.npmjs.com/package/@saintno/comfyui-sdk), polished API, but unsafe workflow building, no typed registry.
- [comfyui-bun-client](https://github.com/KaruroChori/comfyui-bun-client), similar spirit, less codegen, not on npm.

## License

MIT © [Rémi Vion](https://github.com/rvion)
