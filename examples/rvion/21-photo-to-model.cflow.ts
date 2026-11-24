// one picture to a textured 3D model on windows-1: SAM 3 cuts the subject out by its name (one name a
// line, the masks joined), TRELLIS 2 builds one object with its back by construction (structure, shape,
// upsample, texture), then the mesh is remeshed, unwrapped and baked to a textured glb.
// source template: 3d_pixal3d_trellis2_image_to_model.json (its Trellis 2 branch)
// run directly:  bun examples/rvion/21-photo-to-model.cflow.ts [path/to/image.png] ["subject"] [seed]
import { ComfyTS, exampleImagePath, v } from 'comfy-ts'

const comfy = ComfyTS.create()
const host = comfy.host({ id: 'windows-1' })
await host.loadSchemaFromCache()

const image = v.image(exampleImagePath('bear_1024x1024.jpg'), {
   presets: {
      bear: exampleImagePath('bear_1024x1024.jpg'),
      walrus: exampleImagePath('walrus_1344x768.jpg'),
      lioness: exampleImagePath('lioness_768x768.jpg'),
   },
})

export const photoToModel = host.defineWorkflow({
   id: 'photo-to-model',
   vars: {
      image,
      /** what to cut out, one SAM 3 name a line; empty: the image already is the subject on black */
      subject: v.text('bear'),
      /** textured: the whole pipeline; shape: the untextured mesh only, about a third of the time */
      model: v.choice(['textured', 'shape'], 'textured', 'model'),
      seed: v.seed(42),
   },
   build: async (b, vars, wf) => {
      const picture = await image.loadInWorkflow(wf)
      const names = vars.subject.split('\n').map((s) => s.trim()).filter((s) => s !== '')
      const masks = names.map(
         (prompt) => b['rmbg.SAM3Segment']({ image: picture, model_name: 'sam3', prompt, output_mode: 'Merged', confidence_threshold: 0.2 }).outputs.MASK,
      )
      type Mask = (typeof masks)[number] | ReturnType<typeof b.MaskComposite>['outputs']['MASK']
      const first = masks[0]
      // the template's preprocessing: a square crop round the subject, 1.1 margin, on black
      const cutout =
         first == null
            ? picture.outputs.IMAGE
            : b.ImageCropToMask({
                 images: picture,
                 masks: masks.slice(1).reduce<Mask>((acc, m) => b.MaskComposite({ destination: acc, source: m, x: 0, y: 0, operation: 'or' }).outputs.MASK, first),
                 width: 1024,
                 height: 1024,
                 pad_factor: 1.1,
                 grow_mask: 0,
                 background: '#000000',
              }).outputs.images
      b.SaveImageWebsocket({ images: cutout }, { tag: 'cutout' })

      const unet = b.UNETLoader({ unet_name: 'trellis_2_int8_convrot.safetensors', weight_dtype: 'default' })
      const shapeVae = b.VAELoader({ vae_name: 'trellis_2_shape_vae_bf16.safetensors' })
      const cond = b.Trellis2Conditioning({
         clip_vision_model: b.CLIPVisionLoader({ clip_name: 'dino_v3_L_naf_fp32.safetensors' }),
         image: cutout,
      })
      // cfg override and rescale match the upstream pipeline's defaults (the template's own note)
      const guided = (start: number, rescale: number) =>
         b.RescaleCFG({ model: b.CFGOverride({ model: unet, cfg: 1, start_percent: start, end_percent: 1 }), multiplier: rescale })
      const structure = b.KSampler({
         model: b.ModelSamplingSD3({ model: guided(0.667, 0.7), shift: 5 }),
         positive: cond.outputs.positive,
         negative: cond.outputs.negative,
         latent_image: b.EmptyTrellis2LatentStructure({ batch_size: 1 }),
         seed: vars.seed + 14,
         steps: 12,
         cfg: 7.5,
         sampler_name: 'euler',
         scheduler: 'normal',
         denoise: 1,
      })
      const shapeStage = b.Trellis2ShapeStage({
         positive: cond.outputs.positive,
         negative: cond.outputs.negative,
         voxel: b.VaeDecodeStructureTrellis2({ samples: structure, vae: shapeVae, resolution: '32' }),
      })
      const shapeModel = guided(0.769, 0.5)
      const shape512 = b.KSampler({
         model: shapeModel,
         positive: shapeStage.outputs.positive,
         negative: shapeStage.outputs.negative,
         latent_image: shapeStage.outputs.LATENT,
         seed: vars.seed,
         steps: 20,
         cfg: 7.5,
         sampler_name: 'euler',
         scheduler: 'normal',
         denoise: 1,
      })
      const upsample = b.Trellis2UpsampleStage({
         positive: shapeStage.outputs.positive,
         negative: shapeStage.outputs.negative,
         shape_latent: shape512,
         vae: shapeVae,
         target_resolution: 1536,
      })
      const shapeHi = b.KSampler({
         model: shapeModel,
         positive: upsample.outputs.positive,
         negative: upsample.outputs.negative,
         latent_image: upsample.outputs.LATENT,
         seed: vars.seed,
         steps: 12,
         cfg: 7.5,
         sampler_name: 'euler',
         scheduler: 'simple',
         denoise: 1,
      })
      const shape = b.VaeDecodeShapeTrellis({ samples: shapeHi, vae: shapeVae })
      // the raw shape, before remesh: what a geometry refiner aligned to the cutout takes
      b.SaveGLB({ mesh: shape.outputs.mesh, filename_prefix: 'comfy-ts/photo-to-model-shape' }, { tag: 'shape' })
      // four sides and the top, as the model is (views) and as clay (shape), to judge the geometry alone
      const views = (mesh: typeof shape.outputs.mesh, modes: ('auto' | 'solid')[]) => {
         const first = b.CreateCameraInfo({ mode: 'orbit', 'mode.yaw': 0, 'mode.pitch': 15, 'mode.distance': 1.15, camera_type: 'perspective', mesh })
         const cameras = b.CreateCameraOrbit({ camera_info: first, count: 4, yaw: 360, pitch: 0, poles: 'top' })
         for (const mode of modes) {
            const render = b.RenderMesh({ mesh, mode, width: 768, height: 768, background: '#808080', camera_info: cameras })
            b.SaveImageWebsocket({ images: render.outputs.image }, { tag: mode === 'auto' ? 'views' : 'clay' })
         }
      }
      if (vars.model === 'shape') return views(shape.outputs.mesh, ['solid'])

      const texture = b.Trellis2TextureStage({ positive: upsample.outputs.positive, negative: upsample.outputs.negative, shape_latent: shapeHi })
      const textureLatent = b.KSampler({
         model: unet,
         positive: texture.outputs.positive,
         negative: texture.outputs.negative,
         latent_image: texture.outputs.LATENT,
         seed: vars.seed + 1,
         steps: 12,
         cfg: 1,
         sampler_name: 'euler',
         scheduler: 'normal',
         denoise: 1,
      })
      const colors = b.VaeDecodeTextureTrellis({
         samples: textureLatent,
         vae: b.VAELoader({ vae_name: 'trellis_2_texture_vae_bf16.safetensors' }),
         shape_subdivides: shape.outputs.shape_subdivides,
      })
      const remeshed = b.RemeshMesh({
         mesh: b.GetMeshInfo({ mesh: shape.outputs.mesh }).outputs.mesh,
         resolution: 768,
         sign_mode: 'solid',
         'sign_mode.fill': 20,
         'sign_mode.qef': false,
         band: 1,
         project_back: 0,
         fix_poles: false,
         smooth_iters: 20,
         drop_small_components: 0.01,
         precluster_max_verts: 20000000,
      })
      const decimated = b.DecimateMesh({ mesh: remeshed, target_face_count: 700000, placement_mode: 'midpoint' })
      const unwrapped = b.UnwrapMesh({
         mesh: b.MeshSmoothNormals({ mesh: decimated, crease_angle: 180 }),
         segmenter: 'pec',
         resolution: 4096,
         padding: 1,
         weld_distance: 0.0002,
      })
      const baked = b.BakeTextureFromVoxel({ mesh: unwrapped, voxel_colors: colors, texture_size: 4096, reference_mesh: shape.outputs.mesh })
      const textured = b.MeshSmoothNormals({
         mesh: b.ApplyTextureToMesh({
            mesh: unwrapped,
            base_color: baked.outputs.base_color,
            metallic: baked.outputs.metallic,
            roughness: baked.outputs.roughness,
            occlusion: b.BakeAmbientOcclusion({ low_poly: unwrapped, high_poly: remeshed, resolution: 1024, samples: 64, max_distance: 0.71, strength: 1, bias: 0.01 }),
            normal_map: b.BakeNormalMapFromMesh({ low_poly: unwrapped, high_poly: remeshed, resolution: 2048, cage_distance: 0.05, ignore_backfaces: true }),
         }),
         crease_angle: 180,
      })
      b.SaveGLB({ mesh: textured, filename_prefix: 'comfy-ts/photo-to-model' }, { tag: 'model' })
      views(textured.outputs.mesh, ['auto', 'solid'])
   },
})

export default photoToModel

if (import.meta.main) {
   if (process.argv[2]) photoToModel.vars.image.set(process.argv[2])
   if (process.argv[3] != null) photoToModel.vars.subject.set(process.argv[3])
   if (process.argv[4]) photoToModel.vars.seed.set(Number(process.argv[4]))
   const execution = await photoToModel.run({ log: true, save: { prefix: 'comfy-ts-example/photo-to-model' } })
   for (const img of execution.images) console.log(`🟢 ${img.tags.join(',')} ${img.absPath}`)
   for (const m of execution.models3d) console.log(`🟢 ${m.tags.join(',')} ${m.absPath}`)
   host.disconnect()
}
