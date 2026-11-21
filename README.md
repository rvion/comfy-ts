# comfy-ts

**An efficient way to create, run, maintain and operate your ComfyUI workflows, for humans and agents.**

<a href="https://youtu.be/eniEaCp_NS4"><img src="https://raw.githubusercontent.com/rvion/comfy-ts/main/trailer/comfy-ts/thumbnail.jpg" alt="The comfy-ts trailer on YouTube, 1:39" width="640"></a>

[![CI](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/comfy-ts.svg)](https://www.npmjs.com/package/comfy-ts) [![npm downloads](https://img.shields.io/npm/dm/comfy-ts.svg)](https://www.npmjs.com/package/comfy-ts) [![GitHub release](https://img.shields.io/github/v/release/rvion/comfy-ts)](https://github.com/rvion/comfy-ts/releases) [![types](https://img.shields.io/npm/types/comfy-ts)](https://www.npmjs.com/package/comfy-ts) [![license](https://img.shields.io/npm/l/comfy-ts.svg)](https://github.com/rvion/comfy-ts/blob/main/LICENSE) [![sponsor](https://img.shields.io/github/sponsors/rvion?label=sponsor&logo=githubsponsors)](https://github.com/sponsors/rvion) [![discord](https://img.shields.io/discord/1087008112969531513?label=discord&logo=discord&logoColor=white)](https://discord.gg/GfAN6hF2ad)

Write ComfyUI workflows in TypeScript, then run them from code, one command, a terminal, a browser or an agent. Types come from your own ComfyUI: every node and model it has autocompletes, and a wrong graph is a compile error. Run on your GPU, another machine or Comfy Cloud, and get the images, audio and video back in your code or as files. 73 ready workflows cover 43 model families, from SDXL to Wan video and ACE-Step songs.

💬 Questions, help, or something you made with it: come say hi on [the Discord](https://discord.gg/GfAN6hF2ad).

| you want to | start here |
| --- | --- |
| build and run workflows in code, typed down to the model names of your exact machine | [the SDK](#-the-sdk-workflows-as-code), [the codegen](#-the-codegen-an-sdk-for-your-own-install) |
| tune a workflow with knobs, drafts, a queue and live latent previews in the terminal | [the TUI](#%EF%B8%8F-the-tui) |
| get the same workflows as a form in a browser, a phone included, with an LLM prompt refiner | [the web panel](#-the-web-panel) |
| generate from the command line, or let an AI agent generate for you | [the CLI](#%EF%B8%8F-the-cli), [for AI agents](#-for-ai-agents) |
| call your workflows over HTTP from a frontend, curl or n8n | [serve](#-serve-drafts-as-an-http-api) |
| run on Comfy Cloud or a rented GPU, with ready workflows for 43 model families | [hosts](#-hosts-local-lan-comfy-cloud-any-provider), [the model zoo](#the-model-zoo-73-cloud-workflows-43-model-families) |
| find and install the custom nodes and models a workflow needs, with typed names | [ComfyUI-Manager](#-custom-nodes-and-models-comfyui-manager) |
| keep client images off the server disk | [ephemeral outputs](#%EF%B8%8F-ephemeral-outputs-leave-no-traces) |
| move a graph between your code and the ComfyUI canvas, `api.json` and `workflow.json` | [JSON both ways](#-json-both-ways) |

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
   id: 'txt2img', // names the saved outputs (and the TUI tree entry)
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
      // streams the image back over the websocket: nothing saved on the server
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae: ckpt }) })
   },
})

const execution = await txt2img.run({ log: true, save: true }) // ▶ [██████░░] 71% · KSampler · 10s
for (const img of execution.images) console.log(img.absPath) // saved outputs
host.disconnect()
```

```sh
$ bun myFirstWorkflow.ts
▶ [████████████████] 100% · SaveImageWebsocket · 12s
.comfy-ts/outputs/txt2img_20260731-142012.png
```

Drop `save: true` and the outputs never touch a disk at all: `img.buffer` holds the bytes in memory ([ephemeral outputs](#%EF%B8%8F-ephemeral-outputs-leave-no-traces)).

One tsconfig line activates the generated types:

```jsonc
{ "include": ["src", ".comfy-ts/hosts/**/sdk.d.ts"] }
```

No codegen yet? Everything still runs, and compiles on permissive base types (with `noUncheckedIndexedAccess` off), then sharpens the moment the generated sdk lands. Runs under Bun and node ≥ 20, dual ESM/CJS.

## 🧩 The SDK: workflows as code

A wrong workflow is a compile error, before ComfyUI ever sees the graph. The builder keeps type inference fast and asks for no ceremony, so a graph in code is quick to write and quick to change. The tricks:

- [Pass the node, skip the slot](#pass-the-node-skip-the-slot)
- [Nested or flat, your call](#nested-or-flat-your-call)
- [Lambda inputs: autocomplete only what fits](#lambda-inputs-autocomplete-only-what-fits)
- [auto(): let the graph wire itself](#auto-let-the-graph-wire-itself)
- [Content-addressed uploads](#content-addressed-uploads)
- [Problems, not crashes](#problems-not-crashes)

All of it rests on [the codegen](#-the-codegen-an-sdk-for-your-own-install) below.

### Pass the node, skip the slot

When a node has exactly ONE output of the expected type, pass the node itself:

```ts
const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'SD1.5\\v1-5-pruned-emaonly.ckpt' })
const samples = b.KSampler({ model: ckpt /* … */ }) // instead of model: ckpt._MODEL
b.VAEDecode({ samples, vae: ckpt })                 // same ckpt node, VAE output this time
```

`ckpt` carries one MODEL, one CLIP and one VAE output, so it slots into all three kinds of inputs directly, and refuses inputs it cannot feed.

### Nested or flat, your call

The same graph writes flat (a const per node) or nested (the code shaped like the graph). Mix them freely. Nested is often the practical form for small branches:

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

Any input accepts a lambda. Its parameter is the builder NARROWED to the nodes able to produce the expected type, so autocomplete proposes only what can actually plug in:

```ts
b.KSampler({
   // n lists ONLY conditioning producers: CLIPTextEncode and friends
   positive: (n) => n.CLIPTextEncode({ clip: ckpt, text: 'a cozy house' }),
   /* … */
})
```

### auto(): let the graph wire itself

Leave a slot blank and comfy-ts wires the most recent node producing the right type:

```ts
import { auto } from 'comfy-ts'

const samples = b.KSampler({ latent_image: auto() /* picks the latest LATENT producer */ })
```

Handy in quick scripts. Prefer explicit wiring in code meant to be read.

### Content-addressed uploads

Uploads are hash-named and deduped against the host before any byte moves. Run the same img2img a hundred times, the input image travels once:

```ts
build: async (b, vars, wf) => {
   const img = new MediaImage({ path: asAbsolutePath(vars.image) })
   const loaded = await img.loadInWorkflow_viaLoadImageNode(wf) // hash-named, deduped
   b.KSampler({ latent_image: b.VAEEncode({ pixels: loaded, vae: ckpt }) /* … */ })
}
```

### Problems, not crashes

Invalid graphs accumulate precise messages in `workflow.problems` before ComfyUI ever sees them: missing required inputs, type mismatches, each named with the node and field.

## 🧬 The codegen: an SDK for your own install

This is not a ComfyUI type package that someone published once. One command reads YOUR host and writes a full SDK for it:

```bash
bunx comfy-ts gen --id my-gpu --host http://127.0.0.1:8188
# → .comfy-ts/hosts/my-gpu/{object_info.json, embeddings.json, sdk.d.ts, host.json}
```

`host.json` keeps the address, so your code names the host by its id alone and never writes a machine name: `comfy.host({ id: 'my-gpu' })`.

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

- **Literal types from the actual install.** `ckpt_name` only accepts checkpoints that machine really has. Samplers, schedulers, loras and embeddings are unions of the real values.
- **Custom nodes are first-class.** Every installed pack lands in the builder: `b['rmbg.RMBG']` autocompletes like any core node.
- **New input kinds are typed.** A dynamic group input (ComfyUI 0.45, for example `LoadLoraModel.loras`) is a list of at least one row: `b.LoadLoraModel({ model, loras: [{ lora_name, strength }] })`.
- **One namespace per host, many hosts per codebase.** A workflow written against `my-gpu` cannot silently reference a model that only exists on `my-laptop`.
- **Never blocking.** Before the first codegen everything runs, and compiles on permissive base types (with `noUncheckedIndexedAccess` off), then sharpens the moment the generated sdk lands.
- **Browsable.** The generated file is real TypeScript. `bunx comfy-ts outline` shows it section by section.
- **See it for real: the Comfy Cloud catalog.** [`examples/comfy-cloud/sdk.d.ts`](examples/comfy-cloud/sdk.d.ts) is a full generated SDK for [Comfy Cloud](https://cloud.comfy.org) (7.4 MB, 3893 node types), committed so you can browse it and typecheck graphs against it without any host. [`examples/rvion/05-comfy-cloud.cflow.ts`](examples/rvion/05-comfy-cloud.cflow.ts) runs against it live: `url` + `apiKey` host config, one env var, images back in seconds.

## 🎛️ App mode & vars: knobs on everything

Vars turn a workflow module into a small APP. Declare the tweakable parts once (`import { v } from 'comfy-ts'`), and `build` runs again with the current values on every `run()`. The TUI and the web panel render vars as their UI, scripts set them in code, drafts snapshot them. One module gives many setups, and you can run it again at any time, where a script runs once.

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

| var kind                | what it does                                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| `v.seed`                | mode + number (`+ N` `- N` `= N` `? N`), advances itself: queued runs differ. `v.seed(42, { mode: '+' })` declares the mode |
| `v.prompt`              | structured text: `//` comments stripped, `- ` lines become the negative prompt     |
| `v.loras`               | RegExp resolved against the host's REAL lora list, fully typed, multi-select       |
| `v.model`               | `v.model('UNETLoader.unet_name', { default, filter })`: a choice over the host's own file list for that loader input, typed as that slot's union |
| `v.image`               | local image path, TUI picker attached. `exampleImagePath('bear_1024x1024.jpg')` defaults to a bundled sample |
| `v.audio` `v.video`     | local audio or video path, same picker. `await myVar.loadInWorkflow(wf)` uploads it and returns the `LoadAudio` / `LoadVideo` node |
| `v.text` `v.int` `v.float` `v.toggle` `v.choice` `v.size` | the everyday knobs, ranges included          |
| `presets` on `v.text` / `v.prompt` | named starting texts (`{ 'terse tags': '…' }`): a presets button in the web panel, `P` in the TUI. Picking one replaces the field. `promptEnhancerPresets()` offers your `.comfy-ts/prompt-enhancers/*.md` library as presets too |

`vars` can be a lambda that receives `v`, so vars can reference each other: `v.prompt('a cozy house', { loraKeywordsFrom: loras })` prefixes the active loras' trigger keywords. `v.model` is available only in that lambda form. Name the file `*.cflow.ts` and the TUI finds it.

## 👀 Live previews: watch the image form

Pass `onPreview` to any run and every sampling step hands you the image so far:

```ts
const execution = await txt2img.run({
   onPreview: (p) => {
      // p.bytes: jpeg or png (p.mime) · p.nodeId / p.nodeName: 'KSampler' · p.step: { value: 7, max: 20 }
      showImage(new Blob([p.bytes], { type: p.mime }))
   },
})
```

It works the same on `definedWorkflow.run()`, `workflow.run()` and `workflow.start()`. Without `onPreview`, no frame is decoded or copied for the run. A preview is never an output: `execution.images` holds only what the graph saved.

ComfyUI sends previews only when it was launched with `--preview-method auto` (or `latent2rgb`, `taesd`). Its default is `none`, and then no frame ever arrives. Ask the host:

```ts
await host.fetchPreviewMethod() // 'auto' · 'none' = relaunch with --preview-method auto · null = the host does not say (cloud)
```

## 🕶️ Ephemeral outputs: leave no traces

Some images must not outlive the run: client work, private subjects, anything you would not leave in a shared server's `output/` folder. ComfyUI has three image savers, and they differ exactly there:

| saver                | where the image lands server-side                  | how long it stays              |
| -------------------- | -------------------------------------------------- | ------------------------------ |
| `SaveImage`          | `output/` dir, workflow JSON embedded in the PNG   | forever (no delete API)        |
| `PreviewImage`       | `temp/` dir                                        | until the server restarts      |
| `SaveImageWebsocket` | nowhere: streamed back as binary ws frames         | never touches the server disk  |

comfy-ts treats `SaveImageWebsocket` as a first-class output: its frames land in `execution.images` like any other output, and **local saving is opt-in**. Without `save`, the images exist only in memory (`img.buffer`, `img.getAsBlob()`, `img.getBase64Url()`; `img.absPath` is null):

```ts
// zero disk, end to end: nothing on the server, nothing locally
const execution = await txt2img.run({ log: true })
const bytes = execution.images[0]?.buffer

// opt-in local save, grouped in a subfolder
await txt2img.run({ log: true, save: { prefix: 'my-project' } })
```

Every combination is a valid choice: you pick where the image lives. `execution.images` works in all four (the bytes always stream to memory):

| graph saver          | `save` option | server disk | local disk |
| -------------------- | ------------- | ----------- | ---------- |
| `SaveImage`          | none          | yes         | no         |
| `SaveImage`          | `save: …`     | yes         | yes        |
| `SaveImageWebsocket` | none          | no          | no         |
| `SaveImageWebsocket` | `save: …`     | no          | yes        |

Running comfy-ts on the same machine as ComfyUI? Then row one is the best of both worlds: `SaveImage` with no `save:` writes the file exactly once, by the server, and it is already local. Read it straight from ComfyUI's own `output/` folder.

Running an imported workflow or template that uses `SaveImage`? `ephemeral: true` rewrites its save nodes to `SaveImageWebsocket` in the sent prompt (the graph you authored stays untouched) and deletes the run's server history entry afterwards, because the history holds your full workflow, prompts included:

```ts
await workflow.run({ ephemeral: true }) // implies scrubHistory: true
await host.clearHistory()               // or wipe the server's whole history
```

Honest limits, so you can decide what to trust:

- **uploaded inputs persist**: `/upload/image` files stay in the server's `input/` dir (ComfyUI has no delete API). If the host has a base64 loader node installed (`ETN_LoadImageBase64` from comfyui-tooling-nodes, or ComfyUI-Easy-Use's `easy loadImageBase64`), `mediaImage.loadInWorkflow_viaBase64Node(wf)` puts the image inside the prompt instead: no server file, and `scrubHistory` erases the prompt after. Comfy Cloud ships neither, so cloud inputs currently must ride uploads.
- **video and audio have no websocket saver** upstream: `SaveVideo` / `SaveAudio*` outputs persist on the host.
- **out of our reach**: server logs, RAM, crash dumps, reverse proxies, and a cloud provider's own retention policy. Ephemeral mode controls what the ComfyUI API persists, nothing more, and we will not pretend otherwise.

Every image example in `examples/` uses `SaveImageWebsocket`.

## 🖥️ The TUI

![the comfy-ts TUI: workflow tree, typed knobs, live latent preview](screenshots/tui-screen-1.png)

```bash
bunx comfy-ts tui
```

No argument needed: it finds every `*.cflow.ts` under your project AND the examples bundled with the package, so the first launch is never empty. Pass a folder or a module to scan just that. Keyboard-first, with a persistent keybar that shows every available key.

| panel        | what it does                                                                     |
| ------------ | -------------------------------------------------------------------------------- |
| **(t)ree**   | every `*.cflow.ts` found, with named drafts (var snapshots) nested under it       |
| **(v)ars**   | edit every knob: inline numbers, real multiline editor, fuzzy pickers, lora overlay with per-lora strengths |
| **(p)review** | LIVE latent previews mid-run, then the final image, painted REAL on kitty/Ghostty/iTerm2/WezTerm/VS Code |
| **(h)ost**   | node/lora/embedding counts, live queue, re-codegen, restart Comfy, interrupt      |

`r` runs, `s` rerolls the seed and runs, `o` opens the output, `c`/`C` copy workflow.json / api.json. Press `r` mid-run and it QUEUES with the values as they are right now. Drafts autosave: reopening lands you where you left off. Image vars open a full picker: browse the disk, favorite folders, recent picks, live preview of the highlighted image in the preview panel.

## ⌨️ The CLI

```bash
bunx comfy-ts gen --id my-gpu --host http://127.0.0.1:8188
# → .comfy-ts/hosts/my-gpu/{object_info.json, embeddings.json, sdk.d.ts, host.json}

bunx comfy-ts outline              # what is inside that 2MB sdk.d.ts?
bunx comfy-ts loras                # mirror your loras' names + trigger words (below)
bunx comfy-ts tui                  # your *.cflow.ts + bundled examples
bunx comfy-ts tui [dir | module]   # scan just that
bunx comfy-ts serve [dir | module] # drafts as a local HTTP API (below)
bunx comfy-ts run 10-anima-t2i --prompt "a knight in the rain" --out knight.png
                                   # one generation, headless: every var a flag
```

Any reachable host works the same: the box under your desk or a GPU machine across the network, same command, same output.

`comfy-ts run` finds the module in your folder, then in the bundled examples, by its key or a unique part of it (`rvion/anima` narrows by folder). `--<var>-file` reads a text var from a file, `--draft <name>` starts from a saved draft, `--json` prints one line with every output path, and `comfy-ts run <name> --help` lists the vars.

### Loras with names, not file names

ComfyUI only tells you a lora's file name. If your host runs the [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager) extension, one command mirrors what it knows into your project:

```bash
bunx comfy-ts loras --id my-gpu --host http://127.0.0.1:8188
# → .comfy-ts/hosts/my-gpu/loras.json  (model names, civitai trigger words, tags, base models, previews)
bunx comfy-ts loras                # refresh later: id and url are remembered
```

After that, in the TUI's loras overlay you can type `aurora ink` to find `styles\aurora-ink-v3.safetensors`, and a lora's civitai trigger words are prefixed onto your `v.prompt` automatically when it is active (⌃K still overrides any lora's keyword by hand). No extension, or no sync yet? Everything behaves as before: file names and hand-typed keywords.

## 🔗 Serve: drafts as an HTTP API

Tune a draft in the TUI, then make it callable by anything that speaks HTTP: a web frontend, curl, n8n, another service:

```bash
bunx comfy-ts serve                     # every *.cflow.ts under cwd, port 8288
bunx comfy-ts serve ./flows             # just that folder
bunx comfy-ts serve txt2img.cflow.ts    # one workflow (routes shorten to /generate/<draft>)
bunx comfy-ts serve --port 9000 --host 0.0.0.0   # pick port / reach it from your phone or tailnet
```

Bound beyond localhost, the startup print lists every URL the box answers on (LAN and tailnet), so the web UI is one tap away on another device. There is no auth: do this only on a network you trust. A browser page on any origin can call it, which is what lets `comfy-ts/web` use serve as its bridge. With no auth, that also means a page you visit can reach the API on your own machine. The launch screen says so every time.

Discover what is served, the same info the startup print shows, as JSON:

```bash
curl http://127.0.0.1:8288/drafts                  # all workflows, their drafts, every var described
curl http://127.0.0.1:8288/drafts/txt2img/moody    # one draft with its stored values
```

Generate:

```bash
curl -X POST http://127.0.0.1:8288/generate/txt2img/default \
  -H 'content-type: application/json' \
  -d '{"prompt": "a red cube", "steps": 8}'
# → { "ok": true, "images": [{ "url": "/outputs/…png", … }], "seeds": … }

curl -X POST http://127.0.0.1:8288/generate/txt2img/moody \
  -H 'accept: image/*' -d '{"seed": 42}' -o out.png   # raw image bytes
```

Draft values are the defaults, the JSON body overrides them per request, and every value is validated before anything is queued (wrong choice? the 400 lists the allowed ones). `GET /drafts` describes every workflow, draft and var, enough for a frontend to render a form. `Accept: image/*` returns the image bytes directly. Drafts are read again on every request: keep the TUI open, tweak, and the next call uses the new values. Serve binds to localhost only unless you say otherwise (`--host`, `--port`).

## 🌐 The web panel

Open that same url in a **browser** and you get a full control panel: no frontend to write, nothing to build, no extra dependency.

- every var as its real control: prompt textarea (`//` comments, `- ` negative lines), sliders, seed mode buttons (`=` `+` `?`) with 🎲, size presets, image upload with preview, and a lora palette. A switch on each lora card pauses or resumes that lora in place, a click on the card opens what it is with per-lora model and clip strengths, and the rest of your loras show as a gallery of preview cards with human model names and trigger words from the [lora mirror](#loras-with-names-not-file-names)
- edits **autosave into the selected draft**, exactly like the TUI (the two stay in sync live). Duplicate or delete a draft from the header
- every click on generate **queues** another prompt. The queue lists them and drops any pending one
- live progress bar and latent preview while it runs, results in a gallery. Click any image for the lightbox (copy to clipboard, open, delete)
- **works on a phone**: collapsible menu, everything touch-sized. With `--host 0.0.0.0`, the startup print gives you the LAN and tailnet urls
- ✨ **prompt refiner** on every prompt var: rewrite the prompt with a thinking model, with the answer and the model's reasoning streamed, then apply it or not. Nothing touches your prompt until you say so. Cloud through **OpenRouter**, or a local model through **Open WebUI** (a local model's `<think>` block goes to the reasoning pane, never into your prompt). Your key stays in the browser and never reaches the serve process. The master prompts are markdown files in `.comfy-ts/prompt-enhancers/`, one per image model, editable from the panel or from your editor

The JSON api above is unchanged: the panel is one more client of it.

## 🕸️ In the browser: `comfy-ts/web`

The same library runs in a browser bundle: define workflows, connect to a host, run, get bytes back, no server in between:

```ts
import { ComfyTS } from 'comfy-ts/web'

const comfy = ComfyTS.create() // in-memory storage, native WebSocket
const host = comfy.host({ id: 'local', url: 'http://127.0.0.1:8188' })
await host.connect()
const wf = host.workflow()
// …build with wf.builder, run, then execution.images[0].getAsBlob()
```

Nothing touches disk: schema caches and outputs live in an in-memory store (pass `ComfyTS.create({ storage })` for your own backend). Types work the same as everywhere else: include a generated `sdk.d.ts` in your tsconfig and every node autocompletes.

The honest support matrix: **local and LAN hosts connect directly** when ComfyUI is started with `--enable-cors-header '*'` (browser websocket auth rides `?token=<api-key>`, because browsers cannot set upgrade headers). **Comfy Cloud sends no CORS headers today**, so cloud from a browser goes through `comfy-ts serve` as the bridge. Runnable page: `bun examples/web/serve.ts`.

## 🌍 Hosts: local, LAN, Comfy Cloud, any provider

Every Comfy works through one identical API: same mechanism, same codegen, same typed SDK, same TUI, whatever answers the protocol:

```ts
// the address `comfy-ts gen --id my-gpu --host …` saved: code that names no machine
comfy.host({ id: 'my-gpu' })

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

[Comfy Cloud](https://cloud.comfy.org) is first-class: the key rides `X-API-Key` on every request and on the websocket, outputs download through the signed-url redirect, live latent previews stream into the TUI, and the whole cloud catalog ships as a committed, browsable SDK ([`examples/comfy-cloud/sdk.d.ts`](examples/comfy-cloud/sdk.d.ts)) with a [model zoo of 73 ready workflows](#the-model-zoo-73-cloud-workflows-43-model-families) built against it. Cloud runs bill your own Comfy Cloud account.

Reaching a Comfy that runs on another one of your machines:

- **ssh tunnel**: `ssh -N -L 8188:127.0.0.1:8188 you@gpu-box`, then `host: '127.0.0.1', port: 8188` as if it were local (`ssh -R` does the reverse: it exposes YOUR Comfy to the remote box).
- **tailscale**: `tailscale serve 8188` on the box gives a stable https url for `url:`. Plain tailnet hostnames work with `host:` too.
- **cloudflared**: `cloudflared tunnel --url http://127.0.0.1:8188` prints a temporary public https url. Paste it into `url:`.

Several GPUs: `comfy.leastBusy` returns the host with the shortest queue, and `run({ host })` runs the workflow there.

```ts
const gpus = [comfy.host({ id: 'gpu-1' }), comfy.host({ id: 'gpu-2' })]
const runs = prompts.map(async (prompt) => {
   txt2img.vars.prompt.value = prompt
   return txt2img.run({ host: await comfy.leastBusy(gpus) })
})
await Promise.all(runs)
```

It counts the jobs in each server's queue, from every client, and the runs this process started that the server has not seen yet, so runs started together spread over the hosts. A host that does not answer is skipped. The graph is built against the host it runs on: a model that host does not have fails the run with ComfyUI's own error.

## 🔌 Custom nodes and models: ComfyUI-Manager

The whole ComfyUI-Manager registry is mirrored into generated types: every known custom node pack, plugin title and model is a typed union. The generated files are committed, browsable TypeScript:

- [`KnownComfyCustomNodeName`](src/manager/generated/KnownComfyCustomNodeName.ts): every node name of every known pack
- [`KnownComfyPluginTitle`](src/manager/generated/KnownComfyPluginTitle.ts) / [`KnownComfyPluginURL`](src/manager/generated/KnownComfyPluginURL.ts): the whole custom-node ecosystem as literal types
- [`KnownModel_Name`](src/manager/generated/KnownModel_Name.ts) and its [`Base` / `Type` / `FileName` / `SavePath`](src/manager/generated/) siblings: every model the registry knows, down to where it installs

A script (or an agent) can read what a workflow needs, see what the host is missing, and install it by name, with the compiler checking the spelling:

```ts
import type { Requirements } from 'comfy-ts'

const needs: Requirements[] = [
   { type: 'customNodesByTitle', title: 'ComfyUI Impact Pack' }, // autocompletes across the ecosystem
   { type: 'modelInManager', modelName: 'TAEF1 Decoder' },
]
await host.manager.fetchPluginsAndModels() // what the host has installed
const { missing, undecided } = host.checkRequirements(needs)

await host.installCustomNodeByTitle('ComfyUI Impact Pack') // true only for a verified install
const model = host.manager.registry.knownModels.get('TAEF1 Decoder')
if (model) await host.manager.installModelOutcome(model) // 'installed' | 'failed' | 'unknown'
```

- **Every Manager generation.** Installs go through the Manager's install queue on the legacy custom node Manager (V3.x) and on the pip Manager 4.x, with its default UI or its legacy UI. `await host.manager.api()` says which one the host runs: `{ generation: 'v3' | 'v4-legacy-ui' | 'v4', version }`.
- **An install returns when it is done.** It resolves after the Manager ran the install and the result is checked, so a large model can take minutes. `timing.installTimeoutMs` (default 1 hour) bounds the wait. A failed status request does not end it: the wait goes on until the host has not answered for `timing.pollGraceMs` (default 2 minutes).
- **Three outcomes.** `installModel` and `installPlugin` return `true` only for a verified install. `installModelOutcome` and `installPluginOutcome` also say `unknown` when the client lost sight of the task while the Manager can still be installing: fetch the lists again and read the status before you install again.
- **Missing or undecided.** `checkRequirements` returns `{ missing, undecided }`: queue installs for `missing` only. A pack or a model the host cannot decide has the status `unknown` in `getPluginStatus` and `getModelStatus`, and `isPluginInstalled` / `isModelInstalled` are `true` only for a known install. `host.matchRequirements` is `false` only when a requirement is known to be missing.
- **The Manager 4.x default UI serves no lists.** There the plugin and model view is built from what the host has installed and the bundled registry, and `update-available` is never reported.
- **A refusal says why.** A refused install logs the route and what the host said. A refusal by the Manager 4.x security policy names the settings it wants.

## 🤖 For AI agents

comfy-ts is built to be driven by agents as much as by people. After you install it, one line in your `CLAUDE.md` teaches your agent the whole library:

```
@./node_modules/comfy-ts/guide-for-agents.md
```

An agent then generates with one command and reads the output paths from one line of JSON: `bunx comfy-ts run <module> --<var> <value> --out <path> --json` ([the CLI](#%EF%B8%8F-the-cli)).

For Claude Code, comfy-ts also ships slash commands: set up a host, write a workflow, convert a ComfyUI JSON, run a generation. Install them into your project from the package:

```bash
bunx comfy-ts skill install   # /comfy-ts-setup, /comfy-ts-workflow, /comfy-ts-convert, /comfy-ts-run, /comfy-ts-guide
```

Or, with no npm install, as a Claude Code plugin (in a Claude Code session):

```
/plugin marketplace add rvion/comfy-ts
/plugin install comfy-ts@comfy-ts
```

Both carry the same skills, which read the guide above from the installed package. A rerun of `skill install` after an upgrade updates them and never overwrites a skill file you edited (`--force` does).

## 🔁 JSON, both ways

- `workflow.toApiJson()`: the executable prompt format.
- `await workflow.toWorkflowJson()`: an AUTOLAYOUTED litegraph file. Drop it on the ComfyUI canvas and see the graph you wrote in code, readably laid out. Dynamic combos, dynamic group inputs, autogrow inputs and widgets fed by a link export the way the editor saves them.
- `host.importApiJson` / `host.importWorkflowJson`: both directions, covered by round-trip tests. Subgraphs are expanded into plain nodes on import, so a re-export is flat. A subgraph that contains itself fails with a `subgraph-cycle` error, and nested subgraphs that expand past 100,000 nodes fail with `subgraph-too-large`.
- Newer editor features are the compat frontier: every official Comfy-Org template and blueprint (about 1,000 files) is swept against our schemas to find the gaps.

## 📚 Examples

Every example is a runnable `*.cflow.ts` module: run it with bun, with `bunx comfy-ts run <name>`, or browse them all with `bunx comfy-ts tui`.

Start with the didactic sequence in [`examples/rvion/`](examples/rvion/). These name their host by id only, `comfy.host({ id: 'windows-1' })`: run `bunx comfy-ts gen --id windows-1 --host http://<your-comfy>:8188` once and they find yours. The models each one names must be on that host.

| example                                                                                  | shows                                                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`01-txt2img`](examples/rvion/01-txt2img.cflow.ts)                                             | typed builder, vars, execution, downloaded outputs                          |
| [`02-img2img-upload`](examples/rvion/02-img2img-upload.cflow.ts)                               | hash-named deduped upload, img2img, async build                             |
| [`03-export-workflow-json`](examples/rvion/03-export-workflow-json.cflow.ts)                   | OFFLINE graph building, export api.json + readable workflow.json            |
| [`04-krea2-turbo-t2i`](examples/rvion/04-krea2-turbo-t2i.cflow.ts)                             | a real pipeline: krea2 turbo, lora stack, RMBG cutout → transparent png     |
| [`05-comfy-cloud`](examples/rvion/05-comfy-cloud.cflow.ts)                                     | the same code on Comfy Cloud: `url` + `apiKey` host, typechecked against the committed catalog SDK |
| [`06-qwen-image-edit`](examples/rvion/06-qwen-image-edit.cflow.ts)                             | Qwen Image Edit 2511, lightning 4-step lora toggle                          |
| [`07-local-llm-text-gen`](examples/rvion/07-local-llm-text-gen.cflow.ts)                       | a local LLM through core `TextGenerate`, text back in `execution.text`. `--sweep` probes every text encoder on the host |
| [`08-qwen-image-21-t2i`](examples/rvion/08-qwen-image-21-t2i.cflow.ts)                         | Qwen Image 2.1 text to image: int8 model, Qwen3-VL 8b encoder                |
| [`09-qwen-image-21-edit`](examples/rvion/09-qwen-image-21-edit.cflow.ts)                       | Qwen Image 2.1 edit: the reference image feeds an autogrow slot, output keeps its size; a remove-background preset |
| [`10-anima-t2i`](examples/rvion/10-anima-t2i.cflow.ts)                                         | Anima text to image: turbo, aesthetic, base or base + turbo lora as one click, anima lora stack, optional RMBG cutout |
| [`11-yue2-t2a`](examples/rvion/11-yue2-t2a.cflow.ts)                                           | YuE2 text to music: the first prompt line is the style, the rest the lyrics; ABC planning shows as a text result |
| [`12-stable-audio-3-t2a`](examples/rvion/12-stable-audio-3-t2a.cflow.ts)                       | Stable Audio 3 Medium: music, instruments, sound effects or one-shots from one description, an optional local LLM rewrite |
| [`13-ace-step-15-xl-t2a`](examples/rvion/13-ace-step-15-xl-t2a.cflow.ts)                       | ACE-Step 1.5 XL: a song with vocals from a caption and lyrics, turbo, sft or base model |
| [`14-video-soundtrack`](examples/rvion/14-video-soundtrack.cflow.ts)                           | a new soundtrack on a video: the frames of one file, the audio of another, core nodes only |
| [`15-tts-voice-clone`](examples/rvion/15-tts-voice-clone.cflow.ts)                             | text to speech in a cloned voice (TTS-Audio-Suite pack): five engines, a language, `execution.audios` |
| [`16-tts-voice-design`](examples/rvion/16-tts-voice-design.cflow.ts)                           | a new voice from a written description: the clip and its line are what example 15 takes |

### The model zoo: 73 cloud workflows, 43 model families

[`examples/comfy-cloud/`](examples/comfy-cloud/) holds one runnable example per family × mode (`<family>-<mode>.cflow.ts`), each transcribed from the official ComfyUI template of that model, typechecked against the committed cloud catalog, and runnable on [Comfy Cloud](https://cloud.comfy.org) with one env var (`COMFY_CLOUD_API_KEY`). Image, video and audio. `(+ name)` marks a variant file of the same family (`flux2-t2i-dev.cflow.ts`):

| mode                | families                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **t2i** text→image  | sd15 (= example 05), sdxl, sd35, flux1 (+ krea), flux2 (+ dev), qwen-image (+ 2512), z-image (+ base), chroma, hidream, hidream-o1, omnigen2, kandinsky5, capybara, krea2, lens, ernie (+ base), longcat, ovis, pixeldit, anima (+ base), newbie, ideogram4, boogu, mage-flow (+ turbo), minimax-h3, netayume |
| **i2i** image edit  | flux1, flux2 (+ dev), qwen-image (+ 2509), hidream, hidream-o1, omnigen2, capybara, longcat, boogu, firered, chronoedit, krea2 (style reference), mage-flow (+ turbo) |
| **t2v** text→video  | wan21, wan22, wan22-5b, ltxv, ltx2, ltx23, ltx25 (with sound), hunyuan-video, kandinsky5                                              |
| **i2v** image→video | wan21, wan22, ltxv, ltx2, ltx23, ltx25 (with sound), hunyuan-video, kandinsky5, capybara, svd                                         |
| **t2a** text→audio  | ace-step (song), ace-step15 (song), minimax-music3 (song), stable-audio (sfx/music), stable-audio3 (sfx/music), chatterbox (tts)       |

Every zoo file imports offline and headless (no key, no cache needed: CI proves it), builds a validated graph, and doubles as a TUI app with typed knobs: prompt, seed, steps, size, input image, …

## 🗂️ The `.comfy-ts/` folder

One folder of local state per consumer repo: `hosts/` (schema dumps, the generated sdk and the saved address per host), `outputs/`, `drafts/`, TUI settings, lora keywords. Gitignore all of it. `hosts/` is a full dump of that machine's models and paths (~10MB), so a commit of it publishes your setup. In a PRIVATE repo, a commit of it is what buys you typed CI.

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
| ephemeral outputs: `SaveImageWebsocket` streaming, opt-in save |   ✅   |
| `ephemeral` rewrite + server history scrub + base64 inputs     |   ✅   |
| export api.json + autolayouted workflow.json                   |   ✅   |
| import api.json into a live workflow                           |   ✅   |
| import workflow.json (litegraph → api conversion)              |   ✅   |
| sidekick CLI (`gen`, `outline`, `loras`, `tui`, `serve`)       |   ✅   |
| `comfy-ts run`: one headless generation, every var a flag      |   🔶   |
| serve web panel: every var as a control, queue, gallery, phone |   ✅   |
| prompt refiner in the panel (OpenRouter or local Open WebUI)   |   ✅   |
| cloud hosts: `url` + `X-API-Key` auth, Comfy Cloud ran live    |   ✅   |
| several GPUs: `comfy.leastBusy(hosts)` picks the shortest queue |   🔶   |
| ComfyUI-Manager registry mirror + Known\* ecosystem unions     |   ✅   |
| install custom nodes / models through the ComfyUI-Manager queue (V3.x, 4.x) |   🔶   |
| content-addressed local asset cache                            |   🔶   |

✅ working and exercised · 🔶 partial / in progress

## 🧱 A library you can trust, made to last

The features above sit on boring foundations:

- **Strict TypeScript everywhere.** `strict` + `noUncheckedIndexedAccess`, no `any`, every remaining cast individually justified in a reviewed whitelist.
- **A hard CI gate on every commit.** Typecheck, zero-warning lint (a warning is fixed or the rule is disabled on purpose, never ignored), format check, import hygiene, the full headless test suite.
- **Runtime validation with arktype.** Wire messages and JSON formats are schema-validated. When ComfyUI drifts faster than the schemas, failures are logged loud, never swallowed.
- **Codegen you can regenerate, never hand-edit.** The SDK, the manager unions and the snapshot tests around them all rebuild from source data with one command each.
- **A compat grind loop, not compat hope.** The full official corpus from Comfy-Org (about 1,000 templates and blueprints) is mirrored locally and swept against our schemas on demand, so an upstream format change surfaces as a failing report line, not as your broken pipeline.
- **Boring packaging.** Dual ESM/CJS, Bun and node ≥ 20, `src/` shipped in the tarball for go-to-definition.

## Related projects

- [CushyStudio](https://github.com/rvion/CushyStudio), where this library was born.
- [@saintno/comfyui-sdk](https://www.npmjs.com/package/@saintno/comfyui-sdk), polished API, but unsafe workflow building, no typed registry.
- [comfyui-bun-client](https://github.com/KaruroChori/comfyui-bun-client), similar spirit, less codegen, not on npm.

## Support

comfy-ts is free, MIT, and maintained for the long run. If it saves you time or powers something you sell, consider [sponsoring](https://github.com/sponsors/rvion): it keeps the grind loops grinding.

## License

MIT © [rvion](https://github.com/rvion)
