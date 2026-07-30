import { ansi as chalk } from 'src/utils/ansi.ts'

import { ComfyRegistry } from 'src/manager/ComfyRegistry.ts'

const skipDL = process.argv.includes('--skip-download')

console.clear()
console.log(chalk.bold.greenBright('UPDADING COMFY MANAGER JSONS'))

// should take care of the code generation
const registry = await ComfyRegistry.DownloadAndUpdate(!skipDL)

console.log(chalk.bold.greenBright('REGISTRY TOTALS'))
console.log(`   plugins (by title): ${registry.plugins_byTitle.size}`)
console.log(`   plugin repo urls:   ${registry.plugins_byFile.size}`)
console.log(`   custom node keys:   ${registry.plugins_byNodeKey.size}`)
console.log(`   models:             ${registry.knownModels.size}`)
console.log(`   alterations:        ${registry.alterations.length}`)
console.log(`   github stats:       ${registry.githubStats.size}`)

// the generator aligns its own `// x N` comments and emits trailing blank
// lines; oxfmt disagrees on both, so WITHOUT this the ci gate goes red right
// after any regeneration. Runs here, not chained in package.json: a `&&` there
// swallows this script's own flags (`--skip-download` landed on oxfmt).
const fmt = Bun.spawnSync(['oxfmt', 'src/manager/generated'], { stdout: 'inherit', stderr: 'inherit' })
if (fmt.exitCode !== 0) throw new Error(`🔴 oxfmt failed on src/manager/generated (exit ${fmt.exitCode})`)
