// proves the package as a consumer gets it: packs dist/ as it stands, installs the tarball in an
// empty project, then type checks an esm, a cjs and a web import of it and loads all three in node.
// needs the network (it installs the dependencies), so it is a release step, never a test.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function run(label: string, cmd: string[], cwd: string): string {
   const done = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
   const out = `${done.stdout.toString()}${done.stderr.toString()}`
   if (done.exitCode !== 0) throw new Error(`check-package: ${label} failed (exit ${done.exitCode})\n${out}`)
   return out
}

const IS_ANY = 'type IsAny<T> = 0 extends 1 & T ? true : false'
const FILES: Record<string, string> = {
   'package.json': '{ "name": "consumer", "private": true, "type": "module" }',
   'tsconfig.json': JSON.stringify({
      compilerOptions: {
         module: 'nodenext',
         moduleResolution: 'nodenext',
         target: 'es2022',
         strict: true,
         noEmit: true,
         skipLibCheck: true,
         types: ['node'],
      },
      include: ['esm.ts', 'cjs.cts', 'web.ts'],
   }),
   // a type that resolved to any would accept the bad call: the expect-error line then fails the check
   'esm.ts': [
      "import { ComfyTS, type ComfyHost } from 'comfy-ts'",
      IS_ANY,
      "export const typed: IsAny<typeof ComfyTS> extends true ? never : 'typed' = 'typed'",
      "export const host: ComfyHost<'h'> = ComfyTS.create().host({ id: 'h', host: '127.0.0.1', port: 8188 })",
      '// @ts-expect-error a host id is a string',
      'ComfyTS.create().host({ id: 42 })',
   ].join('\n'),
   'cjs.cts': [
      "import comfyts = require('comfy-ts')",
      IS_ANY,
      "const typed: IsAny<typeof comfyts.ComfyTS> extends true ? never : 'typed' = 'typed'",
      '// @ts-expect-error a host id is a string',
      'comfyts.ComfyTS.create().host({ id: 42 })',
      'export = { typed }',
   ].join('\n'),
   'web.ts': [
      "import { ComfyTS } from 'comfy-ts/web'",
      IS_ANY,
      "export const typed: IsAny<typeof ComfyTS> extends true ? never : 'typed' = 'typed'",
   ].join('\n'),
   'run.mjs': [
      "import { createRequire } from 'node:module'",
      "const esm = await import('comfy-ts')",
      "const web = await import('comfy-ts/web')",
      "const cjs = createRequire(import.meta.url)('comfy-ts')",
      "if (typeof esm.ComfyTS !== 'function' || typeof cjs.ComfyTS !== 'function' || typeof web.ComfyTS !== 'function') throw new Error('an entry has no ComfyTS')",
      "const names = (m) => Object.keys(m).sort().join(',')",
      "if (names(esm) !== names(cjs)) throw new Error('the esm and cjs entries export different names')",
      'console.log(`exports: esm ${Object.keys(esm).length}, cjs ${Object.keys(cjs).length}, web ${Object.keys(web).length}`)',
   ].join('\n'),
}

const work = mkdtempSync(join(tmpdir(), 'comfy-ts-check-package-'))
try {
   const packDir = join(work, 'pack')
   const consumer = join(work, 'consumer')
   mkdirSync(packDir)
   mkdirSync(consumer)
   run('pack', [process.execPath, 'pm', 'pack', '--destination', packDir], repoRoot)
   const tarball = readdirSync(packDir).find((f) => f.endsWith('.tgz'))
   if (tarball == null) throw new Error('check-package: bun pm pack wrote no tarball')
   for (const [name, text] of Object.entries(FILES)) writeFileSync(join(consumer, name), text)
   run('install', [process.execPath, 'add', join(packDir, tarball), '@types/node'], consumer)
   run('type check', [process.execPath, 'check'], consumer)
   const node = Bun.which('node')
   if (node == null) throw new Error('check-package: node is not on PATH, and the package must load in node')
   console.log(run('load in node', [node, 'run.mjs'], consumer).trim())
   // the usage text is the proof the bin loads: the cli prints it and exits 1 when no command ran
   const cli = Bun.spawnSync([node, 'node_modules/.bin/comfy-ts', '--help'], { cwd: consumer, stdout: 'pipe', stderr: 'pipe' })
   const usage = `${cli.stdout.toString()}${cli.stderr.toString()}`
   if (!usage.includes('comfy-ts gen --id')) throw new Error(`check-package: the cli did not print its usage in node\n${usage}`)
   console.log(`ok: ${tarball} installs, types in esm, cjs and web, loads and runs its cli in node`)
} finally {
   rmSync(work, { recursive: true, force: true })
}
