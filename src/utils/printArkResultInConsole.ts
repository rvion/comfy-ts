import type { ArkErrors } from 'arktype'
import { ansi as chalk } from 'src/utils/ansi.ts'
import { isQuiet } from 'src/utils/log.ts'

const MAX_PRINTED_ERRORS = 10

export function printArkResultInConsole(res: ArkErrors): void {
   if (isQuiet()) return
   console.log(chalk.red('   ❌ Ark validation failed:'))
   for (const error of res.slice(0, MAX_PRINTED_ERRORS)) {
      console.log(chalk.red(`   - ${error.path.join('.')} : ${error.message}`))
   }
   if (res.length > MAX_PRINTED_ERRORS) {
      console.log(chalk.red(`   … ${res.length - MAX_PRINTED_ERRORS} more (${res.length} total)`))
   }
}
