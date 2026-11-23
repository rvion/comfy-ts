// the catalog: every upscaler the explorer knows, one ComfyUI graph each. An entry runs only when
// the host has its nodes AND its weight files (checked live, examples/explorer-kit/catalog.ts).
// Every output lands at the SAME size, the source times the page's scale: a model whose native
// factor differs is resized after it with Lanczos, so the loupe compares like with like, pixel for
// pixel, against the source enlarged with Lanczos alone. `speed`: a 744×1040 card to ×4 on the 4090,
// weights loaded, as the page times it (about 3 s of it is the 16 to 26 MB png crossing the tunnel);
// `quality`: judged on the text and mana symbols of a card scan.
import type { BaseNode } from 'comfy-ts'
import { base, type CatalogEntry, type WeightFile } from '../explorer-kit/catalog.ts'
import type { ExplorerImg as Img, ExplorerWf as W } from '../explorer-kit/server.ts'

export type Scale = 2 | 4
export type UpscalerKind = 'baseline' | 'model' | 'diffusion'

export type UpscalerEntry = CatalogEntry & {
   kind: UpscalerKind
   /** classic = pre 2024 models, off by default */
   tier: 'modern' | 'classic'
   /** the network: DAT2, HAT-L, ESRGAN, SeedVR2 … */
   arch: string
   /** its native factor; 0 = any (the baseline, the diffusion models) */
   native: number
   license: string
   /** the graph up to its output image, at the source size times `scale` */
   build: (wf: W, image: Img, p: { scale: Scale }) => Img | BaseNode
}

/** `image` times `k` with Lanczos: the fair baseline, and the step that brings a model's native
 * factor to the page's scale */
const lanczos = (wf: W, image: Img | BaseNode, k: number): BaseNode =>
   base(wf, 'ImageScaleBy')({ image, upscale_method: 'lanczos', scale_by: k })

const upscaleFile = (file: string, url: string): WeightFile => ({
   node: 'UpscaleModelLoader',
   input: 'model_name',
   file,
   folder: 'upscale_models',
   url,
})

/** one ImageUpscaleWithModel pass (spandrel: ESRGAN, DAT, HAT, RCAN, PLKSR …, tiled by ComfyUI,
 * which halves the tile on an out of memory), then Lanczos to the page's scale */
function spandrel(
   e: Omit<UpscalerEntry, 'kind' | 'nodes' | 'files' | 'build'> & { file: string; url: string },
): UpscalerEntry {
   const { file, url, ...card } = e
   return {
      ...card,
      kind: 'model',
      nodes: ['UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScaleBy'],
      files: [upscaleFile(file, url)],
      build: (wf, image, p) => {
         const up = base(
            wf,
            'ImageUpscaleWithModel',
         )({ upscale_model: base(wf, 'UpscaleModelLoader')({ model_name: file }), image })
         return p.scale === e.native ? up : lanczos(wf, up, p.scale / e.native)
      },
   }
}

const SEEDVR2_BASE = 'https://huggingface.co/Comfy-Org/SeedVR2/resolve/main'
const SEEDVR2_VAE: WeightFile = {
   node: 'VAELoader',
   input: 'vae_name',
   file: 'seedvr2_ema_vae_fp16.safetensors',
   folder: 'vae',
   url: `${SEEDVR2_BASE}/vae/seedvr2_ema_vae_fp16.safetensors`,
}

/** the Comfy-Org SeedVR2 image template (core nodes): Lanczos to the target size, one diffusion
 * step that restores it, colour kept as the model made it. Tiled VAE, so a 12 MP card fits */
function seedvr2(e: Omit<UpscalerEntry, 'kind' | 'nodes' | 'files' | 'build' | 'native'> & { unet: string }): UpscalerEntry {
   const { unet, ...card } = e
   const unetFile: WeightFile = {
      node: 'UNETLoader',
      input: 'unet_name',
      file: unet,
      folder: 'diffusion_models',
      url: `${SEEDVR2_BASE}/diffusion_models/${unet}`,
   }
   return {
      ...card,
      kind: 'diffusion',
      native: 0,
      nodes: ['SeedVR2Preprocess', 'SeedVR2Conditioning', 'SeedVR2PostProcessing', 'ImageScaleBy'],
      files: [unetFile, SEEDVR2_VAE],
      build: (wf, image, p) => {
         const resized = lanczos(wf, image, p.scale)
         const vae = base(wf, 'VAELoader')({ vae_name: SEEDVR2_VAE.file })
         const model = base(wf, 'UNETLoader')({ unet_name: unet, weight_dtype: 'default' })
         const tiles = { tile_size: 512, overlap: 128, temporal_size: 4096, temporal_overlap: 8 }
         const latent = base(
            wf,
            'VAEEncodeTiled',
         )({ pixels: base(wf, 'SeedVR2Preprocess')({ resized_images: resized }), vae, ...tiles })
         const cond = base(wf, 'SeedVR2Conditioning')({ model, vae_conditioning: latent })
         const [positive, negative] = [cond.outputs.positive, cond.outputs.negative]
         if (positive == null || negative == null) throw new Error('SeedVR2Conditioning has no positive/negative slots')
         const samples = base(
            wf,
            'KSampler',
         )({
            model,
            seed: 1,
            steps: 1,
            cfg: 1,
            sampler_name: 'euler',
            scheduler: 'simple',
            positive,
            negative,
            latent_image: latent,
            denoise: 1,
         })
         return base(
            wf,
            'SeedVR2PostProcessing',
         )({
            images: base(wf, 'VAEDecodeTiled')({ samples, vae, ...tiles }),
            original_resized_images: resized,
            color_correction_method: 'none',
         })
      },
   }
}

