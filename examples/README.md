# comfy-ts examples

Every `*.cflow.ts` file here is a runnable workflow module: run it directly with bun, or browse them all in the TUI (`bunx comfy-ts tui` lists them under "comfy-ts examples", tweak vars, ⌃R to run).

## Layout

- `rvion/01…04-*.cflow.ts` — the didactic sequence against a LOCAL ComfyUI host (edit the `comfy.host({...})` line to point at yours, then first run generates a typed SDK for it).
- `rvion/05-comfy-cloud.cflow.ts` — the same t2i against [Comfy Cloud] (https://cloud.comfy.org): no local GPU needed, the typed catalog ships committed at `comfy-cloud/sdk.d.ts`.
- `rvion/06-qwen-image-edit.cflow.ts` — image editing (qwen image edit 2511) against the same local host.
- `rvion/07-local-llm-text-gen.cflow.ts` — a local LLM, no image: core's `TextGenerate` runs a chat model loaded through `CLIPLoader`, and the text comes back in `execution.text`. `--sweep` reports which text encoders on your host actually generate.
- `comfy-cloud/<family>-<mode>.cflow.ts` — the model zoo: one clean example per model family × mode (`t2i`, `i2i`, `t2v`, `i2v`, `t2a`), each mirroring an official ComfyUI template (flux, qwen-image, z-image, wan, hidream, ace-step, …). All share `comfy-cloud/cloudHost.ts`.

## Cloud API key

Cloud examples read `COMFY_CLOUD_API_KEY` (create one at cloud.comfy.org, paid tiers). Without it everything still loads and typechecks — only `run()` needs the key:

```sh
COMFY_CLOUD_API_KEY=… bun examples/rvion/05-comfy-cloud.cflow.ts "a fox in the snow" 42
```

Cloud runs bill compute to your account — start with a small t2i.
