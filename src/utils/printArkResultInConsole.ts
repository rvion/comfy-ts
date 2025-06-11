import type { ArkErrors } from 'arktype'
import chalk from 'chalk'

export function printArkResultInConsole(res: ArkErrors) {
   console.log(chalk.red('   ❌ Ark validation failed:'))
   for (const error of res) {
      console.log(chalk.red(`   - ${error.path.join('.')} : ${error.message}`))
   }
   console.log(chalk.red(`   - ${res.length} errors found`))
}
