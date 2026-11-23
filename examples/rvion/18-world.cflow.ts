// turn one picture into a 360° world: Qwen-Image-Edit-2509 with Tencent's HY-Pano 2.0 LoRA (from
// HY-World 2.0) expands the picture into an equirectangular panorama, the same prompt template,
// size, steps and guidance as their pipeline_with_qwen_image.py. Its left and right edges meet:
// the viewer wraps it around you. MoGe then measures the panorama's depth all around and the
// world is saved as a textured mesh (glb) seen from its middle.
//
// run directly:  bun examples/rvion/18-world.cflow.ts [path/to/image.png] [seed]
import { ComfyTS, exampleImagePath, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1' })
await host.loadSchemaFromCache()

/** HY-Pano 2.0's own prompt template (hyworld2/panogen/pipeline_with_qwen_image.py) */
const PANO_PREFIX =
   'Create a **ERP** panoramic expansion of the provided image. Preserve the original style, lighting, and fine details seamlessly throughout the extended areas, extend according to: '
const PANO_SUFFIX = ' 8k UHD, masterpiece, razor-sharp details.'
const PANO_NEGATIVE =
   '低分辨率，低画质，模糊。杂乱的背景，结构扭曲，模糊纹理，物体融合。构图混乱。过度光滑，画面具有AI感。人脸畸形。巨大物体，巨大建筑，近景特写，近景压迫，比例失调。车，车辆。画面上方的树叶。'
const PANO_LORA = 'world\\hy-pano-2-qwen-lora.safetensors'
/** HY-Pano's canvas and its edge blend width: 1952 - 32 = 1920, 2:1 */
const PANO_W = 1952
const PANO_H = 960
const BLEND = 32

const image = v.image(exampleImagePath('lioness_768x768.jpg'), {
   presets: {
      lioness: exampleImagePath('lioness_768x768.jpg'),
      bear: exampleImagePath('bear_1024x1024.jpg'),
      walrus: exampleImagePath('walrus_1344x768.jpg'),
      deer: exampleImagePath('deer_768x1344.jpg'),
   },
})

export const world = host.defineWorkflow({
   id: 'world',
   vars: {
      image,
      /** what the unseen sides hold; empty lets the model continue the picture */
      extend: v.text(''),
      seed: v.seed(42),
      steps: v.int(40, { min: 8, max: 60 }),
      cfg: v.float(7.5, { min: 1, max: 12 }),
   },
   build: async (b, vars, wf) => {
      const picture = await image.loadInWorkflow(wf)
      const clip = b.CLIPLoader({ clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image' })
      const vae = b.VAELoader({ vae_name: 'qwen_image_vae.safetensors' })
      const unet = b.UNETLoader({ unet_name: 'qwen_image_edit_2509_int8_convrot.safetensors', weight_dtype: 'default' })
      const withLora = b.LoraLoaderModelOnly({ model: unet, lora_name: PANO_LORA, strength_model: 1 })
      const encode = (prompt: string) =>
         b.TextEncodeQwenImageEditPlus({ clip, prompt, vae, image1: picture })
      const samples = b.KSampler({
         model: b.ModelSamplingAuraFlow({ model: withLora, shift: 3.1 }),
         positive: encode(`${PANO_PREFIX}${vars.extend}${PANO_SUFFIX}`),
         negative: encode(PANO_NEGATIVE),
         latent_image: b.EmptySD3LatentImage({ width: PANO_W, height: PANO_H, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      const raw = b.VAEDecode({ samples, vae })
      // the seam: HY-Pano's own edge blend (circular_blend_edges), the last BLEND columns fade into
      // the first ones, then leave; 1952 wide becomes an exact 2:1 that wraps without a cut
      const strip = (x: number) => b.ImageCrop({ image: raw, width: BLEND, height: PANO_H, x, y: 0 })
      const joined = b.ImageCompositeMasked({
         destination: strip(PANO_W - BLEND),
         source: strip(0),
         x: 0,
         y: 0,
         mask: b['kjnodes.CreateGradientMask']({ invert: true, frames: 1, width: BLEND, height: PANO_H }),
      })
      const panorama = b.ImageCompositeMasked({
         destination: b.ImageCrop({ image: raw, width: PANO_W - BLEND, height: PANO_H, x: 0, y: 0 }),
         source: joined,
         x: 0,
         y: 0,
      })
      b.SaveImageWebsocket({ images: panorama }, { tag: 'panorama' })
      // the world: MoGe reads 12 perspective views of the panorama, merges one distance map all
      // around, and the textured mesh is that map seen from the middle
      const geometry = b.MoGePanoramaInference({
         moge_model: b.LoadMoGeModel({ model_name: 'moge_2_vitl_normal_fp16.safetensors' }),
         image: panorama,
      })
      b.SaveGLB({ mesh: b.MoGePointMapToMesh({ moge_geometry: geometry }), filename_prefix: 'comfy-ts/world' })
   },
})

export default world

if (import.meta.main) {
   if (process.argv[2]) world.vars.image.set(process.argv[2])
   if (process.argv[3]) world.vars.seed.set(Number(process.argv[3]))
   const execution = await world.run({ log: true, save: { prefix: 'comfy-ts-example/world' } })
   for (const img of execution.images) console.log(`🟢 ${img.tags.join(',')} ${img.absPath}`)
   host.disconnect()
}
