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
