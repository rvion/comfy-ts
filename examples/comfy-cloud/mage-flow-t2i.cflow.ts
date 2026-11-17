// mage-flow t2i on Comfy Cloud — Microsoft Mage-Flow int8, native-resolution text to image (512 to 2048 px a side, multiples of 16)
// source template: image_mage_flow_t2i_int8.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/mage-flow-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const mageFlowT2i = host.defineWorkflow({
   id: 'mage-flow-t2i',
   vars: {
      // ONE prompt var: `- ` lines are the NEGATIVE prompt, `//` lines are comments
      prompt: v.prompt(
         'Analog film photograph, wide landscape shot, a lone man viewed from behind wearing a long dark brown overcoat standing in an empty snowy desert. A giant single pillar brutalist concrete gas station canopy with wide mushroom-shaped roof, minimalist retro futurism architecture. A smooth cream vintage fastback sports car parked beside an old red-and-white fuel pump. Distant snow-capped mountain ranges, pale muted sky, gravel ground with thin scattered snow. Soft natural daylight, muted earth tone palette, subtle film grain, medium format film aesthetic, cinematic minimalist photography',
      ),
      seed: v.seed(42),
      steps: v.int(30, { min: 1, max: 100 }),
      cfg: v.float(5, { min: 1, max: 15 }),
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
         model: b.UNETLoader({ unet_name: 'mage_flow_int8_convrot.safetensors', weight_dtype: 'default' }),
         positive: encoded.outputs.positive,
         negative: encoded.outputs.negative,
         latent_image: encoded.outputs.latent,
         seed: vars.seed,
         steps: vars.steps,
         cfg: vars.cfg,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      b.SaveImageWebsocket({ images: b.VAEDecode({ samples, vae }) })
   },
})

export default mageFlowT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) mageFlowT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) mageFlowT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await mageFlowT2i.run({ log: true, save: { prefix: 'comfy-ts-zoo/mage-flow-t2i' } })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
