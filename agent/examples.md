# The example zoo

`examples/` is the FIRST thing a consumer reads and playtests — the examples ARE the review surface. This doc owns their shape: layout, the shared cloud helper, the per-mode vars conventions, the key story, and the verification bar. The build matrix at the bottom is the ground truth for which zoo files exist and which official template each one mirrors.

## Layout

```
examples/
   rvion/                        rvion's own numbered sequence (moved 2026-07-30)
      01-txt2img.cflow.ts        didactic sequence, local host (windows-1)
      02-img2img-upload.cflow.ts
      03-export-workflow-json.cflow.ts
      04-krea2-turbo-t2i.cflow.ts
      05-comfy-cloud.cflow.ts    cloud intro = the zoo's sd15/t2i row (reference impl)
      06-qwen-image-edit.cflow.ts   local edit model on windows-1 (edit 2511)
      07-local-llm-text-gen.cflow.ts  core TextGenerate: a local LLM, no image. `--sweep` probes every text encoder on the box
      08-qwen-image-21-t2i.cflow.ts   qwen image 2.1 on windows-1 (image_qwen_image_2_1_t2i), not on the cloud catalog yet
      09-qwen-image-21-edit.cflow.ts  qwen image 2.1 edit, one reference in the `images.image_1` autogrow slot; the `remove background` preset = image_qwen_image_2_1_background_removal
      10-anima-t2i.cflow.ts           anima on windows-1: a model choice (turbo v1.1, aesthetic v1.1, base v1.0, base + turbo lora; distilled = 8 steps cfg 1, else the steps/cfg vars), a sampler choice (auto = er_sde or euler), the model card's leading tags as buttons above the prompt (safety, score, quality; score skipped on aesthetic, `animaTags`), danbooru tag completion in the prompt (`tags`, the tagcomplete csv by url, artists get `@`), loras from `anima/` folders only, RMBG cutout like 04
                                    the `streaming` toggle swaps in extra/comfyui-textgen-stream's node when the host has it (feature-detected), so the answer is watched as it is written
      11-yue2-t2a.cflow.ts            YuE2 text to music on windows-1 (audio_yue2_text2music): first prompt line = style, the rest = lyrics; ABC planning as a choice (full, melody, off); PreviewAudio (server temp/ only), the song plays in the serve panel
      12-stable-audio-3-t2a.cflow.ts  Stable Audio 3 Medium on windows-1 (audio_stable_audio_3_medium): one description, a category (Music, Instrument, SFX, One-shot), a length; `reprompt` rewrites it first with a local qwen3.5 2b and the template's per-category system prompt (verbatim in `stableAudio3Prompts.ts`, plain .ts so no driver lists it), the rewrite shows as a text output
      13-ace-step-15-xl-t2a.cflow.ts  ACE-Step 1.5 XL on windows-1 (audio_ace_step1_5_xl_{turbo,sft,base}): a model choice with each template's sampling (turbo 8 steps cfg 1, sft 50 cfg 7, base 50 cfg 6); first prompt line = caption, the rest = lyrics; bpm, key, beats per bar, language
      14-video-soundtrack.cflow.ts    core nodes only on windows-1: `v.video` frames (GetVideoComponents) + `v.audio` soundtrack muxed by CreateVideo at a picked fps, SaveVideo; the media-var showcase (both default to `examples/media/`, the result lands in `execution.videos`)
      16-tts-voice-design.cflow.ts    a new voice from a written description on windows-1: Qwen3TTSEngineNode on its `Voice Design - 1.7B VoiceDesign` checkpoint into UnifiedVoiceDesignerNode (description + one sample line), PreviewAudio → `execution.audios`, and the line itself through PreviewAny → `execution.texts`, which `comfy-ts run` writes beside the clip as its transcript: the pair 15 takes as `voice` + `transcript`
      15-tts-voice-clone.cflow.ts     text to speech in a cloned voice on windows-1 through the TTS-Audio-Suite custom node pack: an engine choice (chatterbox, qwen3, fishs2, cosyvoice3, omnivoice), a language, `v.audio` voice clip + its transcript (CharacterVoicesNode) into UnifiedTTSTextNode, PreviewAudio → `execution.audios`; bundled synthetic voice `media/voice_en_6s.flac`
      17-relight.cflow.ts             the OUTPUT WIDGET showcase on windows-1: a depth choice and a normal choice over the depth explorer catalog (`../depth-explorer/models.ts`, the runnable ones only), Marigold IID material maps behind two toggles; every map saved with a `tag`, and `widgets: [widget.relight(...)]` maps the tags to roles, so the serve panel draws the relight widget over the run
      18-world.cflow.ts               one picture to a 360° world on windows-1: the HY-Pano 2.0 LoRA on Qwen-Image-Edit-2509 paints a 1952×960 panorama, its own edge blend (circular_blend_edges, done in the graph) makes it a seamless 1920×960, MoGe turns it into a mesh (SaveGLB); a 3D output lands in `execution.models3d`
      19-flythrough.cflow.ts          a camera path through a picture's world on windows-1: the path (`flythroughPath.ts`: a walk in, or an orbit round a picture pixel `aim`, `aimRow` at `aimDistance`; `pitch`, the degrees the picture looks down at its floor, levels the path's world so the orbit circles the floor's vertical, and the mesh, the COLMAP points and the trained splat take the same turn) is drawn on the Mac as a depth guide over the picture's MoGe mesh (`flythroughGuide.ts`, 30 ms a frame), a video model follows it (Wan 2.2 Fun Control, or MiniMax H3 with its Fun ControlNet at 0.6 and the first frame cropped to the clip's shape), `flythroughChain.ts` chains clips from each last frame, `flythroughColmap.ts` exports the frames with their planned cameras for a splat trainer (Brush), `flythroughSplat.ts` turns the trained splat to the viewers' axes, `flythroughPalette.ts` measures each frame's drift from the picture's palette (Lab mean ΔE, lightness, green to red, blue to yellow, contrast, saturation, hue histogram distance, a chart per run) and pulls frames back to it (the chain's start frames; a last pass over a whole video, its stats smoothed over a second). H3 can also take the picture as a reference image every clip (`h3Look: reference`, the start frame anchored by MiniMaxH3AddGuide). Tests: `tests/flythrough-path.test.ts`, `tests/flythrough-palette.test.ts`. A trained splat is scored with `splatEval.ts` (each COLMAP camera drawn by the CPU rasterizer with its view dependent colour, PSNR and SSIM against its frame, all and per clip; the needles, a long axis over 20 times the middle one, and the splats no training camera sees; `--prune-seen`, `--prune-needle` cut them), on a split `splatDataset.ts` picks from a full export (every 8th frame of the every 4th set held out for every variant, no training frame within `gap` frames of one). Tests: `tests/splat-eval.test.ts`
      20-grow-splat.cflow.ts          the fill step of growing a one-picture splat (SHARP) by rendering it from a new angle: Qwen-Image-Edit-2509 repaints only the empty part (a latent noise mask). Its helpers in `grow-splat/` (a ply reader and writer, a CPU splat renderer, the scale fit, SHARP over ssh, the loop) are tested in `tests/grow-splat.test.ts`. Measured: the loop cannot go round a subject, because a one-view splat's depth-jump curtains cover the new views and no round can repair them
   explorer-kit/                   what the explorer apps share: catalog, server, run queue, widgets (section below)
   depth-explorer/                 a mini web app, not a module (section below)
   upscale-explorer/               a mini web app, not a module (section below)
   world-explorer/                 a viewer of 3D worlds, the `world` kind's page in the hub's threads (section below)
   comfy-cloud/
      sdk.d.ts                   committed cloud catalog (gen:sdk:cloud)
      cloudHost.ts               shared host helper — NOT .cflow, invisible to the TUI
      <family>-<mode>.cflow.ts   the zoo, flat, family-prefixed
   images/                       bundled input images (committed, ship in the tarball)
      <subject>_<W>x<H>.jpg      exact size in the filename, see below
   media/                        bundled audio + video inputs (synthetic ffmpeg test sources, ship in the tarball; `exampleMediaPath(name)`, recipes in media/README.md)
   README.md                     consumer-facing quick start
```

