# The example zoo

`examples/` is the FIRST thing Rémi (and any consumer) reads and playtests —
the examples ARE the review surface. This doc owns their shape: layout, the
shared cloud helper, the per-mode vars conventions, the key story, and the
verification bar. The build matrix at the bottom is the ground truth for which
zoo files exist and which official template each one mirrors.

## Layout

```
examples/
   01-txt2img.cflow.ts           didactic sequence, local host (windows-1)
   02-img2img-upload.cflow.ts
   03-export-workflow-json.cflow.ts
   04-krea2-turbo-t2i.cflow.ts
   05-comfy-cloud.cflow.ts       cloud intro = the zoo's sd15/t2i row (reference impl)
   comfy-cloud/
      sdk.d.ts                   committed cloud catalog (gen:sdk:cloud)
      cloudHost.ts               shared host helper — NOT .cflow, invisible to the TUI
      <family>-<mode>.cflow.ts   the zoo, flat, family-prefixed
   README.md                     consumer-facing quick start
```

- Zoo files are FLAT under `examples/comfy-cloud/`, named `<family>-<mode>`
  (`flux1-t2i.cflow.ts`, `wan22-i2v.cflow.ts`). No per-family subfolders:
  drafts are keyed by MODULE BASENAME (`.comfy-ts/drafts/<basename>/`), so
  basenames must be unique repo-wide — the family prefix guarantees it, and
  alphabetical sort groups a family's modes together in the TUI tree anyway.
- Mode vocabulary (closed): `t2i`, `i2i`, `t2v`, `i2v`, `t2a`.
- Family keys are short lowercase slugs (`sd15`, `sdxl`, `sd35`, `flux1`,
  `flux2`, `qwen-image`, `z-image`, `wan21`, `wan22`, `ltxv`, …) — see matrix.
- Variant suffix only when a family gets TWO files for the same mode
  (`flux2-t2i-dev` next to `flux2-t2i`); the unsuffixed name is the
  recommended default.

## The shared cloud host helper

`examples/comfy-cloud/cloudHost.ts` (plain `.ts`: the TUI scans only
`*.cflow.ts`, so it never lists the helper as a workflow). Every cloud example
imports it RELATIVELY (`./cloudHost.ts` — examples are outside src/, the
absolute-src rule does not apply; everything else imports from `'comfy-ts'`):

- `cloudHost()` → registers/returns THE `comfy-cloud` host (url
  `https://cloud.comfy.org`, `sdkAutoWrite: false` so live connects never
  shadow the committed catalog) and awaits `loadSchemaFromCache()` — offline
  import, lazy ws connect on first `run()`. The registry dedupes by id, so 20
  examples importing the helper share ONE host instance.
- `cloudApiKey()` → `process.env.COMFY_CLOUD_API_KEY` or undefined. Never
  throws.
- `requireCloudKey()` → the key or ONE loud error naming the env var — called
  FIRST in every standalone `import.meta.main` block.

## API key on a keyless machine (decided)

Import-safe, loud at run:

- The helper NEVER throws (or warns) at import. On a keyless machine every
  cloud example still loads: the TUI shows a clean tree, zero red rows. (This
  replaced example 05's original throw-at-import, which would have painted one
  red ✗ per zoo file.)
- Standalone runs fail FAST and clear: `requireCloudKey()` names
  `COMFY_CLOUD_API_KEY` before anything connects.
