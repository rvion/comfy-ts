# comfy-ts

**The full-featured, type-safe TypeScript library for ComfyUI.** One generated
SDK per host, typed down to the model names on that exact machine. Build
workflows in code with full autocomplete, run them over websocket, watch live
progress, get your images back. A terminal UI to tweak and re-run. Typed
discovery and install for the whole custom-node ecosystem. Import and export
both ComfyUI JSON formats. Nothing else on npm covers this much, this safely.

[![CI](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/comfy-ts.svg)](https://www.npmjs.com/package/comfy-ts)

## What you get

1. **The best typed SDK for ComfyUI.** Every node, every input, every enum is
   a literal type generated from your actual install. Model names, samplers,
   loras, embeddings autocomplete in your editor. Wrong wiring is a compile
   error, not a failed run.
2. **A CLI that codegens typings for any host**, local or remote. One command
   fetches the schema and writes a full SDK: safe methods and enums for all
   the nodes, models and images that host really has. Multiple hosts coexist
   in one codebase, each with its own types.
3. **The best TUI to drive Comfy from a terminal.** Browse your workflows,
   edit every knob, run and queue, watch the latent preview render live,
   see the final image right in the terminal. Named drafts persist your
   setups between sessions.
4. **Ecosystem tools built for automation.** Typed unions of every custom
   node, plugin and model known to the ComfyUI-Manager registry, plus typed
   install methods. A script (or an agent) can discover and install what a
   workflow needs.
5. **Workflow import and export in both JSON formats.** Read `api.json` and
   `workflow.json` into code. Write both back out, including an autolayouted
   `workflow.json` you can drag straight into the ComfyUI editor.

## Install

```bash
bun add comfy-ts     # or npm / pnpm / yarn
```

Runs under Bun and node ≥ 20. Ships dual ESM/CJS.

## Your first image

The smallest possible txt2img. `connect()` fetches the host schema and writes
the typed SDK on first contact.

```ts
import { ComfyTS } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'my-gpu', host: '127.0.0.1', port: 8188 })
await host.connect()

const txt2img = host.defineWorkflow({
   vars: {},
   build: (b) => {
      // b is typed: autocomplete on EVERY node of THIS host
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'SD1.5\\v1-5-pruned-emaonly.ckpt' })
      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip: ckpt, text: 'a cozy house in a snowy forest' }),
         negative: b.CLIPTextEncode({ clip: ckpt, text: 'blurry, low quality' }),
         latent_image: b.EmptyLatentImage({ width: 512, height: 512, batch_size: 1 }),
         seed: 42, steps: 20, cfg: 7,
         sampler_name: 'euler', scheduler: 'normal', denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae: ckpt }) })
   },
})

const execution = await txt2img.run({ log: true }) // ▶ [██████░░] 71% · KSampler · 10s
for (const img of execution.images) console.log(img.absPath) // downloaded outputs
host.disconnect()
```

One tsconfig line activates the generated types:

```jsonc
{ "include": ["src", ".comfy-ts/hosts/**/sdk.d.ts"] }
```

Before the first codegen, builder methods fall back to permissive base types.
Your code compiles either way; the types sharpen once the generated sdk is in
scope. Prefer generating without writing code? `bunx comfy-ts gen --id my-gpu
--host http://127.0.0.1:8188` does the same thing from the shell.

## Then add knobs: vars

Declare the tweakable parts once and `build` re-executes with the current
values on every `run()`. This is what the TUI edits, and what makes a
workflow module re-runnable instead of a one-shot script.

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
      /* same graph as above, reading vars.prompt, vars.seed, vars.steps, vars.size */
   },
})
export default txt2img

// standalone run, skipped when a driver (e.g. the TUI) imports this module
if (import.meta.main) {
   await txt2img.run({ log: true })
   txt2img.vars.seed.randomize()
   await txt2img.run({ log: true })
   host.disconnect()
}
```

Name the file `*.cflow.ts` and the TUI finds it.

- var kinds: `v.text` / `v.int` / `v.float` / `v.seed` / `v.toggle` /
  `v.choice` / `v.size` / `v.loras` / `v.prompt`.
- `v.seed` is a mode plus a number (`+ N` / `- N` / `= N` / `? N`) and
  advances itself after every run, so a queued batch gets distinct seeds.
- `v.prompt` builds a structured `{ positive, negative }`: `//` lines are
  comments (stripped), `- ` lines become the negative prompt, and
  `v.prompt({ loraKeywordsFrom: lorasVar })` prefixes the active loras'
  trigger keywords.
