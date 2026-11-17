// mage-flow t2i turbo on Comfy Cloud — Microsoft Mage-Flow Turbo int8, 4-step distilled text to image at cfg 1 (512 to 2048 px a side, multiples of 16)
// source template: image_mage_flow_turbo_t2i_int8.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/mage-flow-t2i-turbo.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const mageFlowT2iTurbo = host.defineWorkflow({
   id: 'mage-flow-t2i-turbo',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Vintage analogue film photograph, a surreal scene in which a person is completely wrapped and hidden by a large soft white cumulus cloud; only a loose blue-and-white floral shirt and the shape of a seated figure show beneath it. The figure sits sideways at an old wooden classroom desk beside a large wooden window with pale blue sky outside. Soft daylight, quiet dreamy nostalgic atmosphere, muted retro pastel colors, subtle film grain, soft focus, minimalist surreal photography.',
      ),
      seed: v.seed(42),
      steps: v.int(4, { min: 1, max: 30 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      const vae = b.VAELoader({ vae_name: 'mage_flow_vae_bf16.safetensors' })
      // one encode node builds the positive, the negative AND the empty latent at the asked size
      const encoded = b.TextEncodeMageFlowEdit({
         clip: b.CLIPLoader({ clip_name: 'qwen3vl_4b_bf16.safetensors', type: 'mage', device: 'default' }),
         prompt: vars.prompt.positive,
         negative_prompt: vars.prompt.negative,
         vae,
         width: vars.size.width,
         height: vars.size.height,
         batch_size: 1,
      })
      const samples = b.KSampler({
         model: b.UNETLoader({ unet_name: 'mage_flow_turbo_int8_convrot.safetensors', weight_dtype: 'default' }),
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

export default mageFlowT2iTurbo

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) mageFlowT2iTurbo.vars.prompt.set(process.argv[2])
   if (process.argv[3]) mageFlowT2iTurbo.vars.seed.set(Number(process.argv[3]))
   const execution = await mageFlowT2iTurbo.run({ log: true, save: { prefix: 'comfy-ts-zoo/mage-flow-t2i-turbo' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
