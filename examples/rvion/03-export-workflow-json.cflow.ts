// build a graph OFFLINE (schema from .comfy-ts/ cache) and export both ComfyUI
// JSON formats: api.json (prompt) + workflow.json (readable litegraph, autolayouted)
// run directly:  bun examples/rvion/03-export-workflow-json.cflow.ts   (no server needed)
// in the TUI:    bun run tui — r runs it live (PreviewImage), c/C copy the JSONs
import { mkdirSync, writeFileSync } from 'node:fs'
import { ComfyTS, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1', host: 'desktop-im18794', port: 8085 })
await host.loadSchemaFromCache() // no connection needed

export const exportWorkflow = host.defineWorkflow({
   id: 'export-workflow-json',
   vars: {
      prompt: v.text('macro photo of a leaf'),
      seed: v.seed(1),
      steps: v.int(12, { min: 1, max: 60 }),
      size: v.size({ width: 512, height: 512 }),
   },
   build: (b, vars) => {
      const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'SD1.5\\v1-5-pruned-emaonly.ckpt' })
      const samples = b.KSampler({
         model: ckpt,
         positive: b.CLIPTextEncode({ clip: ckpt, text: vars.prompt }),
         negative: b.CLIPTextEncode({ clip: ckpt, text: '' }),
         latent_image: b.EmptyLatentImage({ width: vars.size.width, height: vars.size.height, batch_size: 1 }),
         seed: vars.seed,
         steps: vars.steps,
         cfg: 6,
         sampler_name: 'euler',
         scheduler: 'normal',
         denoise: 1,
      })
      b.PreviewImage({ images: b.VAEDecode({ samples, vae: ckpt }) })
   },
})

export default exportWorkflow

// standalone run: write both JSONs offline (skipped when the TUI imports this module)
if (import.meta.main) {
   mkdirSync(comfy.outputPath, { recursive: true })
   const wf = await exportWorkflow.build()

   // 1. api.json — what POST /prompt takes
   const apiJson = wf.toApiJson('use_stringified_numbers_only')
   writeFileSync(comfy.resolveFromOutput('example-api.json'), JSON.stringify(apiJson, null, 3))

   // 2. workflow.json — what the ComfyUI editor opens (autolayouted, readable)
   const workflowJson = await wf.toWorkflowJson()
   writeFileSync(comfy.resolveFromOutput('example-workflow.json'), JSON.stringify(workflowJson, null, 3))

   console.log(`🟢 wrote ${comfy.resolveFromOutput('example-api.json')}`)
   console.log(`🟢 wrote ${comfy.resolveFromOutput('example-workflow.json')}`)
   console.log(`   (drag example-workflow.json into the ComfyUI editor to see the graph)`)
}
