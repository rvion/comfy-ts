import { existsSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import { ComfyHost, type ComfyHostData } from './host/ComfyHost'
import { ComfyRegistry } from './manager/ComfyRegistry'
import { type AbsolutePath, asAbsolutePath, type RelativePath } from './types'

/** singleton */
export class ComfyTS {
   constructor() {
      // ---- Global registration of cushy instance ----
      // biome-ignore lint/suspicious/noExplicitAny: global registration
      const globalHack = globalThis as any
      if ('cushy' in globalHack) throw new Error('ComfyTS instance already created')
      globalHack.cushy = this
   }

   host(data: ComfyHostData) {
      return new ComfyHost(data)
   }

   /**
    * A ComfyRegistry instance that provides access to all
    * known Comfy nodes, models, plugins, ...
    */
   registry = new ComfyRegistry({ check: false, genTypes: false })

   /** root path used to resolve things */
   rootPath: AbsolutePath = asAbsolutePath(process.cwd())

   /** root path used to resolve things */
   outputPath: AbsolutePath = asAbsolutePath(join(this.rootPath, 'output'))

   /**
    * Resolves a relative path against an absolute path.
    * @param from - The absolute path to resolve from.
    * @param relativePath - The relative path to resolve.
    * @returns The resolved absolute path.
    */
   resolve(from: AbsolutePath, relativePath: RelativePath): AbsolutePath {
      return asAbsolutePath(join(from, relativePath))
   }

   readJSON_ = <T>(absPath: AbsolutePath, def?: T): T => {
      console.log(absPath)
      const exists = existsSync(absPath)
      if (!exists) {
         if (def != null) return def
         throw new Error(`file does not exist ${absPath}`)
      }
      const str = readFileSync(absPath, 'utf8')
      const json = JSON.parse(str)
      return json
   }

   // for automatic formating of produced ComfyUI workflow
   autolayoutOpts: {
      node_hsep: number
      node_vsep: number
      forceLeft: boolean
   } = {
      node_hsep: 50,
      node_vsep: 50,
      forceLeft: false,
   }
}

declare global {
   var cushy: ComfyTS
}
