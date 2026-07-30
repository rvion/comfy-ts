import { ansi as chalk } from 'src/utils/ansi.ts'

/** root shape of a manager mirror file is broken: nothing to salvage, fail loud */
export class ManagerParseError extends Error {
   constructor(
      public file: string,
      public detail: string,
   ) {
      super(`🔴 [manager] ${file} root shape invalid: ${detail}`)
      this.name = 'ManagerParseError'
   }
}

export class FileParseCounter {
   total = 0
   accepted = 0
   skipped = new Map<string, { count: number; firstError: string }>()

   constructor(public file: string) {}

   ok(): void {
      this.total++
      this.accepted++
   }

   skip(reason: string, firstError: string): void {
      this.total++
      const prev = this.skipped.get(reason)
      if (prev == null) this.skipped.set(reason, { count: 1, firstError })
      else prev.count++
   }
}

/** per-file row accounting for the manager mirror parse; printed on every registry build so upstream drift stays visible */
export class ManagerParseReport {
   counters: FileParseCounter[] = []

   file(name: string): FileParseCounter {
      const counter = new FileParseCounter(name)
      this.counters.push(counter)
      return counter
   }

   print(): void {
      console.log(chalk.bold(`[📘 registry] parse report:`))
      for (const c of this.counters) {
         const skippedTotal = [...c.skipped.values()].reduce((acc, cur) => acc + cur.count, 0)
         const headline = `   ${c.file}: ${c.total} rows, ${c.accepted} accepted, ${skippedTotal} skipped`
         console.log(skippedTotal === 0 ? headline : chalk.red(headline))
         for (const [reason, info] of c.skipped) {
            console.log(chalk.red(`      - ${reason} x${info.count}, first: ${info.firstError}`))
         }
      }
   }
}