- `v.loras` takes a RegExp resolved against the host's real lora list, fully
  typed; `activeLoras(vars.loras)` normalizes the selection to
  `{ lora_name, strength_model, strength_clip }[]`, ready for a standard
  `LoraLoader` chain.
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
- `ComfyTS.create()` and `comfy.host({ id })` are registries: same id, same
  instance back. Many workflow modules can import each other, or be
  co-imported by the TUI, in one process. `connect()` is idempotent: one
  websocket per host, ever, and it reuses the `.comfy-ts/` schema cache when
  younger than 24h.

## Full examples

Every example is a runnable `*.cflow.ts` module: run it standalone with bun,
or point the TUI at `examples/`.

| example                                                                                  | shows                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`examples/01-txt2img.cflow.ts`](examples/01-txt2img.cflow.ts)                           | typed builder, vars, execution, downloaded outputs                                                                     |
| [`examples/02-img2img-upload.cflow.ts`](examples/02-img2img-upload.cflow.ts)             | hash-named deduped upload, img2img, async build                                                                        |
| [`examples/03-export-workflow-json.cflow.ts`](examples/03-export-workflow-json.cflow.ts) | OFFLINE graph building, export api.json + readable workflow.json                                                       |
| [`examples/04-krea2-turbo-t2i.cflow.ts`](examples/04-krea2-turbo-t2i.cflow.ts)           | a real pipeline: krea2 turbo + `v.loras` multi-select stack (standard LoraLoader chain) + RMBG cutout → transparent png |

## Why the DX is unmatched

### Types from your actual install

Not "a ComfyUI type package" someone published once. Each host you connect to
gets its own namespace, generated from that host's live `/object_info`:

```ts
declare global {
   namespace Comfy {
      namespace MyGpu {          // ← generated from THIS host's /object_info
         interface IN { … }      //   input types per node
         interface OUT { … }     //   output slots per node
         interface Builder { … } //   one factory per node
         interface Union { … }   //   every enum: model names, samplers, loras, …
      }
      interface Hosts { 'my-gpu': MyGpu.Sdk }
   }
}
```

So `ckpt_name` only accepts checkpoints that machine really has, custom nodes
like `b['rmbg.RMBG']` are first-class, and a workflow written against
`my-gpu` will not silently reference a model that only exists on `my-laptop`.
Unknown host ids fall back to permissive base types, so the library compiles
with no generated SDK on disk at all.

### Content-addressed uploads

Uploads are hash-named and deduped against the host before any byte is sent.
Run the same img2img a hundred times, the input image travels once:

```ts
build: async (b, vars, wf) => {
   const img = new MediaImage({ path: asAbsolutePath(vars.image) })
   const loaded = await img.loadInWorkflow_viaLoadImageNode(wf) // hash-named, deduped
   b.KSampler({ latent_image: b.VAEEncode({ pixels: loaded, vae: ckpt }), /* … */ })
}
```

### Tweak and re-run, seeds included

A workflow is a living thing, not a frozen graph. Change a var, run again,
get a fresh graph. Seeds advance themselves (`? 42` rerolls, `+ 42`
increments), so queueing five runs gives five different images without
touching anything:

```ts
await asset.run({ log: true })
asset.vars.seed.randomize()
await asset.run({ log: true })
```

### Export you can drag into the editor

`workflow.toApiJson()` gives the executable prompt format.
`await workflow.toWorkflowJson()` gives an autolayouted litegraph file: drop
it on the ComfyUI canvas and see the graph you wrote in code, readably laid
out. Both import paths exist too (`host.importApiJson`,
`host.importWorkflowJson`), covered by round-trip tests. Newer editor
features (subgraphs) are the current compat frontier: we sweep every official
Comfy-Org template against our schemas to grind that gap down.

### And the small things that add up

- **`auto<T>()`**: leave a slot blank; comfy-ts wires the most recent node
  producing the right type.
- **functional inputs**: any input accepts `(producers) => value`, with
  `producers` narrowed to the nodes able to output the expected type.
- **`HasSingle` shortcuts**: pass a whole node wherever it has exactly one
  output of the expected type (`model: ckpt` instead of `ckpt._MODEL`).
- **problems, not crashes**: invalid graphs accumulate precise messages in
  `workflow.problems` before Comfy ever sees them.

## The TUI

![the comfy-ts TUI](screenshots/tui-screen-1.png)

```bash
bunx comfy-ts tui examples/      # a dir: scans **/*.cflow.ts
bunx comfy-ts tui my.cflow.ts    # a file: scans its folder, file preselected
bunx comfy-ts tui                # no arg: scans cwd
```

Keyboard-first, three panels, a persistent keybar showing every key available
in the current mode.

