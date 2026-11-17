// mage-flow i2i turbo on Comfy Cloud — Microsoft Mage-Flow-Edit Turbo int8, 4-step distilled instruction edit at cfg 1
// source template: image_mage_flow_edit_turbo_int8.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/mage-flow-i2i-turbo.cflow.ts [path/to/image.png] ["edit prompt"] [seed]
import { asAbsolutePath, exampleImagePath, MediaImage, v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

// bundled default input (examples/images/, ships in the tarball) — the TUI picker or argv[2] swap it
const image = v.image(exampleImagePath('bear_1024x1024.jpg'))

export const mageFlowI2iTurbo = host.defineWorkflow({
   id: 'mage-flow-i2i-turbo',
   vars: {
      image,
      // ONE prompt var: say what stays, then what changes; `- ` lines are the NEGATIVE prompt
      prompt: v.prompt('Remove the bear, keep the rest of the scene unchanged.'),
      seed: v.seed(42),
      steps: v.int(4, { min: 1, max: 30 }),
   },
   // async build: the input image is uploaded (hash-named, deduped) per run
   build: async (b, vars, wf) => {
      const img = new MediaImage({ path: asAbsolutePath(image.absPath()) })
      const loaded = await img.loadInWorkflow_viaLoadImageNode(wf)

      const vae = b.VAELoader({ vae_name: 'mage_flow_vae_bf16.safetensors' })
      // the reference → ~1MP on a 16 px grid; width and height 0 = the output takes the reference's size
      const encoded = b.TextEncodeMageFlowEdit({
         clip: b.CLIPLoader({ clip_name: 'qwen3vl_4b_bf16.safetensors', type: 'mage', device: 'default' }),
         prompt: vars.prompt.positive,
         negative_prompt: vars.prompt.negative,
         'images.image_1': b.ImageScaleToTotalPixels({
            image: loaded,
            upscale_method: 'nearest-exact',
            megapixels: 1,
            resolution_steps: 16,
         }),
         vae,
         width: 0,
         height: 0,
         batch_size: 1,
      })
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'mage_flow_edit_turbo_int8_convrot.safetensors', weight_dtype: 'default' }),
         positive: encoded.outputs.positive,
         negative: encoded.outputs.negative,
         latent_image: encoded.outputs.latent,
         seed: vars.seed,
         steps: vars.steps,
         // distilled: no guidance
         cfg: 1,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae }) })
   },
})

export default mageFlowI2iTurbo

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) mageFlowI2iTurbo.vars.image.set(process.argv[2])
   if (process.argv[3]) mageFlowI2iTurbo.vars.prompt.set(process.argv[3])
   if (process.argv[4]) mageFlowI2iTurbo.vars.seed.set(Number(process.argv[4]))
   const execution = await mageFlowI2iTurbo.run({ log: true, save: { prefix: 'comfy-ts-zoo/mage-flow-i2i-turbo' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
