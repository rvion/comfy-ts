// relight a photo: one depth model, one normal model and the Marigold IID material maps, drawn
// by the serve panel's relight widget (a point light you move over the image in 3D: drag for
// left/right and up/down, wheel for nearer/farther, plus shadows and drifting light motes).
// The models are the depth explorer's catalog (examples/depth-explorer/models.ts); a choice lists
// the ones this host can run. Outside the panel (CLI, TUI) each map is a plain output image.
//
// run directly:  bun examples/rvion/17-relight.cflow.ts [path/to/image.png]
import { asAbsolutePath, type BaseNodeInputs, ComfyTS, exampleImagePath, MediaImage, v, widget } from 'comfy-ts'
import { availability, MODELS, type ModelEntry } from '../depth-explorer/models.ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1' })
await host.loadSchemaFromCache()

/** the catalog entries of one kind this host can run (by its cached schema) */
function runnable(kind: ModelEntry['kind']): string[] {
   return MODELS.filter((m) => m.kind === kind && availability(host.schema.data.spec, m).ok).map((m) => m.id)
}
function entry(id: string): ModelEntry {
   const m = MODELS.find((x) => x.id === id)
   if (m == null) throw new Error(`no model '${id}' in the depth explorer catalog`)
   return m
}
const pick = (ids: string[], preferred: string): string => (ids.includes(preferred) ? preferred : (ids[0] ?? preferred))

const depthIds = runnable('depth')
const normalIds = runnable('normal')
const image = v.image(exampleImagePath('lioness_768x768.jpg'))

export const relight = host.defineWorkflow({
   id: 'relight',
   vars: {
      image,
      depth: v.choice(depthIds, pick(depthIds, 'da3-mono-large')),
      normal: v.choice(normalIds, pick(normalIds, 'moge2-normal')),
      /** albedo, roughness and metalness (Marigold IID appearance) */
      materials: v.toggle(true, 'materials'),
      /** the non diffuse light (Marigold IID lighting): what shines */
      reflections: v.toggle(true, 'reflections'),
      detail: v.int(768, { min: 384, max: 1536 }),
   },
   widgets: [
      widget.relight({
         image: 'source',
         depth: 'depth',
         normal: 'normal',
         albedo: 'albedo',
         roughness: 'roughness',
         metalness: 'metalness',
         specular: 'specular',
      }),
   ],
   build: async (b, vars, wf) => {
      const loaded = await new MediaImage({ path: asAbsolutePath(image.absPath()) }).loadInWorkflow_viaLoadImageNode(wf)
      const saveNode = wf.builderBase.SaveImageWebsocket
      if (saveNode == null) throw new Error('this host has no SaveImageWebsocket node')
      const save = (images: BaseNodeInputs[string], tag: string): void => void saveNode({ images }, { tag })
      const p = { detail: vars.detail, wf }
      save(loaded, 'source')
      save(entry(vars.depth).build(b, loaded, p), 'depth')
      save(entry(vars.normal).build(b, loaded, p), 'normal')
      if (vars.materials) {
         save(entry('iid-albedo').build(b, loaded, p), 'albedo')
         save(entry('iid-roughness').build(b, loaded, p), 'roughness')
         save(entry('iid-metalness').build(b, loaded, p), 'metalness')
      }
      if (vars.reflections) save(entry('iid-specular').build(b, loaded, p), 'specular')
   },
})

export default relight

// standalone run (skipped when another driver, e.g. the TUI, imports this module)
if (import.meta.main) {
   if (process.argv[2]) relight.vars.image.set(process.argv[2])
   const execution = await relight.run({ log: true, save: { prefix: 'comfy-ts-example/relight' } })
   for (const out of execution.images) console.log(`🟢 ${out.tags.join(',')} ${out.absPath}`)
   host.disconnect()
}