- **(t)ree**: every `*.cflow.ts` workflow found, with its drafts nested under
  it. Drafts are named var-value snapshots, autosaved to `.comfy-ts/drafts/`,
  so one workflow carries many setups and reopening lands you back where you
  left off.
- **(v)ars**: every knob of the loaded workflow. Numbers edit inline, text
  and prompts open a real multiline editor (line ops, `⌘/` comments), choice
  and size open a fuzzy picker, loras open a multi-select overlay with
  per-lora strengths and trigger keywords.
- **(p)review**: LIVE latent previews while a run is in flight, then the
  final output. On iTerm2, WezTerm and VS Code terminals it paints the REAL
  image over the panel; everywhere else it renders truecolor half-blocks.
- **(h)ost**: node / lora / embedding counts, live server queue length, and
  actions: re-run the SDK codegen, restart ComfyUI, clear the queue,
  interrupt the current run.

`r` runs, `s` rerolls the seed and runs, `o` opens the last output in the OS
viewer, `c` / `C` copy workflow.json / api.json. Pressing `r` mid-run QUEUES
another prompt with the values as they are right now, and the progress bar
and previews follow each queued run in turn. With the optional
[ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager)
extension installed, browsing loras shows their preview images.

## The sidekick CLI

```bash
bunx comfy-ts gen --id my-gpu --host http://127.0.0.1:8188
# → .comfy-ts/hosts/my-gpu/{object_info.json, embeddings.json, sdk.d.ts}

bunx comfy-ts outline                          # what's inside that 2MB sdk.d.ts?
bunx comfy-ts outline --section Builder --lines 40

bunx comfy-ts tui [dir | module.cflow.ts]      # see above
```

Works against any reachable host: the box under your desk or a GPU machine
across the network, same command, same output.

## Ecosystem discovery and install

comfy-ts mirrors the ComfyUI-Manager registry into generated types: every
known custom node pack, plugin title and model is a typed union. On top of
that, typed install methods:

```ts
await host.installCustomNodeByTitle('ComfyUI Impact Pack') // autocompletes across the ecosystem
await host.manager.installModel(modelInfo)
```

This is the automation building block: a script or an agent can look at a
workflow, see what is missing, and install it by name with the compiler
checking the spelling.

The install endpoints target the ComfyUI-Manager v2 API. Manager v3 moved
them behind a new queue API; v3 support is being ground down right now (see
the feature table).

## For AI agents

comfy-ts is built to be driven by agents as much as by people. After
installing, add this line to your `CLAUDE.md`:

```
@./node_modules/comfy-ts/guide-for-agents.md
```

It teaches your agent the whole library: the builder, vars, execution, the
CLI, and the ecosystem install methods.

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
~10MB per host), so committing it publishes your setup. In a PRIVATE repo,
committing `hosts/` is what buys you typed CI. The library typechecks with no
generated SDK on disk at all.

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
| install custom nodes / models via ComfyUI-Manager (v2 API)     |   🔶   |
| locality-aware media retrieval fast-path (local vs remote)     |   🔶   |
| content-addressed local asset cache                            |   🔶   |

✅ working and exercised · 🔶 partial / in progress

## A lib you can trust, made to last

The glitter above sits on boring foundations:

- **Strict TypeScript everywhere.** `strict` + `noUncheckedIndexedAccess`,
  no `any`, and every remaining cast is individually justified in a
  reviewed whitelist.
- **A hard CI gate on every commit.** Typecheck, zero-warning lint (a
  warning is fixed or the rule is disabled on purpose, never ignored),
  format check, import hygiene, and the full headless test suite.
- **Runtime validation with arktype.** Wire messages and JSON formats are
  schema-validated. When ComfyUI drifts faster than the schemas, failures
  are logged loud, never swallowed.
- **Codegen you can regenerate, never hand-edit.** The SDK, the manager
  unions and the snapshot tests around them all rebuild from source data
  with one command each.
- **A compat grind loop, not compat hope.** The full official template
  corpus (~780 workflows from Comfy-Org) is mirrored locally and swept
  against our schemas on demand, so upstream format changes surface as a
  failing report line, not as your broken pipeline.
- **Boring packaging.** Dual ESM/CJS, Bun and node ≥ 20, `src/` shipped in
  the tarball for go-to-definition.

## Related projects

- [CushyStudio](https://github.com/rvion/CushyStudio), where this library was born.
- [@saintno/comfyui-sdk](https://www.npmjs.com/package/@saintno/comfyui-sdk), polished API, but unsafe workflow building, no typed registry.
- [comfyui-bun-client](https://github.com/KaruroChori/comfyui-bun-client), similar spirit, less codegen, not on npm.

## License

MIT © [Rémi Vion](https://github.com/rvion)
