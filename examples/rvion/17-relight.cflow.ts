// relight a photo: one depth model, one normal model and the Marigold IID material maps, drawn
// by the serve panel's relight widget (a point light you move over the image in 3D: drag for
// left/right and up/down, wheel for nearer/farther, plus shadows and drifting light motes).
// The models are the depth explorer's catalog (examples/depth-explorer/models.ts): one choice per
// map lists the ones this host can run, each option with its picture, date, weights and quality
// (a choice of one still says what it is). Every material map can be « none ». The image presets
// are the example animals (a url works too, see the commented ones). Outside the panel (CLI,
// TUI) each map is a plain output image.
//
// run directly:  bun examples/rvion/17-relight.cflow.ts [path/to/image.png]
import { asAbsolutePath, type BaseNodeInputs, ComfyTS, exampleImagePath, MediaImage, v, widget } from 'comfy-ts'
import { MODELS, optionLook, type ModelEntry } from '../depth-explorer/models.ts'
import { availability } from '../explorer-kit/catalog.ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1' })
await host.loadSchemaFromCache()

/** the catalog entries for one map this host can run (by its cached schema) */
function runnable(which: (m: ModelEntry) => boolean): string[] {
   return MODELS.filter((m) => which(m) && availability(host.schema.data.spec, m).ok).map((m) => m.id)
}
const looks = (ids: string[]) => ({ options: Object.fromEntries(ids.map((id) => [id, optionLook(entry(id))])) })
function entry(id: string): ModelEntry {
   const m = MODELS.find((x) => x.id === id)
   if (m == null) throw new Error(`no model '${id}' in the depth explorer catalog`)
   return m
}
const pick = (ids: string[], preferred: string): string => (ids.includes(preferred) ? preferred : (ids[0] ?? preferred))

type MapName = NonNullable<ModelEntry['map']>
const ofMap = (map: MapName): string[] => runnable((m) => m.map === map)
const ids = {
   depth: runnable((m) => m.kind === 'depth'),
   normal: runnable((m) => m.kind === 'normal'),
   albedo: ofMap('albedo'),
   roughness: ofMap('roughness'),
   metalness: ofMap('metalness'),
   specular: ofMap('specular'),
   shading: ofMap('shading'),
}

/** a material map: its models, the preferred one picked, or none */
const material = (map: MapName, preferred: string, label: string) =>
   v.choice(ids[map], pick(ids[map], preferred), { label, select: 'zero-or-one' }).ui(looks(ids[map]))

const image = v.image(exampleImagePath('lioness_768x768.jpg'), {
   presets: {
      lioness: exampleImagePath('lioness_768x768.jpg'),
      bear: exampleImagePath('bear_1024x1024.jpg'),
      walrus: exampleImagePath('walrus_1344x768.jpg'),
      deer: exampleImagePath('deer_768x1344.jpg'),
      // a preset can be a url, fetched once when a run uses it:
      // 'genomea cover': 'https://www.bifocalfiction.com/images/genomea-cover-cn1.png',
      // 'dead city 1': 'https://www.bifocalfiction.com/generated/la-ville-morte-chapitre-3/horizontal/strip-01.webp',
      // 'dead city 2': 'https://www.bifocalfiction.com/generated/la-ville-morte-chapitre-3/horizontal/strip-02.webp',
      // 'dead city 3': 'https://www.bifocalfiction.com/generated/la-ville-morte-chapitre-3/horizontal/strip-03.webp',
   },
})

export const relight = host.defineWorkflow({
   id: 'relight',
   vars: {
      image,
      depth: v.choice(ids.depth, pick(ids.depth, 'da3-mono-large')).ui(looks(ids.depth)),
      normal: v.choice(ids.normal, pick(ids.normal, 'moge2-normal'), 'normals').ui(looks(ids.normal)),
      albedo: material('albedo', 'iid-albedo', 'albedo'),
      roughness: material('roughness', 'iid-roughness', 'roughness'),
      metalness: material('metalness', 'iid-metalness', 'metalness'),
      /** the non diffuse light: what shines */
      specular: material('specular', 'iid-specular', 'specular'),
      /** the diffuse light and the cast shadows: an output to look at, the widget lights without it */
      shading: material('shading', 'iid-shading', 'shadows'),
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
      for (const map of ['albedo', 'roughness', 'metalness', 'specular', 'shading'] as const) {
         const id = vars[map]
         if (id != null) save(entry(id).build(b, loaded, p), map)
      }
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
