# comfy-ts

_the ultimate ComfyUI toolkit for TypeScript: `SDK` + `CLI` + `TUI` + agent guide_

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
[⚡ 60 second start](#-60-second-start) ·
[🧩 SDK](#-the-sdk-workflows-as-code) ·
[🧬 Codegen](#-the-codegen-nothing-else-comes-close) ·
[🎛️ App mode & vars](#-app-mode--vars-knobs-on-everything) ·
[🖥️ TUI](#-the-tui) ·
[⌨️ CLI](#-the-cli) ·
[🌍 Comfy Cloud & hosts](#-hosts-local-lan-comfy-cloud-any-provider) ·
[🔌 Ecosystem](#-ecosystem-discovery-and-install) ·
[🤖 Agents](#-for-ai-agents) ·
[📚 Examples](#-examples) ·
[🧱 Trust](#-a-lib-you-can-trust-made-to-last)

## What's inside

| piece            | what it gives you                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------- |
| 🧩 **the SDK**      | build and run workflows in code, typed down to the model names of your exact machine      |
| ⌨️ **the CLI**      | one command codegens a full typed SDK for any host, local or remote cloud                 |
| 🖥️ **the TUI**      | drive every workflow from the terminal: knobs, drafts, queue, live latent previews        |
| 🤖 **agent tools**  | typed discovery and install across the whole custom node ecosystem, built for automation  |
| 🔁 **JSON, both ways** | import and export `api.json` and `workflow.json`, drag your code onto the Comfy canvas |

## ⚡ 60 second start

```bash
bun add comfy-ts     # or npm / pnpm / yarn
```

```ts
// myFirstWorkflow.ts
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

```sh
$ bun myFirstWorkflow.ts
▶ [████████████████] 100% · SaveImage · 12s
.comfy-ts/outputs/txt2img_00001.png
```

One tsconfig line activates the generated types:

```jsonc
{ "include": ["src", ".comfy-ts/hosts/**/sdk.d.ts"] }
```

No codegen yet? Everything still compiles on permissive base types, and
sharpens the moment the generated sdk lands. Runs under Bun and node ≥ 20,
dual ESM/CJS.

## 🧩 The SDK: workflows as code

The best embedded DSL we know how to build, distilled from years of writing
typed DSLs in TypeScript. Fast inference, clever tricks, zero ceremony.
Wrong workflow? Compile error, before ComfyUI ever sees the graph. Writing
workflows in code gets so comfortable you may catch yourself experimenting
here rather than in the visual editor. The tricks this section showcases:

- [Pass the node, skip the slot](#pass-the-node-skip-the-slot)
- [Nested or flat, your call](#nested-or-flat-your-call)
- [Lambda inputs: autocomplete only what fits](#lambda-inputs-autocomplete-only-what-fits)
- [auto(): let the graph wire itself](#auto-let-the-graph-wire-itself)
- [Content-addressed uploads](#content-addressed-uploads)
- [Problems, not crashes](#problems-not-crashes)

Wondering how any of this can exist? It all rests on
[the codegen](#-the-codegen-nothing-else-comes-close) below.

### Pass the node, skip the slot

When a node has exactly ONE output of the expected type, pass the node
itself:

```ts
const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'SD1.5\\v1-5-pruned-emaonly.ckpt' })
const samples = b.KSampler({ model: ckpt /* … */ }) // instead of model: ckpt._MODEL
b.VAEDecode({ samples, vae: ckpt })                 // same ckpt node, VAE output this time
```

`ckpt` carries one MODEL, one CLIP and one VAE output, so it slots into all
three kinds of inputs directly, and refuses inputs it cannot feed.

### Nested or flat, your call

The same graph writes flat (a const per node) or nested (the code shaped
like the graph). Mix freely; nested is often the practical form for small
branches:

```ts
// flat
const latent = b.EmptyLatentImage({ width: 512, height: 512, batch_size: 1 })
const samples = b.KSampler({ latent_image: latent /* … */ })
b.SaveImage({ images: b.VAEDecode({ samples, vae: ckpt }) })

// nested
b.SaveImage({
   images: b.VAEDecode({
      samples: b.KSampler({
         latent_image: b.EmptyLatentImage({ width: 512, height: 512, batch_size: 1 }),
         /* … */
      }),
      vae: ckpt,
   }),
})
```

### Lambda inputs: autocomplete only what fits

Any input accepts a lambda. Its parameter is the builder NARROWED to the
nodes able to produce the expected type, so autocomplete proposes only what
can actually plug in:

```ts
b.KSampler({
   // n lists ONLY conditioning producers: CLIPTextEncode and friends
   positive: (n) => n.CLIPTextEncode({ clip: ckpt, text: 'a cozy house' }),
   /* … */
})
```

### auto(): let the graph wire itself

Leave a slot blank and comfy-ts wires the most recent node producing the
right type:

```ts
import { auto } from 'comfy-ts'

const samples = b.KSampler({ latent_image: auto() /* picks the latest LATENT producer */ })
```

Handy in quick scripts; prefer explicit wiring in code meant to be read.

### Content-addressed uploads

Uploads are hash-named and deduped against the host before any byte moves.
Run the same img2img a hundred times, the input image travels once:

```ts
build: async (b, vars, wf) => {
   const img = new MediaImage({ path: asAbsolutePath(vars.image) })
   const loaded = await img.loadInWorkflow_viaLoadImageNode(wf) // hash-named, deduped
   b.KSampler({ latent_image: b.VAEEncode({ pixels: loaded, vae: ckpt }) /* … */ })
}
```

### Problems, not crashes

Invalid graphs accumulate precise messages in `workflow.problems` before
ComfyUI ever sees them: missing required inputs, type mismatches, each named
with the node and field.

## 🧬 The codegen: nothing else comes close

Not "a ComfyUI type package" someone published once. One command reads YOUR
host and writes a full SDK for it:

```bash
bunx comfy-ts gen --id my-gpu --host http://127.0.0.1:8188
# → .comfy-ts/hosts/my-gpu/{object_info.json, embeddings.json, sdk.d.ts}
```

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

- **Literal types from the actual install.** `ckpt_name` only accepts
  checkpoints that machine really has; samplers, schedulers, loras and
  embeddings are unions of the real values.
- **Custom nodes are first-class.** Every installed pack lands in the
  builder: `b['rmbg.RMBG']` autocompletes like any core node.
- **One namespace per host, many hosts per codebase.** A workflow written
  against `my-gpu` cannot silently reference a model that only exists on
  `my-laptop`.
- **Never blocking.** Before the first codegen everything compiles on
  permissive base types, and sharpens the moment the generated sdk lands.
- **Browsable.** The generated file is real TypeScript;
  `bunx comfy-ts outline` shows it section by section.
- **See it for real: the Comfy Cloud catalog.**
  [`examples/comfy-cloud/sdk.d.ts`](examples/comfy-cloud/sdk.d.ts) is a full
  generated SDK for [Comfy Cloud](https://cloud.comfy.org) (5.9MB, 3574
  nodes), committed so you can browse it and typecheck graphs against it
  without any host.
  [`examples/05-comfy-cloud.cflow.ts`](examples/05-comfy-cloud.cflow.ts)
  runs against it live: `url` + `apiKey` host config, one env var, images
  back in seconds.

## 🎛️ App mode & vars: knobs on everything

Vars turn a workflow module into a small APP: declare the tweakable parts
once (`import { v } from 'comfy-ts'`) and `build` re-executes with current
values on every `run()`. The TUI renders vars as its UI, scripts set them
programmatically, drafts snapshot them. One module, many setups, re-runnable
forever instead of a one-shot script.

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

## 🖥️ The TUI

![the comfy-ts TUI: workflow tree, typed knobs, live latent preview](screenshots/tui-screen-1.png)

```bash
bunx comfy-ts tui
```

No argument needed: it finds every `*.cflow.ts` under your project AND the
examples bundled with the package, so the first launch is never empty. Pass
a folder or a module to scan just that. Keyboard-first, a persistent keybar
showing every available key.

| panel        | what it does                                                                     |
| ------------ | -------------------------------------------------------------------------------- |
| **(t)ree**   | every `*.cflow.ts` found, with named drafts (var snapshots) nested under it       |
| **(v)ars**   | edit every knob: inline numbers, real multiline editor, fuzzy pickers, lora overlay with per-lora strengths |
| **(p)review** | LIVE latent previews mid-run, then the final image, painted REAL on iTerm2/WezTerm/VS Code |
| **(h)ost**   | node/lora/embedding counts, live queue, re-codegen, restart Comfy, interrupt      |

`r` runs, `s` rerolls the seed and runs, `o` opens the output, `c`/`C` copy
workflow.json / api.json. Press `r` mid-run and it QUEUES with the values as
they are right now. Drafts autosave: reopening lands you where you left off.

## ⌨️ The CLI

```bash
bunx comfy-ts gen --id my-gpu --host http://127.0.0.1:8188
# → .comfy-ts/hosts/my-gpu/{object_info.json, embeddings.json, sdk.d.ts}

bunx comfy-ts outline              # what's inside that 2MB sdk.d.ts?
bunx comfy-ts tui                  # your *.cflow.ts + bundled examples
bunx comfy-ts tui [dir | module]   # scan just that
```

Any reachable host: the box under your desk or a GPU machine across the
network, same command, same output.

## 🌍 Hosts: local, LAN, Comfy Cloud, any provider

Every Comfy is supported, through one identical API. Same mechanism, same
codegen, same typed SDK, same TUI, whatever answers the protocol:

```ts
// the box you are on
comfy.host({ id: 'local', host: '127.0.0.1', port: 8188 })

// another machine on your network
comfy.host({ id: 'gpu-tower', host: '192.168.1.5', port: 8188 })

// official Comfy Cloud: same everything, plus an api key
comfy.host({ id: 'comfy-cloud', url: 'https://cloud.comfy.org', apiKey: process.env.COMFY_CLOUD_API_KEY })

// any third party provider: paste its base url; extra auth headers welcome
comfy.host({ id: 'runpod', url: 'https://xxxx-8188.proxy.runpod.net' })
comfy.host({ id: 'modal', url: 'https://you--comfy.modal.run', headers: { 'Modal-Key': '…', 'Modal-Secret': '…' } })
```

[Comfy Cloud](https://cloud.comfy.org) is first-class: the key rides
`X-API-Key` on every request and the websocket, outputs download through the
signed-url redirect, live latent previews stream into the TUI, and the whole
cloud catalog ships as a committed, browsable SDK
([`examples/comfy-cloud/sdk.d.ts`](examples/comfy-cloud/sdk.d.ts)) with a
whole [model zoo of 46 ready workflows](#the-model-zoo-46-cloud-workflows-32-model-families)
built against it.

Reaching a Comfy running on another one of your machines:

- **ssh tunnel**: `ssh -N -L 8188:127.0.0.1:8188 you@gpu-box`, then
  `host: '127.0.0.1', port: 8188` as if it were local (`ssh -R` does the
  reverse: expose YOUR Comfy to the remote box).
- **tailscale**: `tailscale serve 8188` on the box gives a stable https url
  for `url:`; plain tailnet hostnames work with `host:` too.
- **cloudflared**: `cloudflared tunnel --url http://127.0.0.1:8188` prints a
  temporary public https url, paste it into `url:`.

## 🔌 Ecosystem discovery and install

The whole ComfyUI-Manager registry, mirrored into generated types: every
known custom node pack, plugin title and model is a typed union. The
generated files are committed, browsable TypeScript:

- [`KnownComfyCustomNodeName`](src/manager/generated/KnownComfyCustomNodeName.ts):
  every node name of every known pack
- [`KnownComfyPluginTitle`](src/manager/generated/KnownComfyPluginTitle.ts) /
  [`KnownComfyPluginURL`](src/manager/generated/KnownComfyPluginURL.ts):
  the whole custom-node ecosystem as literal types
- [`KnownModel_Name`](src/manager/generated/KnownModel_Name.ts) and its
  [`Base` / `Type` / `FileName` / `SavePath`](src/manager/generated/)
  siblings: every model the registry knows, down to where it installs

```ts
await host.installCustomNodeByTitle('ComfyUI Impact Pack') // autocompletes across the ecosystem
await host.manager.installModel(modelInfo)
```

A script (or an agent) can look at a workflow, see what is missing, and
install it by name with the compiler checking the spelling. Install
endpoints currently target the Manager v2 API; v3 moved them behind a queue
API and support is being ground down (see the feature table).

## 🤖 For AI agents

comfy-ts is built to be driven by agents as much as by people. After
installing, one line in your `CLAUDE.md` teaches your agent the whole
library:

```
@./node_modules/comfy-ts/guide-for-agents.md
```

## 🔁 JSON, both ways

- `workflow.toApiJson()`: the executable prompt format.
- `await workflow.toWorkflowJson()`: an AUTOLAYOUTED litegraph file. Drop it
  on the ComfyUI canvas and see the graph you wrote in code, readably laid
  out.
- `host.importApiJson` / `host.importWorkflowJson`: both directions, covered
  by round-trip tests. Newer editor features (subgraphs) are the current
  compat frontier: we sweep every official Comfy-Org template against our
  schemas to grind that gap down.

## 📚 Examples

Every example is a runnable `*.cflow.ts` module: run it with bun, or just
`bunx comfy-ts tui` — the TUI finds them all.

Start with the didactic five:

| example                                                                                  | shows                                                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`01-txt2img`](examples/01-txt2img.cflow.ts)                                             | typed builder, vars, execution, downloaded outputs                          |
| [`02-img2img-upload`](examples/02-img2img-upload.cflow.ts)                               | hash-named deduped upload, img2img, async build                             |
| [`03-export-workflow-json`](examples/03-export-workflow-json.cflow.ts)                   | OFFLINE graph building, export api.json + readable workflow.json            |
| [`04-krea2-turbo-t2i`](examples/04-krea2-turbo-t2i.cflow.ts)                             | a real pipeline: krea2 turbo, lora stack, RMBG cutout → transparent png     |
| [`05-comfy-cloud`](examples/05-comfy-cloud.cflow.ts)                                     | the same code on Comfy Cloud: `url` + `apiKey` host, typechecked against the committed catalog SDK |

### The model zoo: 46 cloud workflows, 32 model families

[`examples/comfy-cloud/`](examples/comfy-cloud/) holds one runnable example
per family × mode (`<family>-<mode>.cflow.ts`), each transcribed from the
official ComfyUI template of that model, typechecked against the committed
cloud catalog, and runnable on [Comfy Cloud](https://cloud.comfy.org) with
one env var (`COMFY_CLOUD_API_KEY`). Image, video and audio:

| mode                | families                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **t2i** text→image  | sd15 (= example 05), sdxl, sd35, flux1, flux2, qwen-image, z-image, chroma, hidream, omnigen2, kandinsky5, capybara, krea2, lens, ernie, longcat, ovis, pixeldit, anima, newbie, ideogram4 |
| **i2i** image edit  | flux1, flux2, qwen-image, hidream, omnigen2, capybara, longcat, boogu, firered                                                        |
| **t2v** text→video  | wan21, wan22, wan22-5b, ltxv, hunyuan-video, kandinsky5                                                                               |
| **i2v** image→video | wan21, wan22, ltxv, hunyuan-video, kandinsky5, capybara, svd                                                                          |
| **t2a** text→audio  | ace-step (song), stable-audio (sfx/music), chatterbox (tts)                                                                           |

Every zoo file imports offline and headless (no key, no cache needed — CI
proves it), builds a validated graph, and doubles as a TUI app with typed
knobs: prompt, seed, steps, size, input image, …

## 🗂️ The `.comfy-ts/` folder

One folder of local state per consumer repo: `hosts/` (schema dumps + the
generated sdk per host), `outputs/`, `drafts/`, TUI settings, lora keywords.
Gitignore all of it. `hosts/` is a full dump of that machine's models and
paths (~10MB), so committing it publishes your setup; in a PRIVATE repo,
committing it is what buys you typed CI.

## ✅ Feature status

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
| cloud hosts: `url` + `X-API-Key` auth, Comfy Cloud ran live    |   ✅   |
| ComfyUI-Manager registry mirror + Known\* ecosystem unions     |   ✅   |
| install custom nodes / models via ComfyUI-Manager (v2 API)     |   🔶   |
| locality-aware media retrieval fast-path (local vs remote)     |   🔶   |
| content-addressed local asset cache                            |   🔶   |

✅ working and exercised · 🔶 partial / in progress

## 🧱 A lib you can trust, made to last

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
