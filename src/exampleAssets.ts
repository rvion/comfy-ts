import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

/**
 * the examples/ folder shipped in the npm tarball, resolved from THIS module's
 * own location (NEVER cwd): walking up to the nearest NAMED package.json finds
 * <pkg>/examples both from a consumer's node_modules/comfy-ts/dist/ and from
 * this repo's src/. Returns null when the examples are absent (a consumer may
 * prune the folder) or when the nearest named package is not comfy-ts (the lib
 * was inlined into someone else's bundle — its examples are not on disk); no
 * package.json all the way up is a broken install and throws.
 */
export function bundledExamplesDir(moduleUrl: string = import.meta.url): string | null {
   let dir = dirname(fileURLToPath(moduleUrl))
   let prev = ''
   while (dir !== prev) {
      const pkgPath = join(dir, 'package.json')
      if (existsSync(pkgPath)) {
         let pkg: { name?: string } = {}
         try {
            pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
         } catch {
            // a malformed package.json on the walk (someone's broken fixture
            // dir) must not take the whole TUI down; treat as unnamed
         }
         if (pkg.name === 'comfy-ts') {
            const examples = join(dir, 'examples')
            return existsSync(examples) ? examples : null
         }
         if (pkg.name != null) return null
      }
      prev = dir
      dir = dirname(dir)
   }
   throw new Error(`[comfy-ts] no package.json found walking up from ${fileURLToPath(moduleUrl)}`)
}

/**
 * absolute path of a bundled `examples/images/` input image, e.g.
 * `exampleImagePath('bear_1024x1024.jpg')` — the out-of-the-box default for
 * i2i/i2v example image vars, valid from this repo AND from a consumer's
 * node_modules/comfy-ts/. Loud throw naming the path when the file is missing
 * or the package's examples/ folder was pruned.
 */
export function exampleImagePath(name: string): string {
   const examples = bundledExamplesDir()
   if (examples == null) {
      throw new Error(
         `[comfy-ts] cannot resolve bundled example image '${name}': the package's examples/ folder is not on disk`,
      )
   }
   const abs = join(examples, 'images', name)
   if (!existsSync(abs)) throw new Error(`[comfy-ts] bundled example image not found: ${abs}`)
   return abs
}
