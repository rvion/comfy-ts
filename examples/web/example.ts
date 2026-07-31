// comfy-ts/web in a real browser page: connect to a ComfyUI host, build a
// txt2img graph, run it, show the image — no server between the page and
// Comfy. The host must allow browser origins:
//    python main.py --enable-cors-header '*'
// (Comfy Cloud sends no CORS headers today — cloud rides `comfy-ts serve`.)
import { ComfyTS } from 'comfy-ts/web'

const comfy = ComfyTS.create()

function el<T extends HTMLElement>(id: string): T {
   const hit = document.getElementById(id)
   if (hit == null) throw new Error(`missing #${id}`)
   return hit as T
}

/** a LIVE host has whatever nodes it has — resolve or fail loud by name */
function node<T>(factory: T | undefined, name: string): T {
   if (factory == null) throw new Error(`this host has no ${name} node`)
   return factory
}

const status = el<HTMLDivElement>('status')
const output = el<HTMLImageElement>('output')

async function generate(): Promise<void> {
   const url = el<HTMLInputElement>('host').value.trim()
   const prompt = el<HTMLTextAreaElement>('prompt').value
   const ckptName = el<HTMLInputElement>('ckpt').value.trim()
   status.textContent = 'connecting…'
   try {
      // one host per url; re-clicking with the same url reuses the connection
      const host = comfy.host({ id: `web-${url}`, url })
      await host.connect()

      const wf = host.workflow()
      const b = wf.builderBase
      const ckpt = node(b.CheckpointLoaderSimple, 'CheckpointLoaderSimple')({ ckpt_name: ckptName })
      const latent = node(b.EmptyLatentImage, 'EmptyLatentImage')({ width: 512, height: 512, batch_size: 1 })
      const sampled = node(
         b.KSampler,
         'KSampler',
      )({
         model: ckpt,
         positive: node(b.CLIPTextEncode, 'CLIPTextEncode')({ clip: ckpt, text: prompt }),
         negative: node(b.CLIPTextEncode, 'CLIPTextEncode')({ clip: ckpt, text: 'blurry, low quality' }),
         latent_image: latent,
         sampler_name: 'euler',
         scheduler: 'normal',
         seed: Math.floor(Math.random() * 2 ** 32),
         steps: 20,
         cfg: 7,
         denoise: 1,
      })
      node(b.SaveImage, 'SaveImage')({ images: node(b.VAEDecode, 'VAEDecode')({ samples: sampled, vae: ckpt }) })

      const execution = await wf.run({
         onProgress: (p) => {
            status.textContent = `${p.percent.toFixed(0)}%${p.nodeName ? ` · ${p.nodeName}` : ''}`
         },
      })
      const img = execution.images[0]
      if (img == null) throw new Error(`no image came back (status: ${execution.status})`)
      output.src = URL.createObjectURL(img.getAsBlob())
      status.textContent = `done · ${img.filename}`
   } catch (e) {
      status.textContent = String(e)
      throw e // loud in the console too
   }
}

el<HTMLButtonElement>('generate').onclick = (): void => void generate()
