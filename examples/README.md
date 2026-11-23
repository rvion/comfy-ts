# comfy-ts examples

Every `*.cflow.ts` file here is a runnable workflow module. Run it directly with bun, run it headless with `bunx comfy-ts run <name>`, or browse them all in the TUI (`bunx comfy-ts tui` lists them under "comfy-ts examples": tweak vars, ⌃R to run).

## Layout

- `rvion/01…04-*.cflow.ts`: the didactic sequence against a LOCAL ComfyUI host, named by id only: `comfy.host({ id: 'windows-1' })`. Run `bunx comfy-ts gen --id windows-1 --host http://<your-comfy>:8188` once: it saves the address and generates the typed SDK.
- `rvion/05-comfy-cloud.cflow.ts`: the same t2i against [Comfy Cloud](https://cloud.comfy.org). No local GPU needed: the typed catalog ships committed at `comfy-cloud/sdk.d.ts`.
- `rvion/06-qwen-image-edit.cflow.ts`: image editing (qwen image edit 2511) against the same local host.
- `rvion/07-local-llm-text-gen.cflow.ts`: a local LLM, no image. Core's `TextGenerate` runs a chat model loaded through `CLIPLoader`, and the text comes back in `execution.text`. `--sweep` reports which text encoders on your host actually generate.
- `rvion/08-qwen-image-21-t2i.cflow.ts` / `rvion/09-qwen-image-21-edit.cflow.ts`: Qwen Image 2.1 (ComfyUI ≥ 0.37) against the same local host: text to image, and instruction editing of one reference image (its `remove background` preset is the official background-removal template).
- `rvion/10-anima-t2i.cflow.ts`: Anima text to image. Turbo, aesthetic, base, or base + turbo lora as one choice, an anima lora stack, an optional RMBG cutout. The model file is a `v.model` choice over the anima files on your host.
- `rvion/11-yue2-t2a.cflow.ts`: YuE2 text to music. The first prompt line is the style and the rest is the lyrics. ABC planning is a choice (full, melody, off), and the plan shows as a text result next to the song.
- `rvion/12-stable-audio-3-t2a.cflow.ts`: Stable Audio 3 Medium: music, instruments, sound effects or one-shots from one description. With `reprompt` on, a local Qwen3.5 2B first rewrites the description with the official template's instructions for the chosen category.
- `rvion/13-ace-step-15-xl-t2a.cflow.ts`: ACE-Step 1.5 XL: a song with vocals from a caption and lyrics, with the turbo, sft or base model, and bpm, key, beats per bar and language as settings.
- `rvion/14-video-soundtrack.cflow.ts`: a new soundtrack on a video. The frames of one file and the audio of another are muxed back at the fps you pick. Core nodes only. `exampleMediaPath()` resolves the bundled sample video and audio it defaults to.
- `rvion/15-tts-voice-clone.cflow.ts`: text to speech in a cloned voice (needs the [TTS-Audio-Suite](https://github.com/diodiogod/TTS-Audio-Suite) custom node pack on the host). Pick an engine (Chatterbox Multilingual v3 by default, Qwen3-TTS, Fish Audio S2 Pro, CosyVoice3, OmniVoice) and a language, drop a voice clip and write its transcript, and the text comes back as audio in `execution.audios`. A short synthetic English voice ships in `media/`, so it runs out of the box.
- `rvion/16-tts-voice-design.cflow.ts`: a new voice from a written description (needs TTS-Audio-Suite, Qwen3-TTS VoiceDesign). It speaks one sample line in that voice, and the clip plus that line are what `15-tts-voice-clone` takes as `voice` and `transcript`. From the command line the flow is two runs: `comfy-ts run tts-voice-design --description "…" --line "…" --out voices/sailor.flac` writes the clip and `voices/sailor.txt`, then `comfy-ts run tts-voice-clone --voice voices/sailor.flac --prompt "…" --out lines/001.flac` speaks any line in it.
- `comfy-cloud/<family>-<mode>.cflow.ts`: the model zoo, 73 files for 43 model families. One clean example per model family × mode (`t2i`, `i2i`, `t2v`, `i2v`, `t2a`), each mirroring an official ComfyUI template (flux, qwen-image, z-image, wan, ltx, hidream, ace-step, stable-audio, …). A suffix after the mode names a variant of the same family (`flux2-t2i-dev`). All share `comfy-cloud/cloudHost.ts`. The full list by mode is in the [main README](../README.md#the-model-zoo-73-cloud-workflows-43-model-families).
- `web/`: the browser entry `comfy-ts/web` in a runnable page (`bun examples/web/serve.ts`).
- `rvion/17-relight.cflow.ts`: relight a photo in the web panel. It runs one depth model and one normal model (a choice each) and, behind two toggles, Marigold material maps (albedo, roughness, metalness, reflections). Every map is tagged, and the module names the panel's `relight` widget, which draws the photo lit by a point light you drag over it: left/right, up/down, the wheel for nearer/farther, with shadows from the depth map and drifting light motes. Needs the ControlNet preprocessors pack and, for materials, [ComfyUI-Marigold](https://github.com/kijai/ComfyUI-Marigold).
- `depth-explorer/`: a small web app that runs every depth, normal and material estimator your host has on one image and compares them: a grid, a wipe slider against the source or another model, a 3D relief of each depth map, and the relight widget fed with the best maps of the grid (`bun examples/depth-explorer/serve.ts [--samples <dir>]`, then http://127.0.0.1:8292). Depth Anything 3, MoGe-2, Marigold v2, Lotus, Depth Anything V2, Metric3D v2, DSINE, Marigold IID and the ControlNet preprocessors; a model your host lacks shows the weight files it needs, with their download links. One ComfyUI graph per model lives in `depth-explorer/models.ts`.
- `upscale-explorer/`: the same kind of app for upscalers (`bun examples/upscale-explorer/serve.ts [--samples <dir>]`, then http://127.0.0.1:8294). Every result comes out at the same size (×2 or ×4 the source), so you can judge them pixel for pixel: a loupe shows every result on the same crop at 100 %, and a pair view compares two of them side by side, with a curtain, as an onion skin, one over the other on hover, or as the pixels that changed. The wheel zooms at the pointer and every picture follows. UltraSharp V2, IllustrationJaNai V3, Nomos2, AnimeSharp V4, SeedVR2 (3B and 7B sharp, on core ComfyUI nodes) and the ESRGAN classics, each against plain Lanczos. Both apps share `explorer-kit/`.

## Cloud API key

Cloud examples read `COMFY_CLOUD_API_KEY` (create one at cloud.comfy.org, paid tiers). Without it everything still loads and typechecks: only `run()` needs the key.

```sh
COMFY_CLOUD_API_KEY=… bun examples/rvion/05-comfy-cloud.cflow.ts "a fox in the snow" 42
```

Cloud runs bill compute to your account. Start with a small t2i.
