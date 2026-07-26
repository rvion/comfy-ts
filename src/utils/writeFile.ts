import { writeFile } from 'node:fs'
import { ansi as chalk } from 'src/utils/ansi.ts'
import { logInfo } from 'src/utils/log.ts'

export const writeFileAsync = async (path: string, data: string, fmt: 'utf-8') => {
   return new Promise<void>((resolve, reject) => {
      logInfo(`writing file: ${chalk.blue(path)}`)
      writeFile(path, data, fmt, (err) => {
         if (err) {
            reject(err)
         } else {
            resolve()
         }
      })
   })
}