The TUI tree renders this layout as a real hierarchy (directory rows, one color per `<family>` prefix — mechanics owned by architecture.md).

- Zoo files are FLAT under `examples/comfy-cloud/`, named `<family>-<mode>` (`flux1-t2i.cflow.ts`, `wan22-i2v.cflow.ts`). No per-family subfolders: drafts are keyed by MODULE BASENAME (`.comfy-ts/drafts/<basename>/`), so basenames must be unique repo-wide — the family prefix guarantees it, and alphabetical sort groups a family's modes together in the TUI tree anyway.
- Mode vocabulary (closed): `t2i`, `i2i`, `t2v`, `i2v`, `t2a`.
- Family keys are short lowercase slugs (`sd15`, `sdxl`, `sd35`, `flux1`, `flux2`, `qwen-image`, `z-image`, `wan21`, `wan22`, `ltxv`, …) — see matrix.
- Variant suffix only when a family gets TWO files for the same mode (`flux2-t2i-dev` next to `flux2-t2i`); the unsuffixed name is the recommended default.
- A local-host example names its host by id ONLY: `comfy.host({ id: 'windows-1' })`. The address lives in the gitignored `.comfy-ts/hosts/<id>/host.json` that `comfy-ts gen --host … --id …` writes. examples/ ships on npm, so a machine name or an address in a host line is a leak (SK035 fails it).

## examples/explorer-kit (what the explorer apps share)

The depth and upscale explorers are one shape: a catalog of models, one ComfyUI graph each, run one at a time on one source image, each result its own card. The kit holds that shape once; an explorer adds its catalog, its params and its views.

