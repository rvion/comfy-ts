// makes the project the trailer's live shots run in, outside this repo so its local state (.comfy-ts/ with the
// host's schema) never sits in the tree: the workflow module, a CLAUDE.md with the agent line, and comfy-ts
// resolved to this checkout.
//   bun trailer/comfy-ts/stage/make.ts [dir]   (default /tmp/my-project)
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'fs'
import { join, resolve } from 'path'

const dir = resolve(process.argv[2] ?? '/tmp/my-project')
const repo = resolve(import.meta.dir, '../../..')

rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true })
cpSync(join(import.meta.dir, 'scenery.cflow.ts'), join(dir, 'scenery.cflow.ts'))
writeFileSync(join(dir, 'CLAUDE.md'), '@./node_modules/comfy-ts/guide-for-agents.md\n')
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-project', private: true, type: 'module' }, null, 2) + '\n')
// one copy of the library for the module and the cli: the checkout's source, as the repo's own tsconfig maps it
writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { 'comfy-ts': [join(repo, 'src/index.ts')] } } }, null, 2) + '\n')
symlinkSync(repo, join(dir, 'node_modules/comfy-ts'))
const bin = join(dir, 'node_modules/.bin/comfy-ts')
writeFileSync(bin, `#!/bin/sh\nexec bun ${join(repo, 'src/cli/comfy-ts-cli.ts')} "$@"\n`)
chmodSync(bin, 0o755)
console.log(dir)
