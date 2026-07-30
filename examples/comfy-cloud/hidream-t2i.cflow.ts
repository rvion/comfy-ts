// hidream t2i on Comfy Cloud — HiDream I1 Fast fp8, 16-step distilled (cfg 1, lcm), quadruple text encoder
// source template: hidream_i1_fast.json (official workflow-templates)
// needs COMFY_CLOUD_API_KEY (https://cloud.comfy.org, paid tiers)
// run directly:  bun examples/comfy-cloud/hidream-t2i.cflow.ts ["prompt"] [seed]
import { v } from 'comfy-ts'
import { cloudHost, requireCloudKey } from './cloudHost.ts'

const host = await cloudHost()

export const hidreamT2i = host.defineWorkflow({
   id: 'hidream-t2i',
   vars: {
      prompt: v.prompt(
         'a lo-fi grungy wide shot of a ragged large red tree leaning slightly to one side, Polaroid aesthetic, alone in a desolate landscape, lit by a red light, pitch black background\n- bad ugly jpeg artifacts',
      ),
      seed: v.seed(42),
      steps: v.int(16, { min: 1, max: 50 }),
      size: v.size({ width: 1024, height: 1024 }),
   },
   build: (b, vars) => {
      // hidream stacks four text encoders: clip-l, clip-g, t5xxl, llama 3.1 8b
      const clip = b.QuadrupleCLIPLoader({
         clip_name1: 'clip_l_hidream.safetensors',
         clip_name2: 'clip_g_hidream.safetensors',
         clip_name3: 't5xxl_fp8_e4m3fn_scaled.safetensors',
         clip_name4: 'llama_3.1_8b_instruct_fp8_scaled.safetensors',
      })
      const vae = b.VAELoader({ vae_name: 'ae.safetensors' })
      const model = b.ModelSamplingSD3({
         model: b.UNETLoader({ unet_name: 'hidream_i1_fast_fp8.safetensors', weight_dtype: 'default' }),
         shift: 3,
      })
      const positive = b.CLIPTextEncode({ clip, text: vars.prompt.positive })
      // distilled model runs cfg 1: empty negative stays zeroed out
      const negative =
         vars.prompt.negative === ''
            ? b.ConditioningZeroOut({ conditioning: positive })
            : b.CLIPTextEncode({ clip, text: vars.prompt.negative })
      const samples = b.KSampler({
         model,
         positive,
         negative,
         latent_image: b.EmptySD3LatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 1,
         sampler_name: 'lcm',
         scheduler: 'normal',
         denoise: 1,
      })
      b.SaveImage({ images: b.VAEDecode({ samples, vae }), filename_prefix: 'comfy-ts-zoo/hidream-t2i' })
   },
})

export default hidreamT2i

// standalone run (skipped when another driver — e.g. the TUI — imports this module)
if (import.meta.main) {
   requireCloudKey()
   if (process.argv[2]) hidreamT2i.vars.prompt.set(process.argv[2])
   if (process.argv[3]) hidreamT2i.vars.seed.set(Number(process.argv[3]))
   const execution = await hidreamT2i.run({ log: true })
   for (const img of execution.images) console.log(`🟢 ${img.absPath}`)
   host.disconnect()
}