/** an ESRGAN era model (64 MB each), found again by its file name on OpenModelDB */
function classic(
   id: string,
   file: string,
   label: string,
   family: string,
   date: string,
   native: number,
   blurb: string,
   speed = '~5 s',
): UpscalerEntry {
   return spandrel({
      id,
      label,
      family,
      year: Number(date.slice(0, 4)),
      date,
      size: '64 MB',
      quality: 2,
      speed,
      tier: 'classic',
      arch: 'ESRGAN',
      native,
      license: 'see its model card',
      blurb,
      file,
      url: 'https://openmodeldb.info',
   })
}

const HF = 'https://huggingface.co'
const JANAI = 'https://github.com/the-database/MangaJaNai/releases/download/3.0.0'

export const MODELS: UpscalerEntry[] = [
   // ── the baseline ───────────────────────────────────────────────
   {
      id: 'lanczos',
      label: 'Lanczos',
      family: 'resample',
      year: 1979,
      date: '1979',
      size: 'none',
      quality: 1,
      speed: '~3 s',
      kind: 'baseline',
      tier: 'modern',
      arch: 'Lanczos 3',
      native: 0,
      license: 'none',
      blurb: 'the source enlarged with no model: what every upscaler must beat',
      nodes: ['ImageScaleBy'],
      files: [],
      build: (wf, image, p) => lanczos(wf, image, p.scale),
   },
   // ── models, modern ─────────────────────────────────────────────
   spandrel({
      id: 'ultrasharp-v2',
      label: 'UltraSharp V2',
      family: 'DAT2',
      year: 2025,
      date: '2025-05',
      size: '140 MB',
      quality: 5,
      speed: '~19 s',
      tier: 'modern',
      arch: 'DAT2',
      native: 4,
      license: 'CC BY-NC-SA 4.0',
      blurb: 'Kim2091, the general upscaler of 2025: photos, illustration and text, crisp edges',
      file: '4x-UltraSharpV2.safetensors',
      url: `${HF}/Kim2091/UltraSharpV2/resolve/main/4x-UltraSharpV2.safetensors`,
   }),
   spandrel({
      id: 'ultrasharp-v2-lite',
      label: 'UltraSharp V2 Lite',
      family: 'RealPLKSR',
      year: 2025,
      date: '2025-05',
      size: '30 MB',
      quality: 4,
      speed: '~4 s',
      tier: 'modern',
      arch: 'RealPLKSR',
      native: 4,
      license: 'CC BY-NC-SA 4.0',
      blurb: 'the fast UltraSharp V2, a lighter network on the same data',
      file: '4x-UltraSharpV2_Lite.safetensors',
      url: `${HF}/Kim2091/UltraSharpV2/resolve/main/4x-UltraSharpV2_Lite.safetensors`,
   }),
   spandrel({
      id: 'janai-detail-dat2',
      label: 'IllustrationJaNai V3',
      family: 'detail DAT2',
      year: 2025,
      date: '2025-11',
      size: '140 MB',
      quality: 4,
      speed: '~18 s',
      tier: 'modern',
      arch: 'DAT2',
      native: 4,
      license: 'CC BY-NC-SA 4.0',
      blurb: 'the-database, made for digital art and illustration; keeps the fine detail',
      file: '4x_IllustrationJaNai_V3detail_DAT2_28k_bf16.safetensors',
      url: `${JANAI}/IllustrationJaNai_V3detail.zip`,
   }),
   spandrel({
      id: 'janai-detail-hat',
      label: 'IllustrationJaNai V3',
      family: 'detail HAT-L',
      year: 2025,
      date: '2025-11',
      size: '160 MB',
      quality: 4,
      speed: '~15 s',
      tier: 'modern',
      arch: 'HAT-L',
      native: 4,
      license: 'CC BY-NC-SA 4.0',
      blurb: 'the same training on the heavier HAT-L transformer',
      file: '4x_IllustrationJaNai_V3detail_HAT_L_28k_bf16.safetensors',
      url: `${JANAI}/IllustrationJaNai_V3detail.zip`,
   }),
   spandrel({
      id: 'janai-denoise-dat2',
      label: 'IllustrationJaNai V3',
      family: 'denoise DAT2',
      year: 2025,
      date: '2025-11',
      size: '140 MB',
      quality: 3,
      speed: '~19 s',
      tier: 'modern',
      arch: 'DAT2',
      native: 4,
      license: 'CC BY-NC-SA 4.0',
      blurb: 'the illustration model that also cleans scan noise and compression',
      file: '4x_IllustrationJaNai_V3denoise_DAT2_27k_bf16.safetensors',
      url: `${JANAI}/IllustrationJaNai_V3denoise.zip`,
   }),
   spandrel({
      id: 'nomos2-hq-dat2',
      label: 'Nomos2 hq',
      family: 'DAT2',
      year: 2024,
      date: '2024-10',
      size: '140 MB',
      quality: 4,
      speed: '~20 s',
      tier: 'modern',
      arch: 'DAT2',
      native: 4,
      license: 'CC BY 4.0',
      blurb: 'Phhofm, for clean (non degraded) photos: faithful, little invention',
      file: '4xNomos2_hq_dat2.safetensors',
      url: `${HF}/Phips/4xNomos2_hq_dat2/resolve/main/4xNomos2_hq_dat2.safetensors`,
   }),
   spandrel({
      id: 'animesharp-v4',
      label: 'AnimeSharp V4',
      family: 'RCAN ×2',
      year: 2025,
      date: '2025-01',
      size: '31 MB',
      quality: 3,
      speed: '~4 s',
      tier: 'modern',
      arch: 'RCAN',
      native: 2,
      license: 'CC BY-NC-SA 4.0',
      blurb: 'Kim2091, line art and flat colour at ×2 (Lanczos ×2 after it at ×4)',
      file: '2x-AnimeSharpV4_RCAN.safetensors',
      url: `${HF}/Kim2091/2x-AnimeSharpV4/resolve/main/2x-AnimeSharpV4_RCAN.safetensors`,
   }),
   // ── diffusion ──────────────────────────────────────────────────
   seedvr2({
      id: 'seedvr2-7b-sharp',
      label: 'SeedVR2',
      family: '7B sharp int8',
      year: 2025,
      date: '2025-06',
      size: '8.3 GB',
      quality: 5,
      speed: '~18 s',
      tier: 'modern',
      arch: 'SeedVR2 DiT',
      license: 'Apache 2.0',
      blurb: 'ByteDance, one step diffusion restoration; the sharp 7B (may redraw tiny glyphs)',
      unet: 'seedvr2_7b_sharp_int8_convrot.safetensors',
   }),
   seedvr2({
      id: 'seedvr2-3b',
      label: 'SeedVR2',
      family: '3B int8',
      year: 2025,
      date: '2025-06',
      size: '3.5 GB',
      quality: 4,
      speed: '~17 s',
      tier: 'modern',
      arch: 'SeedVR2 DiT',
      license: 'Apache 2.0',
      blurb: 'the 3B SeedVR2, as the Comfy-Org template ships it',
      unet: 'seedvr2_3b_int8_convrot.safetensors',
   }),
   // ── models, classic (2018 to 2022, on the box already) ─────────
   classic('ultrasharp', '4x-UltraSharp.pth', 'UltraSharp', 'ESRGAN', '2022-01', 4, 'Kim2091, the sharp default of the SD era'),
   classic('animesharp', '4x-AnimeSharp.pth', 'AnimeSharp', 'ESRGAN', '2022-02', 4, 'Kim2091, anime and line art'),
   classic('siax', '4x_NMKD-Siax_200k.pth', 'NMKD Siax', 'ESRGAN', '2021', 4, 'Nmkd, a soft general upscaler'),
   classic('remacri', '4x_foolhardy_Remacri.pth', 'Remacri', 'ESRGAN', '2021', 4, 'foolhardy, an interpolation tuned for detail'),
   classic('superscale', '8x_NMKD-Superscale_150000_G.pth', 'NMKD Superscale', 'ESRGAN ×8', '2021', 8, 'Nmkd, ×8 then Lanczos down to the scale', '~11 s'),
   classic('realesrgan-x4', 'RealESRGAN_x4.pth', 'Real-ESRGAN', 'x4plus', '2021-07', 4, 'xinntao, the classic for degraded photos'),
   classic('realesrgan-x2', 'RealESRGAN_x2.pth', 'Real-ESRGAN', 'x2plus', '2021-07', 2, 'xinntao, ×2 (Lanczos ×2 after it at ×4)'),
   classic('esrgan', 'ESRGAN_4x.pth', 'ESRGAN', 'original', '2018-09', 4, 'the 2018 original, for reference'),
]
