import { defineConfig } from 'tsdown'

export default defineConfig([
   // the library: dual ESM/CJS + bundled dts (emitted by tsgo — typescript@7 has no JS compiler API)
   {
      entry: { index: 'src/index.ts' },
      format: ['esm', 'cjs'],
      dts: { tsgo: true },
      sourcemap: true,
      clean: true,
      treeshake: true,
      outDir: 'dist',
      target: 'es2022',
      platform: 'node',
      fixedExtension: false,
   },
   // the browser entry: ESM only (architecture item 13); platform neutral so
   // no node shims sneak in — the graph itself must be node-free (guard test)
   {
      entry: { web: 'src/web.ts' },
      format: ['esm'],
      dts: { tsgo: true },
      sourcemap: true,
      clean: false,
      treeshake: true,
      outDir: 'dist',
      target: 'es2022',
      platform: 'neutral',
      fixedExtension: false,
   },
   // the sidekick CLI: single ESM bin
   {
      entry: { cli: 'src/cli/comfy-ts-cli.ts' },
      format: ['esm'],
      dts: false,
      sourcemap: true,
      clean: false,
      outDir: 'dist',
      target: 'es2022',
      platform: 'node',
      fixedExtension: false,
   },
])
