// the catalog: every depth / normal estimator the explorer knows, one ComfyUI graph each.
// an entry runs only when the host has its nodes AND its weight files (checked live, see `availability`).
// depth outputs follow one convention so the grid compares like with like: near = white.
import type { BaseNode, BaseNodeFactory, ComfyWorkflow } from 'comfy-ts'

export type HostId = 'windows-1'
type W = ComfyWorkflow<HostId>
type B = W['builder']
type Img = Comfy.Windows1.Accepts['IMAGE']

export type ModelKind = 'depth' | 'normal'

/** a weight file the graph names, and where to get it when the host lacks it */
export type WeightFile = { node: string; input: string; file: string; folder: string; url: string }

export type ModelEntry = {
   id: string
   label: string
   family: string
   year: number
   kind: ModelKind
   /** classic = pre 2023 baselines, off by default */
   tier: 'modern' | 'classic'
   blurb: string
   nodes: string[]
   /** weights the host must list; controlnet_aux nodes download theirs on first run instead */
   files: WeightFile[]
   /** the node pack downloads its weights on the first run (slow once) */
   autoDownload?: boolean
   /** the graph up to its output image; the server adds the websocket save node */
   build: (b: B, image: Img, p: { detail: number; wf: W }) => Img | BaseNode
}

const auxNodes = (name: string): string[] => [name]

/** multiple of 14 closest to `detail` (vit patch size) */
const mult14 = (n: number): number => Math.max(140, Math.round(n / 14) * 14)

const DA3_FILE: WeightFile = {
   node: 'LoadDA3Model',
   input: 'model_name',
   file: 'depth_anything_3_mono_large.safetensors',
   folder: 'geometry_estimation',
   url: 'https://huggingface.co/Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_mono_large.safetensors',
}
const MOGE_FILE: WeightFile = {
   node: 'LoadMoGeModel',
   input: 'model_name',
   file: 'moge_2_vitl_normal_fp16.safetensors',
   folder: 'geometry_estimation',
   url: 'https://huggingface.co/Comfy-Org/MoGe/resolve/main/geometry_estimation/moge_2_vitl_normal_fp16.safetensors',
}
const LOTUS_FILES: WeightFile[] = [
   {
      node: 'UNETLoader',
      input: 'unet_name',
      file: 'lotus-depth-d-v1-1.safetensors',
      folder: 'diffusion_models',
      url: 'https://huggingface.co/Comfy-Org/lotus/resolve/main/lotus-depth-d-v1-1.safetensors',
   },
   {
      node: 'VAELoader',
      input: 'vae_name',
      file: 'SD1.5\\vae-ft-mse-840000-ema-pruned.safetensors',
      folder: 'vae',
      url: 'https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors',
   },
]
const MARIGOLD_BASE = 'https://huggingface.co/Comfy-Org/marigold-v2-0/resolve/main'
const marigoldFiles = (task: 'depth_log_stage2' | 'normals'): WeightFile[] => [
   {
      node: 'UNETLoader',
      input: 'unet_name',
      file: 'qwen_image_edit_2509_int8_convrot.safetensors',
      folder: 'diffusion_models',
      url: `${MARIGOLD_BASE}/diffusion_models/qwen_image_edit_2509_int8_convrot.safetensors`,
   },
   {
      node: 'LoraLoaderModelOnly',
      input: 'lora_name',
      file: `marigold_v2_${task}.safetensors`,
      folder: 'loras',
      url: `${MARIGOLD_BASE}/loras/marigold_v2_${task}.safetensors`,
   },
   {
      node: 'VAELoader',
      input: 'vae_name',
      file: `marigold_v2_${task}_vae.safetensors`,
      folder: 'vae',
      url: `${MARIGOLD_BASE}/vae/marigold_v2_${task}_vae.safetensors`,
   },
   {
      node: 'ConditioningLoader',
      input: 'conditioning',
      file: `marigold_v2_${task === 'normals' ? 'normals' : 'depth'}_conditioning.safetensors`,
      folder: 'embeddings',
      url: `${MARIGOLD_BASE}/embeddings/marigold_v2_${task === 'normals' ? 'normals' : 'depth'}_conditioning.safetensors`,
   },
]

/** v⁴ on the float tensor, before the 8 bit save. DA3 renders LINEAR depth (near = 1), where a
 * near subject fits in ~20 grey levels; the other models output disparity, which spends its range
 * near. Two exact squarings (ImageBlend multiply at factor 1) give a comparable curve. */
const pow4 = (b: B, v: Img): Img => {
   const sq = (x: Img): Img => b.ImageBlend({ image1: x, image2: x, blend_factor: 1, blend_mode: 'multiply' })
   return sq(sq(v))
}

