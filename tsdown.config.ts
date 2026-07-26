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