- A TUI run without a key fails with the library's single typed
  `ComfyHostAuthError` ("401 … host requires authentication, no apiKey
  configured") in the exec error line — one notice per attempted run, never a
  wall of red.
- The key VALUE never appears in any tracked file (banned-keywords hook
  enforces the shape). On this machine: `rv-secret get rv/comfy-cloud/api-key`
  or `.rv-private/comfy-cloud-api-key` (both untracked); examples read ONLY
  the env var.

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
   const execution = await <family><Mode>.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
```

- Header comment: 2-4 lines — family+mode+model, the SOURCE TEMPLATE name,
  the key requirement, the run command. Nothing else.
- ONE workflow per file, `export const` + `export default`, id =
  `<family>-<mode>` (matches the basename).
- `filename_prefix` is HARDCODED `comfy-ts-zoo/<family>-<mode>` — not a var
  (outputs group per example, var panels stay signal-only). The numbered
  didactic examples keep their own prefixes.
- Build code mirrors the source template's CONVERTED api.json (see
  verification bar), simplified: drop UI scaffolding (Primitive*,
  ComfySwitchNode, PreviewAny, Note, math/resolution helper nodes, empty lora
  chains); keep every model-defining node.

## Vars conventions per mode

Common to ALL: `seed: v.seed(…)` (auto-advance after every run), `prompt:
v.prompt(…)` — ONE prompt var, `- ` lines are the negative prompt; the build
wires `vars.prompt.positive` and, when the graph has a negative branch,
`vars.prompt.negative` (empty negative on turbo/distilled models →
`ConditioningZeroOut`, like example 04). Never a separate `negative` text var.

| mode | vars (on top of prompt+seed)                                        |
| ---- | ------------------------------------------------------------------- |
| t2i  | `steps: v.int`, `cfg: v.float` (when the model uses cfg), `size: v.size` (free-sized latents only — fixed-res models hardcode) |
| i2i  | `image: v.text('', 'image path')` (empty → generated placeholder, like example 02), `steps`, `denoise: v.float` when the template exposes it. Upload via async build + `MediaImage.loadInWorkflow_viaLoadImageNode(wf)` |
| t2v  | `steps`, `cfg` (when used), `size` (when free), `length: v.int` (frames), `fps: v.int` (wired to CreateVideo/SaveVideo) |
| i2v  | `image` (as i2i), `length`, `fps`, `steps`                          |
| t2a  | `seconds: v.float`, `steps` (tags/lyrics ride in `prompt`)          |

Model-specific extras (shift, guidance, …) are allowed when the template
exposes them as top-level widgets, kept to what a user would actually tweak.

## Verification bar (every zoo example, before it lands)

Builders NEVER run workflows live — cloud runs cost real money. The bar is
fully offline:

1. `bun run ci:local` green — the file typechecks against the committed
   `examples/comfy-cloud/sdk.d.ts` (model names are union-checked: a model
   absent from the cloud catalog is a TYPE error, that is the availability
   gate).
2. Built against the cloud schema cache
   (`.comfy-ts/hosts/comfy-cloud/object_info.json`), `workflow.problems`
   is EMPTY.
3. The emitted prompt's `class_type` set covers the MODEL-DEFINING nodes of
   the source template's converted api.json (convert it via
   `parseWorkflowJson` + `convertLiteGraphToPrompt` against the cloud
   object_info — `tmp/sweep-cloud.ts` shows the recipe). Allowed drops: the
   UI scaffolding list above + sampler-graph simplification
   (SamplerCustomAdvanced pipelines may collapse to KSampler ONLY when
   sampler/scheduler/cfg semantics survive). Loaders, encode nodes, latent
   nodes, model-sampling nodes, save nodes must match.
4. At most ONE live cloud run exists for the whole zoo effort — a cheap small
   t2i in the final Verify phase, never by builders.

## Build matrix (family × mode ← source template)

Cross of `.comfy-ts/templates/workflow-templates/index.json` (779 files,
non-API templates only) with the committed cloud catalog: every row below has
ALL its model files in the sdk unions AND converts clean against the cloud
object_info (swept 2026-07-30, `tmp/sweep-cloud.ts`).

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
| hunyuan-video |                              |                                           | `video_hunyuan_video_1.5_720p_t2v` | `video_hunyuan_video_1.5_720p_i2v` |                        |
| svd           |                              |                                           |                                  | `txt_to_image_to_video` (simplify to LoadImage→SVD) |         |
| ace-step      |                              |                                           |                                  |                                  | `audio_ace_step_1_t2a_song` |
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
| chatterbox | t2a  | `audio-chatterbox_tts_multilingual` (models present; convert UNSWEPT — sweep before building) |

## Skipped (exhaustive, with reasons)

- **Every `api_*` family** — API nodes proxy external providers, billed per
  call on top of compute; not the local-model zoo: Nano Banana (all), Google/
  Gemini (all), GPT-Image/OpenAI/ChatGPT, Claude, Grok, Kimi, OpenRouter,
  Kling (2.6/3.0/O1/O3), Seedance (1.0/1.5/2.0), Seedream (4.0/4.5/5.0),
  Seed 2.0, Seed Audio, ByteDance, Vidu (Q1/Q2/Q3), Veo, Luma (+UNI-1),
  Runway, PixVerse, MiniMax, Wan2.5/2.6/2.7, Recraft, Reve, Magnific, Topaz,
  HitPaw, BRIA, ElevenLabs, HeyGen, Sync 3, Tripo (+P1), Rodin, Meshy,
  SwitchX, HappyHorse, WaveSpeed, Sonilo, Quiver, Reimagine, FlashVSR,
  Real-ESRGAN, ideogram API rows.
- **ltx2 / ltx2.3** (8 local templates) — `ltx-av-step-1751000_vocoder_24K.safetensors`
  absent from the cloud catalog unions.
- **mage-flow** (4 templates) — every model file absent from the cloud catalog.
- **flux2 klein 9b fp8 / 9b-kv fp8, anima base v1** — those variants' files
  absent (families still covered via other variants).
- **3D families** (Hunyuan3D local, MoGe, TripoSplat) — output mode outside
  t2i/i2i/t2v/i2v.
- **Utility/control families** (SAM3, DWPose, Depth Anything v2/v3,
  SDPose-OOD, BiRefNet, Mediapipe, LivePortrait, FILM, RIFE, SUPIR, SeedVR2,
  PiD, Lotus depth) — not generation modes.
- **Specialty video variants** (wan2.2 Animate, Wan2.1 VACE/InfiniteTalk/
  SCAIL/ATI/wanmove/causal-forcing, HuMo, animate-diff/IP Adapter, Bernini-R,
  VOID, SCAIL-2) — control-driven or niche variants of covered families;
  candidates for later waves, not zoo core.
- **LLM category, Gemma 4, Qwen 3.0/3.5 helper templates** — text generation,
  API-backed.
- **`None` model rows** — node-basics teaching templates, no model family.
- **Use-case/`template_*`/`templates-*` rows** — recipes on top of covered
  families (multiangle, relight, storyboard, …), not new families.

Refetch corpus: `bun run templates:fetch`. Regenerate catalog:
`bun run gen:sdk:cloud` (privacy rule in architecture.md applies).