const da3Geometry = (b: B, image: Img, detail: number) =>
   b.DA3Inference({
      da3_model: b.LoadDA3Model({ model_name: 'depth_anything_3_mono_large.safetensors', weight_dtype: 'default' }),
      image,
      resolution: mult14(detail),
      resize_method: 'upper_bound_resize',
      mode: 'mono',
   })

/** MoGe resolution_level 0..9 from the shared detail setting */
const mogeLevel = (detail: number): number => (detail <= 512 ? 5 : detail <= 768 ? 7 : 9)
const mogeGeometry = (b: B, image: Img, detail: number) =>
   b.MoGeInference({
      moge_model: b.LoadMoGeModel({ model_name: 'moge_2_vitl_normal_fp16.safetensors' }),
      image,
      resolution_level: mogeLevel(detail),
      fov_x_degrees: 0,
      batch_size: 1,
      force_projection: true,
      apply_mask: false,
      refine_steps: 0,
   })

/** a factory of the base (untyped) builder, or a loud error naming the node */
function base(wf: W, name: string): BaseNodeFactory {
   const f = wf.builderBase[name]
   if (f == null) throw new Error(`this host has no ${name} node`)
   return f
}

/** the Marigold v2 blueprint (Comfy-Org): one flow step on a qwen image edit base + a task lora.
 * built on the BASE builder: its weight names are not in the host sdk until they are downloaded */
const marigold = (wf: W, image: Img, task: 'depth_log_stage2' | 'normals'): BaseNode => {
   const [unet, lora, vaeFile, cond] = marigoldFiles(task)
   if (unet == null || lora == null || vaeFile == null || cond == null) throw new Error('marigold files table broken')
   const vae = base(wf, 'VAELoader')({ vae_name: vaeFile.file })
   const model = base(
      wf,
      'ModelSamplingAuraFlow',
   )({
      model: base(
         wf,
         'LoraLoaderModelOnly',
      )({
         model: base(wf, 'UNETLoader')({ unet_name: unet.file, weight_dtype: 'default' }),
         lora_name: lora.file,
         strength_model: 1,
      }),
      shift: 1.73,
   })
   const latent = base(
      wf,
      'SamplerCustomAdvanced',
   )({
      noise: base(wf, 'DisableNoise')({}),
      guider: base(
         wf,
         'BasicGuider',
      )({ model, conditioning: base(wf, 'ConditioningLoader')({ conditioning: cond.file }) }),
      sampler: base(wf, 'KSamplerSelect')({ sampler_name: 'euler' }),
      sigmas: base(wf, 'ManualSigmas')({ sigmas: '0.5, 0' }),
      latent_image: base(wf, 'VAEEncode')({ pixels: image, vae }),
   })
   const samples = latent.outputs.output
   if (samples == null) throw new Error('SamplerCustomAdvanced has no `output` slot on this host')
   return base(
      wf,
      'MarigoldV2PostProcess',
   )({
      image: base(wf, 'VAEDecode')({ samples, vae }),
      prediction: task === 'normals' ? 'normals' : 'depth',
   })
}

