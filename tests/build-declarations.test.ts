// bun build writes one .d.ts per source file and keeps the repo-root specifiers ('src/….ts').
// a consumer cannot resolve those, so scripts/build.ts makes them relative
import { describe, expect, it } from 'bun:test'
import { join } from 'pathe'
import { rewriteDeclaration } from 'scripts/build.ts'

const dist = join(import.meta.dir, '..', 'dist')

describe('published declarations name their siblings by relative path', () => {
   it('a root file reaches a folder below it', () => {
      const text = "import { ComfyHost } from 'src/host/ComfyHost.ts';"
      expect(rewriteDeclaration({ text, fromFile: join(dist, 'state.d.ts'), ext: 'js' })).toBe(
         "import { ComfyHost } from './host/ComfyHost.js';",
      )
   })

   it('a nested file climbs out of its folder', () => {
      const text = "import { type AbsolutePath } from 'src/types/index.ts';"
      expect(rewriteDeclaration({ text, fromFile: join(dist, 'host', 'ComfyHost.d.ts'), ext: 'js' })).toBe(
         "import { type AbsolutePath } from '../types/index.js';",
      )
   })

   it('the require flavour points at .cjs, which resolves the .d.cts twin', () => {
      const text = "export * from 'src/coreExports.ts';"
      expect(rewriteDeclaration({ text, fromFile: join(dist, 'index.d.cts'), ext: 'cjs' })).toBe(
         "export * from './coreExports.cjs';",
      )
   })

   it('an inline type import and a tsx source are rewritten too', () => {
      const text = 'type A = import("src/cli/tui/components/TuiApp.tsx").Props;'
      expect(rewriteDeclaration({ text, fromFile: join(dist, 'index.d.ts'), ext: 'js' })).toBe(
         'type A = import("./cli/tui/components/TuiApp.js").Props;',
      )
   })

   it('control: a package specifier and plain text stay as they are', () => {
      const text = [
         "import { type } from 'arktype/internal/variants/object.ts';",
         "import sharp from 'sharp';",
         '/** reads src/host/ComfyHost.ts at run time */',
         "declare const where: 'src/ is the source folder';",
      ].join('\n')
      expect(rewriteDeclaration({ text, fromFile: join(dist, 'index.d.ts'), ext: 'js' })).toBe(text)
   })
})
