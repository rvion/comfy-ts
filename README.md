# comfy-ts: the ultimate ComfyUI toolkit for TypeScript: SDK + CLI + TUI + agent guide

[![CI](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/comfy-ts.svg)](https://www.npmjs.com/package/comfy-ts)

**Everything ComfyUI, from TypeScript.** Build workflows in code with
autocomplete on every node and model of your exact install. Run them on any
host, from the box under your desk to a cloud GPU, and get the images
straight back into your code. Drive them from a terminal UI with live
latent previews. Let scripts and agents discover and install whatever the
ecosystem offers. Import and export both ComfyUI JSON formats. One library,
the whole pipeline.

**Jump to:**
[60 second start](#60-second-start) ·
[SDK](#the-sdk-workflows-as-code) ·
[Vars](#vars-knobs-on-everything) ·
[TUI](#the-tui) ·
[CLI](#the-cli) ·
[Ecosystem](#ecosystem-discovery-and-install) ·
[Agents](#for-ai-agents) ·
[Examples](#examples) ·
[Trust](#a-lib-you-can-trust-made-to-last)

## What's inside

| piece            | what it gives you                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------- |
| **the SDK**      | build and run workflows in code, typed down to the model names of your exact machine      |
| **the CLI**      | one command codegens a full typed SDK for any host, local or remote cloud                 |
| **the TUI**      | drive every workflow from the terminal: knobs, drafts, queue, live latent previews        |
| **agent tools**  | typed discovery and install across the whole custom node ecosystem, built for automation  |
| **JSON, both ways** | import and export `api.json` and `workflow.json`, drag your code onto the Comfy canvas |

## 60 second start

```bash
bun add comfy-ts     # or npm / pnpm / yarn
```

```ts
import { ComfyTS } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'my-gpu', host: '127.0.0.1', port: 8188 })
await host.connect() // fetches the schema, writes your typed SDK

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

No codegen yet? Everything still compiles on permissive base types, and
sharpens the moment the generated sdk lands. Runs under Bun and node ≥ 20,
dual ESM/CJS.

## The SDK: workflows as code

Not "a ComfyUI type package" someone published once. Wrong workflow?
Compile error. Every node, model, sampler and lora on your machine becomes
autocomplete: each host gets its own namespace, generated from that host's
live `/object_info`:

```ts
declare global {
   namespace Comfy {
      namespace MyGpu {          // ← generated from THIS host
         interface Builder { … } //   one factory per node
         interface Union { … }   //   every enum: model names, samplers, loras, …
      }
   }
}
```

- `ckpt_name` only accepts checkpoints that machine really has.
- Custom nodes are first-class: `b['rmbg.RMBG']` autocompletes too.
- Uploads are hash-named and deduped: the same input image travels ONCE,
  however many times you run.
- Invalid graphs collect precise messages in `workflow.problems` before
  ComfyUI ever sees them.
- `auto<T>()` wires a blank slot to the latest node producing the right type,
  and `model: ckpt` works wherever a node has exactly one matching output.

## Vars: knobs on everything

Declare the tweakable parts once (`import { v } from 'comfy-ts'`); `build`
re-executes with current values on every `run()`. That is what the TUI
edits, and what makes a module re-runnable instead of a one-shot script.

```ts
export const txt2img = host.defineWorkflow({
   id: 'txt2img',
   vars: {
      prompt: v.text('a cozy house in a snowy forest, warm windows'),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      size: v.size({ width: 512, height: 512 }),
   },
   build: (b, vars) => { /* same graph, reading vars.* */ },
})

await txt2img.run({ log: true })
txt2img.vars.seed.randomize()
await txt2img.run({ log: true }) // fresh graph, fresh image
```

| var kind                | superpower                                                                        |
| ----------------------- | --------------------------------------------------------------------------------- |
| `v.seed`                | mode + number (`+ N` `- N` `= N` `? N`), advances itself: queued runs differ      |
| `v.prompt`              | structured text: `//` comments stripped, `- ` lines become the negative prompt     |
| `v.loras`               | RegExp resolved against the host's REAL lora list, fully typed, multi-select       |
| `v.text` `v.int` `v.float` `v.toggle` `v.choice` `v.size` | the everyday knobs, ranges included          |

`vars` can be a lambda receiving `v` so vars reference each other:
`v.prompt('a cozy house', { loraKeywordsFrom: loras })` prefixes the active
loras' trigger keywords. Name the file `*.cflow.ts` and the TUI finds it.

## The TUI

![the comfy-ts TUI: workflow tree, typed knobs, live latent preview](screenshots/tui-screen-1.png)

```bash
bunx comfy-ts tui examples/
```

Keyboard-first, a persistent keybar showing every available key.

| panel        | what it does                                                                     |
| ------------ | -------------------------------------------------------------------------------- |
| **(t)ree**   | every `*.cflow.ts` found, with named drafts (var snapshots) nested under it       |
| **(v)ars**   | edit every knob: inline numbers, real multiline editor, fuzzy pickers, lora overlay with per-lora strengths |
| **(p)review** | LIVE latent previews mid-run, then the final image, painted REAL on iTerm2/WezTerm/VS Code |
| **(h)ost**   | node/lora/embedding counts, live queue, re-codegen, restart Comfy, interrupt      |

`r` runs, `s` rerolls the seed and runs, `o` opens the output, `c`/`C` copy
workflow.json / api.json. Press `r` mid-run and it QUEUES with the values as
they are right now. Drafts autosave: reopening lands you where you left off.

## The CLI

```bash
bunx comfy-ts gen --id my-gpu --host http://127.0.0.1:8188
# → .comfy-ts/hosts/my-gpu/{object_info.json, embeddings.json, sdk.d.ts}

bunx comfy-ts outline            # what's inside that 2MB sdk.d.ts?
bunx comfy-ts tui [dir | module] # see above
```

Any reachable host: the box under your desk or a GPU machine across the
network, same command, same output.

## Ecosystem discovery and install

The whole ComfyUI-Manager registry, mirrored into generated types: every
known custom node pack, plugin title and model is a typed union.

```ts
await host.installCustomNodeByTitle('ComfyUI Impact Pack') // autocompletes across the ecosystem
await host.manager.installModel(modelInfo)
```

A script (or an agent) can look at a workflow, see what is missing, and
install it by name with the compiler checking the spelling. Install
endpoints currently target the Manager v2 API; v3 moved them behind a queue
API and support is being ground down (see the feature table).

## For AI agents

comfy-ts is built to be driven by agents as much as by people. After
installing, one line in your `CLAUDE.md` teaches your agent the whole
library:

```
@./node_modules/comfy-ts/guide-for-agents.md
```

## JSON, both ways

- `workflow.toApiJson()`: the executable prompt format.
- `await workflow.toWorkflowJson()`: an AUTOLAYOUTED litegraph file. Drop it
  on the ComfyUI canvas and see the graph you wrote in code, readably laid
  out.
- `host.importApiJson` / `host.importWorkflowJson`: both directions, covered
  by round-trip tests. Newer editor features (subgraphs) are the current
  compat frontier: we sweep every official Comfy-Org template against our
  schemas to grind that gap down.

## Examples

Every example is a runnable `*.cflow.ts` module: run it with bun, or point
the TUI at `examples/`.

| example                                                                                  | shows                                                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`01-txt2img`](examples/01-txt2img.cflow.ts)                                             | typed builder, vars, execution, downloaded outputs                          |
| [`02-img2img-upload`](examples/02-img2img-upload.cflow.ts)                               | hash-named deduped upload, img2img, async build                             |
| [`03-export-workflow-json`](examples/03-export-workflow-json.cflow.ts)                   | OFFLINE graph building, export api.json + readable workflow.json            |
| [`04-krea2-turbo-t2i`](examples/04-krea2-turbo-t2i.cflow.ts)                             | a real pipeline: krea2 turbo, lora stack, RMBG cutout → transparent png     |

## The `.comfy-ts/` folder

One folder of local state per consumer repo: `hosts/` (schema dumps + the
generated sdk per host), `outputs/`, `drafts/`, TUI settings, lora keywords.
Gitignore all of it. `hosts/` is a full dump of that machine's models and
paths (~10MB), so committing it publishes your setup; in a PRIVATE repo,
committing it is what buys you typed CI.

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
  no `any`, every remaining cast individually justified in a reviewed
  whitelist.
- **A hard CI gate on every commit.** Typecheck, zero-warning lint (a
  warning is fixed or the rule is disabled on purpose, never ignored),
  format check, import hygiene, the full headless test suite.
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
