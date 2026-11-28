// writes dist/, what npm publishes: the library (esm + cjs), the web entry, the cli, the serve
// panel bundle and the type declarations. bun build does all of it; the one step it leaves is the
// declarations, which come out as one .d.ts per source file with repo-root specifiers
// ('src/host/ComfyHost.ts'). a consumer cannot resolve those, so they are rewritten to relative ones.
import { chmodSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'pathe'
import { buildWebJsText } from 'src/cli/serve/webBundle.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(repoRoot, 'dist')

// src/state.ts imports package.json for its version, and bun inlines a json import whole:
// keywords, scripts and the author line would land in every bundle
const packageVersionOnly: Bun.BunPlugin = {
   name: 'package-version-only',
   setup(build) {
      build.onLoad({ filter: /[\\/]package\.json$/ }, (args) => {
         if (args.path !== join(repoRoot, 'package.json')) return undefined
         const pkg = JSON.parse(readFileSync(args.path, 'utf8')) as { version: string }
         return { contents: JSON.stringify({ version: pkg.version }), loader: 'json' }
      })
   },
}

type Bundle = {
   label: string
   entry: string
   target: 'node' | 'browser'
   format: 'esm' | 'cjs'
   entryName?: string
   splitting?: boolean
}

// a cjs bundle has no import.meta: bun replaces import.meta.url with the SOURCE file's url, the
// build machine's own path. the bundle's own location is what the code means (exampleAssets.ts
// walks up from it to the package), so it is read from __filename when the bundle loads
const CJS_META_URL = '__comfyTsBundleUrl'
const CJS_BANNER = `var ${CJS_META_URL} = require("node:url").pathToFileURL(__filename).href;`

async function bundle(p: Bundle): Promise<void> {
   const built = await Bun.build({
      entrypoints: [join(repoRoot, p.entry)],
      outdir: dist,
      target: p.target,
      format: p.format,
      packages: 'external',
      sourcemap: 'linked',
      splitting: p.splitting ?? false,
      naming: p.entryName == null ? undefined : { entry: p.entryName },
      plugins: [packageVersionOnly],
      // the dev jsx runtime is undefined in react's production build: the TUI would crash under NODE_ENV=production
      jsx: { runtime: 'automatic', development: false },
      define: p.format === 'cjs' ? { 'import.meta.url': CJS_META_URL } : undefined,
      banner: p.format === 'cjs' ? CJS_BANNER : undefined,
   })
   if (built.success) return
   for (const log of built.logs) console.error(log)
   throw new Error(`build: ${p.label} failed`)
}

/** one .d.ts per source file under `outdir`; --dts also type checks, so a type error stops the build */
function emitDeclarations(outdir: string): void {
   const run = Bun.spawnSync(
      [process.execPath, 'build', 'src/index.ts', 'src/web.ts', '--dts', '--outdir', outdir, '--target', 'node', '--packages', 'external'],
      { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' },
   )
   if (run.exitCode === 0) return
   console.error(run.stdout.toString())
   console.error(run.stderr.toString())
   throw new Error(`build: the declarations failed with exit code ${run.exitCode}`)
}

function allFiles(dir: string): string[] {
   const out: string[] = []
   for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...allFiles(path))
      else out.push(path)
   }
   return out
}

/** what a published file must never hold: each one was a real defect of a bun bundle */
const FORBIDDEN_IN_DIST: { text: string; why: string }[] = [
   { text: repoRoot, why: "the build machine's path: it resolves on this machine only" },
   { text: 'react/jsx-dev-runtime', why: "react's dev jsx runtime: undefined under NODE_ENV=production" },
]

function assertPublishable(): void {
   const hits: string[] = []
   for (const file of allFiles(dist)) {
      const text = readFileSync(file, 'utf8')
      for (const bad of FORBIDDEN_IN_DIST) {
         if (text.includes(bad.text)) hits.push(`${relative(repoRoot, file)} holds ${bad.why}`)
      }
   }
   if (hits.length > 0) throw new Error(`build: dist/ is not publishable\n${hits.join('\n')}`)
}

function declarationFiles(dir: string): string[] {
   const out: string[] = []
   for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...declarationFiles(path))
      else if (entry.name.endsWith('.d.ts')) out.push(path)
   }
   return out
}

/** 'src/host/ComfyHost.ts' as seen from one declaration file, with the extension its module kind resolves */
export function relativeSpecifier(p: { fromFile: string; target: string; ext: 'js' | 'cjs' }): string {
   const targetFile = join(dist, p.target.replace(/^src\//, '').replace(/\.tsx?$/, `.${p.ext}`))
   const rel = relative(dirname(p.fromFile), targetFile)
   return rel.startsWith('.') ? rel : `./${rel}`
}

/** every `'src/….ts'` specifier of a declaration text, made relative */
export function rewriteDeclaration(p: { text: string; fromFile: string; ext: 'js' | 'cjs' }): string {
   return p.text.replaceAll(/(['"])(src\/[^'"\n]+\.tsx?)\1/g, (_all, quote: string, target: string) => {
      return `${quote}${relativeSpecifier({ fromFile: p.fromFile, target, ext: p.ext })}${quote}`
   })
}

async function main(): Promise<void> {
   rmSync(dist, { recursive: true, force: true })

   await bundle({ label: 'library esm', entry: 'src/index.ts', target: 'node', format: 'esm' })
   await bundle({ label: 'library cjs', entry: 'src/index.ts', target: 'node', format: 'cjs', entryName: '[name].cjs' })
   // target browser: the web entry must stay free of node builtins (architecture item 13)
   await bundle({ label: 'web entry', entry: 'src/web.ts', target: 'browser', format: 'esm' })
   await bundle({ label: 'cli', entry: 'src/cli/comfy-ts-cli.ts', target: 'node', format: 'esm', entryName: 'cli.js', splitting: true })
   chmodSync(join(dist, 'cli.js'), 0o755)

   // the declaration run also writes bundles: only its .d.ts files are kept
   const scratch = mkdtempSync(join(tmpdir(), 'comfy-ts-dts-'))
   emitDeclarations(scratch)
   const emitted = declarationFiles(scratch)
   for (const file of emitted) cpSync(file, join(dist, file.slice(scratch.length + 1)), { recursive: true })
   rmSync(scratch, { recursive: true, force: true })

   // a .d.ts in a "type": "module" package is an esm declaration: a require() consumer needs
   // the same tree as .d.cts, or its type check refuses the import
   const files = declarationFiles(dist)
   for (const file of files) {
      const text = readFileSync(file, 'utf8')
      writeFileSync(file, rewriteDeclaration({ text, fromFile: file, ext: 'js' }))
      writeFileSync(file.replace(/\.d\.ts$/, '.d.cts'), rewriteDeclaration({ text, fromFile: file, ext: 'cjs' }))
   }

   const webJs = await buildWebJsText(repoRoot)
   writeFileSync(join(dist, 'serve-web.js'), webJs)
   assertPublishable()
   console.log(`dist/: ${files.length} declaration files, serve-web.js ${(webJs.length / 1024).toFixed(0)} kB`)
}

if (import.meta.main) await main()
