import chalk from 'chalk'

import { ComfyRegistry } from './ComfyRegistry'

const skipDL = process.argv.includes('--skip-download')

console.clear()
console.log(chalk.bold.greenBright('UPDADING COMFY MANAGER JSONS'))

// should take care of the code generation
await ComfyRegistry.DownloadAndUpdate(!skipDL)
