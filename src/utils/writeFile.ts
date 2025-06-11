import { writeFile } from 'node:fs'
import chalk from 'chalk'

export const writeFileAsync = async (path: string, data: string, fmt: 'utf-8') => {
   return new Promise<void>((resolve, reject) => {
      console.log(`writing file: ${chalk.blue(path)}`)
      writeFile(path, data, fmt, (err) => {
         if (err) {
            reject(err)
         } else {
            resolve()
         }
      })
   })
}
