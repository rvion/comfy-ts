# comfy-ts, guide for coding agents

You are working in a project that uses `comfy-ts`, a type-safe ComfyUI
companion for TypeScript. It connects to one or more ComfyUI hosts, generates
one typed SDK per host (global `Comfy.<HostNs>.*` namespaces), builds
workflows in code with full autocomplete, executes them over websocket, and
downloads the output images. Include this file from the project's CLAUDE.md:
`@./node_modules/comfy-ts/guide-for-agents.md`.

## Setup flow

1. Install: `bun add comfy-ts` (npm/pnpm/yarn work too, node >= 20).
2. Generate the per-host schema cache + typed SDK once per host:

   ```bash
   bunx comfy-ts gen --id my-gpu --host http://127.0.0.1:8188
   # writes .comfy-ts/hosts/my-gpu/{object_info.json,embeddings.json,sdk.d.ts}
   ```

   Or skip the CLI: a first `await host.connect()` fetches the schema and
   writes the same files.
3. Activate the generated types in tsconfig:

   ```jsonc
   { "include": ["src", ".comfy-ts/hosts/**/sdk.d.ts"] }
   ```

4. Gitignore `.comfy-ts/` entirely. It is local state: host schema dumps
   (often ~10MB, they describe that machine's models and paths), run outputs,
   TUI drafts and settings, lora keywords, preview cache. Everything in it is
   regenerable. (Exception: a private repo may commit `hosts/` to get typed CI.)

Before the first codegen the builder falls back to permissive base types, so
code compiles either way. Types sharpen once a generated sdk.d.ts is in scope.

## The workflow pattern: defineWorkflow + vars + build

A workflow module is a `*.cflow.ts` file (that suffix is what the TUI scans
for). Minimal complete example:

```ts
import { ComfyTS, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'my-gpu', host: '127.0.0.1', port: 8188 })
await host.loadSchemaFromCache() // offline import; run() connects lazily

export const txt2img = host.defineWorkflow({
   id: 'txt2img',
   vars: {
      prompt: v.text('a cozy house in a snowy forest'),
      seed: v.seed(42),
      steps: v.int(20, { min: 1, max: 60 }),
      size: v.size({ width: 512, height: 512 }),
   },
   build: (b, vars) => {
      // b is Comfy.MyGpu.Builder: one typed factory per node of THIS host
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

// standalone run, skipped when a driver (the TUI) imports this module
if (import.meta.main) {
   const execution = await txt2img.run({ log: true })
   for (const img of execution.images) console.log(img.absPath)
   host.disconnect()
}
```

Var kinds: `v.text`, `v.int`, `v.float`, `v.seed`, `v.toggle`, `v.choice`,
`v.size`, `v.loras`, `v.prompt`. Notes:

- `v.loras(/regex/)` resolves against the host's real lora list;
  `activeLoras(vars.loras)` returns `{ lora_name, strength_model, strength_clip }[]`
  for a standard `LoraLoader` chain.
- `v.prompt` is structured: `//` lines are comments (stripped), `- ` lines go
  to the negative prompt, `{ loraKeywordsFrom: lorasVar }` prefixes lora
  trigger keywords. The value is `{ positive, negative }`.
- `vars` may be a lambda `(v) => ({ ... })` so vars can reference each other.
- `build` may be async, for uploads: the third param `wf` feeds `MediaImage`
  helpers (`new MediaImage({ path }).loadInWorkflow_viaLoadImageNode(wf)`).
  Uploads are hash-named and deduped, nothing is re-sent.

## Running and getting images

- `await workflow.run({ log: true })` connects (idempotent, one websocket per
  host), builds a fresh graph from current var values, executes, streams
  progress, and returns a `ComfyExecution`.
- `execution.images` are downloaded `MediaImage`s: `img.absPath`,
  `img.width`, `img.height`.
- Tweak then re-run: `workflow.vars.seed.randomize()` or
  `workflow.vars.prompt.set('...')`, then `run()` again.
- `run({ onProgress })` gives a progress callback instead of console logs.
- Call `host.disconnect()` at the end of a standalone script or the process
  stays alive on the open websocket.

## CLI

```bash
bunx comfy-ts gen --id <host-id> [--host http://127.0.0.1:8188]  # codegen
bunx comfy-ts outline [file] [--section Name] [--lines N]  # inspect a sdk.d.ts
bunx comfy-ts tui [dir | module.cflow.ts]  # interactive tweak & re-run
```

The TUI scans `**/*.cflow.ts` (no arg: cwd), shows vars as editable knobs,
runs with live progress and previews, and saves named drafts under
`.comfy-ts/drafts/`. Point users at it; as an agent you run modules with
`bun path/to/module.cflow.ts`.

## Import and export ComfyUI JSON

- `host.importApiJson(json)` turns an `api.json` (prompt format) into a
  `ComfyWorkflow`.
- `host.importWorkflowJson(json)` does the same for a saved `workflow.json`
  (litegraph format, handles muted nodes, Note/Reroute/PrimitiveNode).
- `wf.toApiJson()` exports the prompt format;
  `await wf.toWorkflowJson()` exports an autolayouted `workflow.json` you can
  drag into the ComfyUI editor. Both work fully offline:
  `const wf = await workflow.build()` never needs a live server.

## Gotchas

- **Offline cache vs live connect.** `host.loadSchemaFromCache()` reads
  `.comfy-ts/hosts/<id>/` and never touches the network, so modules import
  instantly and offline. `run()` connects lazily. If the cache is missing,
  run the `gen` command or `connect()` first. `connect()` reuses a cache
  younger than 24h; `connect({ schema: 'refresh' })` forces a re-fetch.
- **Per-host namespaces.** Types come from `Comfy.<HostNs>` keyed by the host
  `id` you pass to `comfy.host({ id })` (`my-gpu` becomes `Comfy.MyGpu`). A
  new id has no generated sdk yet, so you silently get permissive base types:
  model names widen to `string` and typos stop being caught. Keep the id
  stable and regenerate after installing custom nodes on the host.
- **Registries.** `ComfyTS.create()` returns the existing global instance,
  and `comfy.host({ id })` returns the already-registered host for that id.
  Modules can import each other safely in one process.
- **Seeds.** `v.seed` carries a mode (`+` increment, `-` decrement, `=`
  fixed, `?` reroll) and advances itself after every run, so a batch of runs
  gets distinct seeds by default. When reproducibility matters, pin both the
  mode and the value: `vars.seed.setMode('=')` then `vars.seed.set(N)`.
  `set()` alone keeps the current mode, so a prior `?` would still reroll.
- **`auto<T>()` slots.** From `import { auto } from 'comfy-ts'`: leave an
  input blank and comfy-ts wires the most recent node producing that type.
  Handy, but implicit; prefer explicit wiring in code meant to be read.
- **Errors before the server.** Invalid graphs accumulate messages in
  `workflow.problems` before ComfyUI ever sees them. Check it when a run
  misbehaves.