export const MODELS: ModelEntry[] = [
   // ── depth, modern ──────────────────────────────────────────────
   {
      id: 'da3-mono-large',
      label: 'Depth Anything 3',
      family: 'mono large',
      year: 2025,
      kind: 'depth',
      tier: 'modern',
      blurb: 'ByteDance, any-view geometry; the mono variant, shown on a disparity-like curve',
      nodes: ['LoadDA3Model', 'DA3Inference', 'DA3Render', 'ImageBlend'],
      files: [DA3_FILE],
      build: (b, image, p) => {
         const linear = b.DA3Render({
            da3_geometry: da3Geometry(b, image, p.detail),
            output: 'depth',
            'output.normalization': 'v2_style',
            'output.apply_sky_clip': true,
         })
         return pow4(b, linear)
      },
   },
   {
      id: 'moge2-depth',
      label: 'MoGe-2',
      family: 'ViT-L depth',
      year: 2025,
      kind: 'depth',
      tier: 'modern',
      blurb: 'Microsoft, metric point maps from one image; depth half',
      nodes: ['LoadMoGeModel', 'MoGeInference', 'MoGeRender'],
      files: [MOGE_FILE],
      build: (b, image, p) => b.MoGeRender({ moge_geometry: mogeGeometry(b, image, p.detail), output: 'depth' }),
   },
   {
      id: 'marigold2-depth',
      label: 'Marigold v2',
      family: 'depth',
      year: 2026,
      kind: 'depth',
      tier: 'modern',
      blurb: 'diffusion depth on a Qwen Image Edit base, one step (a ~20 GB base model)',
      nodes: ['UNETLoader', 'LoraLoaderModelOnly', 'ConditioningLoader', 'MarigoldV2PostProcess'],
      files: marigoldFiles('depth_log_stage2'),
      build: (_b, image, p) => marigold(p.wf, image, 'depth_log_stage2'),
   },
   {
      id: 'lotus-depth',
      label: 'Lotus',
      family: 'depth-d v1.1',
      year: 2024,
      kind: 'depth',
      tier: 'modern',
      blurb: 'diffusion depth in one step on an SD2 base (the Comfy-Org template)',
      nodes: ['UNETLoader', 'LotusConditioning', 'SetFirstSigma'],
      files: LOTUS_FILES,
      build: (b, image, p) => {
         const model = b.UNETLoader({ unet_name: 'lotus-depth-d-v1-1.safetensors', weight_dtype: 'default' })
         const vae = b.VAELoader({ vae_name: 'SD1.5\\vae-ft-mse-840000-ema-pruned.safetensors' })
         const pixels = b.ImageScaleToTotalPixels({
            image,
            upscale_method: 'lanczos',
            megapixels: (p.detail * p.detail) / 1e6,
            resolution_steps: 8,
         })
         const latent = b.SamplerCustomAdvanced({
            noise: b.DisableNoise({}),
            guider: b.BasicGuider({ model, conditioning: b.LotusConditioning({}) }),
            sampler: b.KSamplerSelect({ sampler_name: 'euler' }),
            sigmas: b.SetFirstSigma({
               sigmas: b.BasicScheduler({ model, scheduler: 'normal', steps: 1, denoise: 1 }),
               sigma: 999,
            }),
            latent_image: b.VAEEncode({ pixels, vae }),
         })
         return b.ImageInvert({ image: b.VAEDecode({ samples: latent.outputs.output, vae }) })
      },
   },
   {
      id: 'dav2-vitl',
      label: 'Depth Anything V2',
      family: 'ViT-L',
      year: 2024,
      kind: 'depth',
      tier: 'modern',
      blurb: 'the default relative depth of 2024, fine edges',
      nodes: auxNodes('DepthAnythingV2Preprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.DepthAnythingV2Preprocessor']({
            image,
            ckpt_name: 'depth_anything_v2_vitl.pth',
            resolution: p.detail,
         }),
   },
   {
      id: 'dav2-vitg',
      label: 'Depth Anything V2',
      family: 'ViT-G',
      year: 2024,
      kind: 'depth',
      tier: 'modern',
      blurb: 'the giant V2 checkpoint, slowest of the family',
      nodes: auxNodes('DepthAnythingV2Preprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.DepthAnythingV2Preprocessor']({
            image,
            ckpt_name: 'depth_anything_v2_vitg.pth',
            resolution: p.detail,
         }),
   },
   {
      id: 'metric3d-depth',
      label: 'Metric3D v2',
      family: 'ViT-L depth',
      year: 2024,
      kind: 'depth',
      tier: 'modern',
      blurb: 'metric depth and normals from one model, focal length aware',
      nodes: auxNodes('Metric3D-DepthMapPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.Metric3D-DepthMapPreprocessor']({
            image,
            backbone: 'vit-large',
            fx: 1000,
            fy: 1000,
            resolution: p.detail,
         }),
   },
   {
      id: 'zoe-da',
      label: 'ZoeDepth × Depth Anything',
      family: 'metric',
      year: 2024,
      kind: 'depth',
      tier: 'modern',
      blurb: 'Depth Anything V1 backbone with the Zoe metric head (outdoor)',
      nodes: auxNodes('Zoe_DepthAnythingPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.Zoe_DepthAnythingPreprocessor']({ image, environment: 'outdoor', resolution: p.detail }),
   },
   {
      id: 'dav1-vitl',
      label: 'Depth Anything V1',
      family: 'ViT-L',
      year: 2024,
      kind: 'depth',
      tier: 'modern',
      blurb: 'the first Depth Anything, for comparison with V2 and 3',
      nodes: auxNodes('DepthAnythingPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.DepthAnythingPreprocessor']({
            image,
            ckpt_name: 'depth_anything_vitl14.pth',
            resolution: p.detail,
         }),
   },
   // ── depth, classic ─────────────────────────────────────────────
   {
      id: 'zoe',
      label: 'ZoeDepth',
      family: 'N+K',
      year: 2023,
      kind: 'depth',
      tier: 'classic',
      blurb: 'metric depth on a MiDaS backbone',
      nodes: auxNodes('Zoe-DepthMapPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) => b['controlnet_aux.Zoe-DepthMapPreprocessor']({ image, resolution: p.detail }),
   },
   {
      id: 'leres',
      label: 'LeReS',
      family: 'boost',
      year: 2021,
      kind: 'depth',
      tier: 'classic',
      blurb: 'monocular depth, the ControlNet 1.1 baseline',
      nodes: auxNodes('LeReS-DepthMapPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.LeReS-DepthMapPreprocessor']({
            image,
            rm_nearest: 0,
            rm_background: 0,
            boost: 'disable',
            resolution: p.detail,
         }),
   },
   {
      id: 'midas',
      label: 'MiDaS',
      family: 'v3 DPT',
      year: 2021,
      kind: 'depth',
      tier: 'classic',
      blurb: 'the ControlNet era baseline',
      nodes: auxNodes('MiDaS-DepthMapPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.MiDaS-DepthMapPreprocessor']({
            image,
            a: Math.PI * 2,
            bg_threshold: 0.1,
            resolution: p.detail,
         }),
   },
   // ── normals ────────────────────────────────────────────────────
   {
      id: 'moge2-normal',
      label: 'MoGe-2',
      family: 'ViT-L normal',
      year: 2025,
      kind: 'normal',
      tier: 'modern',
      blurb: 'normals from the same MoGe-2 pass (OpenGL, green up)',
      nodes: ['LoadMoGeModel', 'MoGeInference', 'MoGeRender'],
      files: [MOGE_FILE],
      build: (b, image, p) =>
         b.MoGeRender({ moge_geometry: mogeGeometry(b, image, p.detail), output: 'normal_opengl' }),
   },
   {
      id: 'marigold2-normal',
      label: 'Marigold v2',
      family: 'normals',
      year: 2026,
      kind: 'normal',
      tier: 'modern',
      blurb: 'diffusion normals on a Qwen Image Edit base (a ~20 GB base model)',
      nodes: ['UNETLoader', 'LoraLoaderModelOnly', 'ConditioningLoader', 'MarigoldV2PostProcess'],
      files: marigoldFiles('normals'),
      build: (_b, image, p) => marigold(p.wf, image, 'normals'),
   },
   {
      id: 'dsine',
      label: 'DSINE',
      family: 'normal',
      year: 2024,
      kind: 'normal',
      tier: 'modern',
      blurb: 'surface normals with per pixel ray direction, strong on indoor scenes',
      nodes: auxNodes('DSINE-NormalMapPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.DSINE-NormalMapPreprocessor']({ image, fov: 60, iterations: 5, resolution: p.detail }),
   },
   {
      id: 'metric3d-normal',
      label: 'Metric3D v2',
      family: 'ViT-L normal',
      year: 2024,
      kind: 'normal',
      tier: 'modern',
      blurb: 'normals from the Metric3D joint depth and normal model',
      nodes: auxNodes('Metric3D-NormalMapPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.Metric3D-NormalMapPreprocessor']({
            image,
            backbone: 'vit-large',
            fx: 1000,
            fy: 1000,
            resolution: p.detail,
         }),
   },
   {
      id: 'bae',
      label: 'BAE',
      family: 'normal',
      year: 2021,
      kind: 'normal',
      tier: 'classic',
      blurb: 'the ControlNet 1.1 normal estimator',
      nodes: auxNodes('BAE-NormalMapPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) => b['controlnet_aux.BAE-NormalMapPreprocessor']({ image, resolution: p.detail }),
   },
   {
      id: 'midas-normal',
      label: 'MiDaS',
      family: 'normal from depth',
      year: 2021,
      kind: 'normal',
      tier: 'classic',
      blurb: 'normals differentiated from the MiDaS depth',
      nodes: auxNodes('MiDaS-NormalMapPreprocessor'),
      files: [],
      autoDownload: true,
      build: (b, image, p) =>
         b['controlnet_aux.MiDaS-NormalMapPreprocessor']({
            image,
            a: Math.PI * 2,
            bg_threshold: 0.1,
            resolution: p.detail,
         }),
   },
]

/** raw object_info, as the host schema keeps it */
type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>

/** the options of a COMBO input in both object_info spellings: [[...]] and ['COMBO', { options }] */
function comboOptions(info: ObjectInfo, node: string, input: string): string[] {
   const def = info[node]?.input
   const slot = def?.required?.[input] ?? def?.optional?.[input]
   if (!Array.isArray(slot)) return []
   const head: unknown = slot[0]
   if (Array.isArray(head)) return head.filter((x): x is string => typeof x === 'string')
   const opts: unknown = (slot[1] as { options?: unknown } | undefined)?.options
   return Array.isArray(opts) ? opts.filter((x): x is string => typeof x === 'string') : []
}

export type Availability = { ok: boolean; missingNodes: string[]; missingFiles: WeightFile[] }

export function availability(info: ObjectInfo, m: ModelEntry): Availability {
   const missingNodes = m.nodes.filter((n) => info[n] == null)
   const missingFiles = m.files.filter((f) => !comboOptions(info, f.node, f.input).includes(f.file))
   return { ok: missingNodes.length === 0 && missingFiles.length === 0, missingNodes, missingFiles }
}