- `catalog.ts`: `CatalogEntry` (the card facts: label, family, date, weights size, quality, speed, blurb, the nodes and `WeightFile`s it needs), `availability(info, entry)` read from the LIVE schema (a missing node or a weight file absent from its loader's combo), `base(wf, name)` for graphs that name weight files the generated sdk does not know yet.
- `server.ts`: `serveExplorer({ name, port, page, catalog, card, readParams, build })` serves the catalog with its availability, the samples (the bundled images plus every `--samples <dir>`), the source upload (by content hash, sent once) and `/api/run` (one prompt per run, ending in `SaveImageWebsocket`, so a result never touches the host disk). The last 48 results stay in memory by (image, model, params): a reload of the page gets them back at once (`x-cached: server`, the time the run's own). When ComfyUI reused a prompt it ran before (no node but the save ran), the answer says `x-cached: box` and the page shows « box cache » instead of a time, which would only be the transfer. `COMFY_URL` points it at another road to the same box (the ssh tunnel, `http://127.0.0.1:8085`).
- `web/runs.ts` (`RunQueue`, `RunSt` with time, bytes and pixel size, `uploadSource`, `fetchCatalog`), `web/ui.tsx` (`Seg`, `SourcePicker`: drop, click, paste or a sample, `RunBody`: missing files, run, queued, the timer, the error), `web/base.css` (tokens, sidebar, grid of cards, focus box). Each page links `base.css` before its own `styles.css`.

## examples/depth-explorer (a mini app, not a module)

A Bun server (`serve.ts`, port 8292, `bun run depth`, on the explorer kit) plus a React + MobX page (`web/`, own dom tsconfig like `examples/web`, chained in `typecheck:full`). It is NOT a `.cflow.ts` module: it compares many graphs on one input, which the panel's one-module view cannot.

- `models.ts` is the catalog: one entry per estimator (kind depth, normal or material, tier modern or classic, the nodes and weight files it needs), each a `build(b, image, p)` that returns the output image; the server adds `SaveImageWebsocket`. Availability is the kit's. Module 17 shares the catalog.
- Materials: Marigold v2 albedo (core nodes), and Marigold IID through kijai/ComfyUI-Marigold (diffusers pipeline, weights under `models/diffusers/`): appearance gives albedo + a material image (R roughness, G metalness, split with ImageToMask), lighting gives albedo, diffuse shading and the non diffuse residual (the `specular` map). Each map is its own entry; ComfyUI's cache runs the decomposition once per image.
- The relight view IS the serve panel's relight widget (`src/cli/serve/web/widgets/`), fed with the focus and the best finished maps of the grid; `gl.ts` keeps only the 3D relief. One relight implementation.
- Depth Anything V2 ViT-G is not in the catalog: its weights were never published (the controlnet_aux url answers 401).
- One prompt per model, run one at a time by the page: each card fills as its model ends, a failure stays one card, and ComfyUI's cache reuses the shared upload and loaders.
- Depth convention: near = white for every entry. DA3 renders LINEAR depth, so its graph squares the float tensor twice (`ImageBlend` multiply) before the 8 bit save to get a disparity-like curve comparable to the others.
- Marigold v2 builds on the BASE builder: its weights are not in the host sdk until downloaded, and the typed builder cannot name them.
- Deep link for headless checks and bookmarks: `?image=<sample>&run=all|<id,id>&focus=<id>&view=wipe|3d|light`. `--samples <dir>` (repeatable) adds a folder of images to the bundled ones.
- Demo video: the page sets `<meta name="shot-ready">` to `ready` once every queued run ended, and `window.tour(t)` draws the scripted tour at time t (grid, wipes, relief, a material, then the relight widget's own `relightTour`): `sk shot '<url>?image=…&run=all' --video 30 --dom --step tour`.

## examples/upscale-explorer (a mini app, not a module)

A Bun server (`serve.ts`, port 8294, `bun run upscale`, the global process `upscale-explorer` through the tunnel) plus a React + MobX page (`web/`, own dom tsconfig, chained in `typecheck:full`), on the explorer kit. Its question: which upscaler makes a scan crispest where print shows it (text, symbols, fine lines).

- `models.ts`: the Lanczos baseline, the spandrel models (`ImageUpscaleWithModel`: DAT2, HAT-L, RCAN, RealPLKSR, ESRGAN) and SeedVR2 (the Comfy-Org image template on core nodes: Lanczos to size, one diffusion step, tiled VAE). Every result lands at the SAME size, the source times the page's scale (×2 or ×4): a model of another native factor is brought there with Lanczos (`ImageScaleBy`), so every comparison is pixel for pixel. The loaders name their weight files on the base builder: a file downloaded since the sdk was generated must run.
- ONE view (centre 0..1, zoom in device pixels per result pixel, or fit) for every picture of the page: the loupe (every finished result on the same crop, a navigator on the source to move it) and both sides of the compared pair follow it. Wheel or pinch zooms at the pointer, a drag pans, a double click goes to 100 % there and back to fit, + − 0 (fit) 1 (100 %).
- The pair compares two results (or a result against the source) in the hub's five modes, its glyphs and tips (shipkit `review-views.tsx`): side by side ◫, curtain ⇹ (a press within 12 px of the line drags it, anywhere else pans), onion skin ◐ with its opacity, the after alone ▣ with the before under the pointer, and only what changed ≠ (the hub's noise threshold, computed at full size in the browser). D cycles, ⇧D back. A card clicked opens it against Lanczos at 100 % where the click landed.
- The grid shows a 640 px copy of each result, never the 12 MP files; the loupe and the pair draw the full files, `image-rendering: pixelated` above 100 %.
- Rejected for this catalog: SUPIR and the Flux or PiD upscalers (generative: they redraw small text; SUPIR also needs an SDXL base and a prompt), LDSR (its own node pack, slow), the FDAT IllustrationJaNai variants (spandrel 0.4.1 has no FDAT).
- Deep link: `?image=<sample>&scale=2|4&classic=1&run=all|<id,id>&layout=loupe&at=<cx>,<cy>&z=<zoom|fit>&compare=<after>&before=<id>&mode=side|swipe|onion|mod|diff`. The ready mark waits for every run and its grid copy.

## examples/world-explorer (a viewer of 3D worlds)

A Bun server (`serve.ts`, port 8293, loopback, `bun run world`, the global process `world-explorer`) plus a React + MobX page (`web/`, own dom tsconfig, chained in `typecheck:full`) that draws the 3D views with the house viewer, `View3d` of `rvlib-shipkit/src/view3d/viewer.ts` (the same viewer as the hub's thread lightbox; three and Spark are shipkit's dependencies, never this repo's). The page owns the tabs, the keys, the full screen, the thumbnail and the flat picture; the viewer owns the scene, the camera and every gesture. It runs nothing on ComfyUI: it shows what a world pipeline made, so a scene is explored in a thread of the hub instead of watched as a video.

- A world is a folder `.comfy-ts/worlds/<name>/` (gitignored data) holding any of `source.png` (the picture), `panorama.png` (equirectangular 2:1), `world.glb` (a textured mesh around the origin, y up, the eye at the origin, drawn unlit) and `splat.ply` (SHARP 3D Gaussians in OpenCV axes; the server reads the camera's vertical fov from its `intrinsic` and `image_size` elements, so the splat opens framed as the picture was).
- The page has one tab per file the world has: `pano` (drag to look, wheel or pinch for the field of view), `world` (the mesh, walked level), `splat` (flown) and `source` (the flat picture). One viewer draws one view: a tab switch loads its file again (from the browser's cache), and the `source` tab has no viewer at all. The gestures are the house viewer's (`view3d/cam.ts`), as follows. In `world` and `splat` the eye moves freely: a left drag looks (`world`) or orbits around the point `dist` ahead (`splat`, the median depth of its splats by default), a right drag or shift + drag pans (the eye and that point together, the point under the pointer following it), a trackpad's two finger drag pans and its pinch goes forward, a mouse wheel goes forward and back, WASD or the arrows move (by their place on the keyboard, so an AZERTY's ZQSD), Q and E (or space) go down and up. A release while moving glides on, as the hub's panorama does. R, a double click or « reset view » go back to the start; F or « full screen » fill the screen with the page (the browser's fullscreen on its root, allowed in the hub's same origin frame), Esc leaves it. The wheel is the view's only once he clicked into it, so a world in a thread never traps the page's scroll; a pinch always is.
- Its keys: `key=<world>`, `view=<tab>`, `cam=<yaw>,<pitch>,<zoom>,<x>,<y>,<z>,<dist>` (the house's `camText`, read back with `camOf`; dist 0: the view's own). Alone at `http://127.0.0.1:8293/?key=<world>` the keys live in its own address; framed by the hub, `view` and `cam` are the shared state of a before and an after, so both sides switch tab and move together. The page posts them at most every 40 ms, on his moves only. `thumb=again` makes its thumbnail again.
- The thumbnail: the first view of a world drawn at the default camera (the viewer's `onDrawn`, after 60 frames for a splat, whose worker sorts first) is sent as a 640 px wide webp to `POST api/thumb/<name>`, kept as `thumb.webp` in the world's folder, when the world has none. A version posts it with `--image .comfy-ts/worlds/<name>/thumb.webp` beside `--after`.
- Everything is RELATIVE (`./` assets, `api/worlds`, `worlds/<name>/<file>?v=<stamp>`): the hub's page proxy serves it again on its own origin. The server bundles `web/` with `Bun.build({ publicPath: './' })` in memory, rebuilt when a file of `web/` moved; a world file is served `immutable` under its size and mtime stamp, since one weighs 60 to 80 MB.
- The thread kind: `world-explorer.shipkit.ts` (the process), `world-page.shipkit.ts` (the page `world`, `gl: true`), `world-kind.shipkit.ts` (the `review({ kinds: { world } })` unit, `view: { page: 'world' }`, `diff: { draw: 'views' }`). A version: `sk thread post world:<name> --title … --what … --after state.json` with the state `{ "name": "<name>", "files": ["panorama.png", …] }`.
- A splat's camera fov is the server's `splatFov` (read from the ply), handed to the viewer as `load({ space: 'splat', url, fov })`.

- The hub frames the page in one of three ways, read from its `mode` key: `thumb` for the still the hub shoots after a post (the scene alone, no bar, no hint), `lightbox` for the full window view the hub opens on a click (no full screen button of its own, the hub closes it), none when it is framed inline or opened alone (the F key and the full screen button).
- A version's state: `bun examples/world-explorer/world-state.ts <name> [--card]` writes `.comfy-ts/worlds/<name>/state.json` (`{ json: { name, files }, views, card? }`, `views` one `{ id, label }` per view: the hub draws one still per view with its label under it and switches between them with its gallery, so the page framed in a thread shows no tabs and draws the view its `view` key names; alone it keeps its tabs) and prints its path; post it with `sk thread post world:<name> --after <path> --image .comfy-ts/worlds/<name>/thumb.webp`. The card (title, the views as chips, the mesh and splat sizes) is the line the hub draws under the still.

## The shared cloud host helper

`examples/comfy-cloud/cloudHost.ts` (plain `.ts`: the TUI scans only `*.cflow.ts`, so it never lists the helper as a workflow). Every cloud example imports it RELATIVELY (`./cloudHost.ts` — examples are outside src/, the absolute-src rule does not apply; everything else imports from `'comfy-ts'`):

- `cloudHost()` → registers/returns THE `comfy-cloud` host (url `https://cloud.comfy.org`, `sdkAutoWrite: false` so live connects never shadow the committed catalog) and awaits `loadSchemaFromCache()` — offline import, lazy ws connect on first `run()`. The registry dedupes by id, so 20 examples importing the helper share ONE host instance.
- `cloudApiKey()` → `process.env.COMFY_CLOUD_API_KEY` or undefined. Never throws.
- `requireCloudKey()` → the key or ONE loud error naming the env var — called FIRST in every standalone `import.meta.main` block.

## API key on a keyless machine (decided)

Import-safe, loud at run:

- The helper NEVER throws (or warns) at import. On a keyless machine every cloud example still loads: the TUI shows a clean tree, zero red rows. (This replaced example 05's original throw-at-import, which would have painted one red ✗ per zoo file.)
- Standalone runs fail FAST and clear: `requireCloudKey()` names `COMFY_CLOUD_API_KEY` before anything connects.
- A TUI run without a key fails with the library's single typed `ComfyHostAuthError` ("401 … host requires authentication, no apiKey configured") in the exec error line — one notice per attempted run, never a wall of red.
- The key VALUE never appears in any tracked file (banned-keywords hook enforces the shape). Examples read ONLY `COMFY_CLOUD_API_KEY`; wherever the value is kept locally, it stays untracked.

## The file skeleton

```ts
// <family> <mode> on Comfy Cloud — <one line: what model / what it does>
// source template: <template name>.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/<family>-<mode>.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const <family><Mode> = host.defineWorkflow({
   id: '<family>-<mode>',
   vars: { … per-mode conventions below … },
   build: (b, vars) => { … mirrors the source template's api.json, simplified … },
})

export default <family><Mode>

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) <family><Mode>.vars.prompt.set(process.argv[2])
   if (process.argv[3]) <family><Mode>.vars.seed.set(Number(process.argv[3]))
   const execution = await <family><Mode>.run({ log: true, save: { prefix: 'comfy-ts-zoo/<family>-<mode>' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
```

Deviations from the skeleton, both deliberate:

- i2i/i2v files take `argv[2] = image path` and `argv[3] = prompt` (the image IS the primary input there); each header comment documents its own order.
- audio outputs come back as `execution.audios` (downloaded, saved locally when `save:` is on); the zoo's audio examples predate that and still print the host-side line. video modes (SaveVideo) have no downloadable output: their standalone block prints the honest completion line instead (`🟢 <status>: video saved on the host under comfy-ts-zoo/<name>`), never a silent success.

- Header comment: 2-4 lines — family+mode+model, the SOURCE TEMPLATE name, the key requirement, the run command. Nothing else.
- ONE workflow per file, `export const` + `export default`, id = `<family>-<mode>` (matches the basename).
- IMAGE examples save via `b.SaveImageWebsocket({ images })` — never `SaveImage` (examples leave NO trace on the server; architecture.md item 14 owns the mechanics). The grouping string that used to be the server-side `filename_prefix` moves to the LOCAL save prefix: standalone blocks pass `save: { prefix: 'comfy-ts-zoo/<family>-<mode>' }` (rvion examples: `comfy-ts-example/<id>`) so opt-in saves land in a local subfolder under `.comfy-ts/outputs/`. Not a var — outputs group per example, var panels stay signal-only.
- VIDEO/AUDIO examples keep their server-side savers (`SaveVideo`, `SaveAudioMP3`) with the hardcoded `comfy-ts-zoo/<name>` filename_prefix — upstream ships no websocket variant for them; each header comment states that outputs persist on the host.
- Build code mirrors the source template's CONVERTED api.json (see verification bar), simplified: drop UI scaffolding (Primitive*, ComfySwitchNode, PreviewAny, Note, math/resolution helper nodes, empty lora chains); keep every model-defining node.

## Vars conventions per mode

Common to ALL: `seed: v.seed(…)` (auto-advance after every run), `prompt: v.prompt(…)` — ONE prompt var, `- ` lines are the negative prompt; the build wires `vars.prompt.positive` and, when the graph has a negative branch, `vars.prompt.negative` (empty negative on turbo/distilled models → `ConditioningZeroOut`, like example 04). Never a separate `negative` text var.

| mode | vars (on top of prompt+seed)                                        |
| ---- | ------------------------------------------------------------------- |
| t2i  | `steps: v.int`, `cfg: v.float` (when the model uses cfg), `size: v.size` (free-sized latents only — fixed-res models hardcode) |
| i2i  | `image: v.image(exampleImagePath('<subject>_<WxH>.jpg'))` (bundled default, see "Bundled input images"; the var is CAPTURED in a module const so the build calls `image.absPath()` — architecture.md owns the pattern, and a build LOCAL must never be named `image`, TDZ shadow). Upload via async build + `MediaImage.loadInWorkflow_viaLoadImageNode(wf)`. Plus `steps`, `denoise: v.float` when the template exposes it |
| t2v  | `steps`, `cfg` (when used), `size` (when free), `length: v.int` (frames), `fps: v.int` (wired to CreateVideo/SaveVideo) |
| i2v  | `image` (as i2i), `length`, `fps`, `steps`                          |
| t2a  | `seconds: v.float`, `steps` (tags/lyrics ride in `prompt`: when the encode node splits them — ace-step — the FIRST prompt line is the tags, the remaining lines are the lyrics, split at build time) |

Model-specific extras (shift, guidance, …) are allowed when the template exposes them as top-level widgets, kept to what a user would actually tweak.

## Bundled input images (`examples/images/`, decided 2026-07-30)

i2i/i2v examples must run OUT OF THE BOX from node_modules — the input image ships in the tarball (`package.json files` already carries `examples`). Total budget: under ~1.5 MB for the whole folder.

- Naming: `<subject>_<W>x<H>.jpg` — the subject is what the photo honestly shows, the size is EXACT (the sketch: `bear_1024x1024.png` style; we ship jpg, not png — a 1024² photographic png alone would blow the budget; flagged deviation, the naming style is his).
- The set (one per common size): `<subject>_512x512.jpg`, `<subject>_768x768.jpg`, `<subject>_1024x1024.jpg`, one wide `<subject>_1344x768.jpg`, one tall `<subject>_768x1344.jpg`, plus a `<subject>_200x300.jpg` example. Known-good picsum id: 237 (the black dog) → `dog_512x512.jpg`; other subjects are named after eyeballing the fetched image (data labeling, not look-and-feel self-verification).
- Source & license: picsum.photos serves Unsplash-sourced photos, free to use. Every image's picsum id + author (from `https://picsum.photos/id/<id>/info`) is recorded in the manifest INSIDE `scripts/fetch-example-images.ts` — the script IS the manifest, one source of truth.
- `scripts/fetch-example-images.ts` (package script `examples:images`): manifest rows `{ name, id, width, height }`, fetches `https://picsum.photos/id/<id>/<w>/<h>`, re-encodes via sharp to jpeg (quality ~80, metadata stripped) for weight control, VERIFIES the decoded dimensions match the filename (loud throw on mismatch), writes to `examples/images/`. Regeneration is DELIBERATE: images are committed DATA, the script only runs by hand.
- Resolution from the package: `exampleImagePath('dog_512x512.jpg')`, a public helper exported from `'comfy-ts'` (home: `src/exampleAssets.ts` — it is lib surface, not TUI surface) reusing the `bundledExamplesDir` walk (import.meta-based, never cwd — works from a consumer's `node_modules/comfy-ts/` and from this repo). Missing file or pruned examples folder = loud throw naming the path.
- Convention: every i2i/i2v example (zoo AND example 02) defaults its `v.image` var to the bundled image whose size is CLOSEST to the source template's native input resolution. Example 02 migrates: `v.image` replaces its `v.text` + generated-placeholder stopgap (empty now throws, see architecture.md).

## Verification bar (every zoo example, before it lands)

Builders NEVER run workflows live — cloud runs cost real money. The bar is fully offline:

1. `bun run ci:local` green — the file typechecks against the committed `examples/comfy-cloud/sdk.d.ts` (model names are union-checked: a model absent from the cloud catalog is a TYPE error, that is the availability gate).
2. Built against the cloud schema cache (`.comfy-ts/hosts/comfy-cloud/object_info.json`), `workflow.problems` is EMPTY.
3. The emitted prompt's `class_type` set covers the MODEL-DEFINING nodes of the source template's converted api.json (convert it via `parseWorkflowJson` + `convertLiteGraphToPrompt` against the cloud object_info; `tests/zoo-build.test.ts` is the committed recipe). Allowed drops: the UI scaffolding list above + sampler-graph simplification (SamplerCustomAdvanced pipelines may collapse to KSampler ONLY when sampler/scheduler/cfg semantics survive). Loaders, encode nodes, latent nodes, model-sampling nodes, save nodes must match.
4. At most ONE live cloud run exists for the whole zoo effort — a cheap small t2i in the final Verify phase, never by builders.

Machine enforcement (2026-07-30, the final sweep): bars 1-2 are tests, not promises. `tests/examples-offline.test.ts` auto-enrolls EVERY `examples/**/*.cflow.ts` (headless import, keyless env, cacheless consumer cwd — a new zoo file is covered the moment it exists); `tests/zoo-build.test.ts` builds every zoo module with the uploader stubbed (never a live call) and asserts `workflow.problems` EMPTY against the machine-local cloud schema cache. That cache (`.comfy-ts/hosts/comfy-cloud/object_info.json`) is gitignored, so the build sweep `describe.skipIf`s loudly on a fresh clone/CI; `bun run gen:sdk:cloud` (or any cloud connect) restores it.

## Build matrix (family × mode ← source template)

Cross of `.comfy-ts/templates/workflow-templates/index.json` (779 files, non-API templates only) with the committed cloud catalog: every row below has ALL its model files in the sdk unions AND converts clean against the cloud object_info (swept 2026-07-30; the committed machine bar is `tests/zoo-build.test.ts`, the original sweep recipe lived in gitignored tmp/). Delta sweep 2026-09-23: the 96 templates dated after 2026-07-30 against a regenerated catalog added ltx25 (t2v, i2v) and minimax-music3 (t2a); the new skips are listed below. ltx25-i2v resizes its start image with `ImageScaleToMaxDimension` where the template uses `ResizeImageMaskNode` (same lanczos, longest side 1536): that node's `COMFY_MATCHTYPE_V3` slots are typed as the literal tag, so its output cannot feed an IMAGE input yet.

Wave 1 — core families:

| family        | t2i                          | i2i                                       | t2v                              | i2v                              | t2a                        |
| ------------- | ---------------------------- | ----------------------------------------- | -------------------------------- | -------------------------------- | -------------------------- |
| sd15          | `default` (= example 05)     |                                           |                                  |                                  |                            |
| sdxl          | `sdxl_simple_example`        |                                           |                                  |                                  |                            |
| sd35          | `sd3.5_simple_example`       |                                           |                                  |                                  |                            |
| flux1         | `flux_dev_checkpoint_example`| `flux_kontext_dev_basic`                  |                                  |                                  |                            |
| flux2         | `image_flux2_klein_text_to_image` | `image_flux2_klein_image_edit_4b_distilled` |                            |                                  |                            |
| qwen-image    | `image_qwen_image`           | `image_qwen_image_edit_2511`              |                                  |                                  |                            |
| z-image       | `image_z_image_turbo`        |                                           |                                  |                                  |                            |
| chroma        | `image_chroma_text_to_image` |                                           |                                  |                                  |                            |
| hidream       | `hidream_i1_fast`            | `hidream_e1_1`                            |                                  |                                  |                            |
| omnigen2      | `image_omnigen2_t2i`         | `image_omnigen2_image_edit`               |                                  |                                  |                            |
| kandinsky5    | `image_kandinsky5_t2i`       |                                           | `video_kandinsky5_t2v`           | `video_kandinsky5_i2v`           |                            |
| wan21         |                              |                                           | `text_to_video_wan`              | `image_to_video_wan`             |                            |
| wan22         |                              |                                           | `video_wan2_2_14B_t2v`           | `video_wan2_2_14B_i2v`           |                            |
| ltxv          |                              |                                           | `ltxv_text_to_video`             | `ltxv_image_to_video`            |                            |
| ltx25         |                              |                                           | `video_ltx2_5_t2v` (video + generated audio) | `video_ltx2_5_i2v`   |                            |
| hunyuan-video |                              |                                           | `video_hunyuan_video_1.5_720p_t2v` | `video_hunyuan_video_1.5_720p_i2v` |                        |
| svd           |                              |                                           |                                  | `txt_to_image_to_video` (simplify to LoadImage→SVD) |         |
| ace-step      |                              |                                           |                                  |                                  | `audio_ace_step_1_t2a_song` |
| minimax-music3 |                             |                                           |                                  |                                  | `audio_minimax_music_3`    |
| stable-audio  |                              |                                           |                                  |                                  | `audio_stable_audio_example` |

Wave 2 — long tail (same bar, lower priority):

| family     | mode | template                          |
| ---------- | ---- | --------------------------------- |
| capybara   | t2i  | `Image_capybara_v0_1_text_to_image` |
| capybara   | i2i  | `Image_capybara_v0_1_image_edit`  |
| capybara   | i2v  | `video_capybara_v0_1_image_to_video` |
| krea2      | t2i  | `image_krea2_turbo_t2i` (cloud twin of example 04) |
| lens       | t2i  | `image_lens_turbo_t2i`            |
| ernie      | t2i  | `image_ernie_image_turbo`         |
| longcat    | t2i  | `image_longcat_text_to_image`     |
| longcat    | i2i  | `image_longcat_image_edit`        |
| boogu      | i2i  | `image_boogu_image_0_1_edit`      |
| ovis       | t2i  | `image_ovis_text_to_image`        |
| pixeldit   | t2i  | `image_pixeldit_t2i`              |
| anima      | t2i  | `image_anima_preview`             |
| newbie     | t2i  | `image_newbieimage_exp0_1-t2i`    |
| firered    | i2i  | `image_firered_image_edit1_1`     |
| ideogram4  | t2i  | `image_ideogram4_t2i`             |
| wan22-5b   | t2v  | `video_wan2_2_5B_ti2v` (ti2v: doubles as i2v with a start image) |
| chatterbox | t2a  | `audio-chatterbox_tts_multilingual` (swept 2026-07-30: converts clean; the template's LoadAudio voice-clone branch is dropped — its asset is absent from the cloud LoadAudio union and `audio_prompt` is optional, default voice fallback) |

Wave 3 — the regenerated catalog: new families (files the earlier sweeps found absent, or templates no sweep took yet), new modes of Wave 2 families, and the model variants the blueprint corpora name (a suffixed file, written `template → file`; a same-graph variant is a `model` choice instead):

| family     | mode | template                          |
| ---------- | ---- | --------------------------------- |
| ace-step15 | t2a  | `audio_ace_step_1_5_split` (the `model` choice adds `audio_ace_step1_5_xl_{turbo,sft,base}`, each with its template's steps, cfg, top_p and 4b lm encoder; local twin: rvion 13) |
| anima      | t2i  | `image_anima_base_v1` → `anima-t2i-base` (euler, 30 steps, cfg 4; the off turbo lora branch drops) |
| boogu      | t2i  | `image_boogu_image_0_1_turbo_t2i` (new mode of the Wave 2 boogu family) |
| chronoedit | i2i  | `image_chrono_edit_14B` (the template's default: distill lora off, 20 steps cfg 4; the lora branch and its step and cfg switches drop) |
| ernie      | t2i  | `image_ernie_image` → `ernie-t2i-base` (undistilled: 20 steps, cfg 4; the template's prompt enhancer, on by default, is the `enhance` toggle, its chat turn assembled in the build in place of three StringReplace) |
| flux1      | t2i  | `flux1_krea_dev` → `flux1-t2i-krea` (same graph as flux1-t2i, the Krea Dev fp8 weights) |
| flux2      | t2i  | `image_flux2_text_to_image` → `flux2-t2i-dev` (FLUX.2 Dev: BasicGuider + FluxGuidance 4, mistral 3 small encoder; the off turbo lora branch drops) |
| flux2      | i2i  | `image_flux2` → `flux2-i2i-dev` (FLUX.2 Dev edit: the reference at ~1MP through ReferenceLatent on the guided positive; the off turbo lora branch drops) |
| hidream-o1 | t2i  | `image_hidream_o1` (the template's default state: its reference-image branch and its gemma prompt rewrite are switched off and drop; the trained sizes ride in the size var comment) |
| hidream-o1 | i2i  | `image_hidream_o1_dev` (the dev template defaults to its reference branch; the latent size comes from the reference image's metadata floored to 32 in the build, in place of GetImageSize + two ComfyMathExpression) |
| krea2      | i2i  | `image_krea2_turbo_int8_image_style_reference` (new mode of the Wave 2 krea2 family: the input is a STYLE reference through the style lora; the off-by-default prompt rewrite drops) |
| ltx2       | t2v  | `video_ltx2_t2v` (dev fp8 at cfg 4 over LTXVScheduler, then the distilled lora refine at x2; both passes share the seed noise where the template fixes the refine seed; the EmptyImage size helpers become the size var) |
| ltx2       | i2v  | `video_ltx2_i2v` (same two passes, the start image pinned in both; the template's two ResizeImageMaskNode become ImageScale center crop + ImageScaleToMaxDimension 1536 area, the COMFY_MATCHTYPE_V3 typing gap ltx25-i2v describes) |
| ltx23      | t2v  | `video_ltx2_3_t2v` (dev fp8 + distilled lora at 0.5, cfg 1 on both passes; the template's bypassed LTXVImgToVideoInplace chain on an EmptyImage is a no-op in t2v and drops; its prompt enhancer, on by default, is the `enhance` toggle) |
| ltx23      | i2v  | `video_ltx2_3_i2v` (start image at strength 0.7 then 1; same resize stand ins as ltx2-i2v; the enhancer is off in this template, so `enhance` defaults off) |
| mage-flow  | t2i  | `image_mage_flow_t2i_int8`        |
| mage-flow  | t2i  | `image_mage_flow_turbo_t2i_int8` → `mage-flow-t2i-turbo` (4 steps, cfg 1) |
| mage-flow  | i2i  | `image_mage_flow_edit_int8` (width and height 0 = the reference's size, in place of the template's GetImageSize switches) |
| mage-flow  | i2i  | `image_mage_flow_edit_turbo_int8` → `mage-flow-i2i-turbo` (4 steps, cfg 1, nearest-exact reference scaling) |
| minimax-h3 | t2i  | `image_minimax_h3_t2i` (the still-image template loads the fp16 video vae, which the cloud has; the H3 video templates stay skipped on the int8 vae; the off-by-default turbo lora branch drops) |
| netayume   | t2i  | `image_netayume_lumina_t2i` (the two fixed system prompt prefixes join the prompt in the build, in place of the template's StringConcatenate nodes) |
| qwen-image | t2i  | `image_qwen_Image_2512` → `qwen-image-t2i-2512` (50 steps, cfg 4; the off Lightning lora branch drops) |
| qwen-image | i2i  | `image_qwen_image_edit_2509` → `qwen-image-i2i-2509` (the template's Lightning lora is ON by default: 4 steps, cfg 1, shift 3; no reference latent method in 2509) |
| stable-audio3 | t2a | `audio_stable_audio_3_medium` (the `model` choice adds `audio_stable_audio_3_medium_base`: 50 steps at cfg 7; the reprompt branch is on in the template and is the `reprompt` toggle; its system prompts come from `examples/rvion/stableAudio3Prompts.ts`, shared with rvion 12; the string assembly nodes become that helper) |
| z-image    | t2i  | `image_z_image` → `z-image-t2i-base` (undistilled: 25 steps, cfg 4, a real negative) |

## Skipped (exhaustive, with reasons)

- **Every `api_*` family** — API nodes proxy external providers, billed per call on top of compute; not the local-model zoo: Nano Banana (all), Google/ Gemini (all), GPT-Image/OpenAI/ChatGPT, Claude, Grok, Kimi, OpenRouter, Kling (2.6/3.0/O1/O3), Seedance (1.0/1.5/2.0), Seedream (4.0/4.5/5.0), Seed 2.0, Seed Audio, ByteDance, Vidu (Q1/Q2/Q3), Veo, Luma (+UNI-1), Runway, PixVerse, MiniMax, Wan2.5/2.6/2.7, Recraft, Reve, Magnific, Topaz, HitPaw, BRIA, ElevenLabs, HeyGen, Sync 3, Tripo (+P1), Rodin, Meshy, SwitchX, HappyHorse, WaveSpeed, Sonilo, Quiver, Reimagine, FlashVSR, Real-ESRGAN, ideogram API rows.
- **flux2 klein 9b fp8 / 9b-kv fp8** — those variants' files absent (family still covered via other variants).
- **3D families** (Hunyuan3D local, MoGe, TripoSplat) — output mode outside t2i/i2i/t2v/i2v.
- **Utility/control families** (SAM3, DWPose, Depth Anything v2/v3, SDPose-OOD, BiRefNet, Mediapipe, LivePortrait, FILM, RIFE, SUPIR, SeedVR2, PiD, Lotus depth) — not generation modes.
- **Specialty video variants** (wan2.2 Animate, Wan2.1 VACE/InfiniteTalk/ SCAIL/ATI/wanmove/causal-forcing, HuMo, animate-diff/IP Adapter, Bernini-R, VOID, SCAIL-2) — control-driven or niche variants of covered families; candidates for later waves, not zoo core.
- **LLM category, Gemma 4, Qwen 3.0/3.5 helper templates** — text generation, API-backed.
- **`None` model rows** — node-basics teaching templates, no model family.
- **Delta sweep 2026-09-23**:
  - **MiniMax H3** (t2v, i2v, r2v, continuation, multiframe reference, fun controlnet, FastVideo fasth3) — `minimax_h3_video_vae_int8_convrot.safetensors` absent from the cloud catalog (fasth3 also misses its unet).
  - **YuE2** (text2music, music cover) — `yue2_3b_int8_convrot.safetensors` absent from the cloud catalog.
  - **Qwen Image 2.1** (t2i, edit, background removal) — all three model files absent from the cloud catalog; covered locally by rvion 08/09 instead.
  - **LTX-2.5 flf2v** — converts clean, but first-last-frame is outside the closed mode vocabulary.
  - **Wan Animate 2** (+ distilled) — control-driven variant, same class as wan2.2 Animate.
  - **Marigold v2** (depth, albedo, normals), **MoGe 3**, **SAM 3D Body**, **Pixal3D / TRELLIS.2** — utility or 3D output.
  - every new `api_*` row (Qwen Image 3.0 Pro, Seedance 2.5, Flux.3 Video, Wan3.0, Gemini Omni 1.1, GPT Image 2.5, Mai Image 2.6, Muse Image, HY Image 3.5, Fish Audio, Tripo P2, Meshy 7, …).
- **Use-case/`template_*`/`templates-*` rows** — recipes on top of covered families (multiangle, relight, storyboard, …), not new families.
- **Catalog regeneration sweep** (the corpus Wave 3 was cut from):
  - **Model files absent from the cloud catalog**: FLUX.3 Klein (t2i, edit, distilled), Fibo 2.0 edit (dev, turbo), MOSS-Image (t2i, base, edit, color depth control), Ming Image 0.1 (t2i, edit), MiniMax H3 Image (t2i, edit), P-H3-Image (t2i, edit), Qwen Image 2.1 turbo (t2i, edit), JoyAI Image Edit, Pika H3 Flex (t2v, ref2va, fl2va), FastH3 omniref r2v, LTX-2.5 dfr i2v (its pixel upscaler ic-lora), Idol gaussian splat, RelayVSR x2/x4, WeVisOne-VL segmentation, the Qwen Image Edit 2511 action lora.
  - **Converter**: templates with a `CreateBoundingBoxes` or `BuildJsonPromptIdeogram` node (custom widget input types `BOUNDING_BOXES`, `COLORS`) do not convert yet: FLUX.3 Klein, MOSS-Image bboxes, Ming Image edit, and three ideogram API rows.
  - **Variants not taken** (same family and mode as a file above, same graph or a quantization of it): ACE-Step 1.5 checkpoint and split 4b, ACE-Step 1 instrumentals, Chatterbox mono and dialog, Chroma1 Radiance, Flux.1 dev full and schnell (both), Flux.2 Klein 9b t2i and 4b/9b base edits, Flux.2 dev fp8, HiDream I1 dev/full and E1 full, Hunyuan Video 1 t2v, Lens base, LTX-2 distilled t2v/i2v and i2v lora, Qwen-Image 2512 2-step lora, Qwen-Image-Edit (first release), SDXL simple/refiner/turbo, Wan2.1 alpha t2v, and the int8 twins of boogu edit, ideogram4, krea2, qwen-image-edit 2511, z-image and z-image turbo.
- **Blueprints** (`comfyui-blueprints`, `workflow-templates-blueprints`): subgraph libraries that name the same model families as the templates, so the zoo covers them through the family rows above. The generation blueprints whose family the cloud runs map to a row (their named variants, Z-Image Base, Qwen-Image 2512, Flux.2 Dev, Flux.1 Krea Dev, Anima Base 1.0, Ernie Image, Mage-Flow Turbo, Qwen 2509, Krea-2 style reference, Stable Audio 3 Medium Base, got their own file or choice); the rest are utility, control, 3D, captioning, or cloud-absent (MiniMax H3 i2v, YuE2, JoyAI).

Refetch corpus: `bun run templates:fetch`. Regenerate catalog: `bun run gen:sdk:cloud` (privacy rule in architecture.md applies).
