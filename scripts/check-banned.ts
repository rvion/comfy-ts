// commit guard: rejects commits containing keywords from .shipkit/private/banned-keywords.txt
// (row syntax and matching: scripts/bannedKeywords.ts)
// usage: check-banned.ts --staged        (pre-commit: staged contents + staged paths)
//        check-banned.ts --msg <file>    (commit-msg: the commit message)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'pathe'
import {
   commitMessageText,
   loadBannedRules,
   scanFile,
   scanText,
   type BannedRule,
   type Hit,
} from 'scripts/bannedKeywords.ts'

const KEYWORDS_FILE = '.shipkit/private/banned-keywords.txt'

function git(args: string[]): string {
   const res = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
   if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
   return res.stdout
}

function main(): void {
   const mode = process.argv[2]
   const repoRoot = git(['rev-parse', '--show-toplevel']).trim()

   let rules: BannedRule[] | null
   try {
      rules = loadBannedRules(join(repoRoot, KEYWORDS_FILE))
   } catch (err) {
      console.error(`✖ ${KEYWORDS_FILE}: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(2)
   }
   if (rules == null) {
      console.warn(`⚠ ${KEYWORDS_FILE} not found — banned-keywords check SKIPPED`)
      return
   }
   if (rules.length === 0) return

   const hits: Hit[] = []
   if (mode === '--staged') {
      const files = git(['-C', repoRoot, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
         .split('\0')
         .filter((f) => f !== '')
      for (const file of files) hits.push(...scanFile(rules, file, git(['-C', repoRoot, 'show', `:0:${file}`])))
   } else if (mode === '--msg') {
      const msgFile = process.argv[3]
      if (msgFile == null) throw new Error('--msg requires the commit message file path')
      hits.push(...scanText(rules, 'commit message', commitMessageText(readFileSync(msgFile, 'utf8'))))
   } else {
      throw new Error(`unknown mode: ${String(mode)} (expected --staged or --msg <file>)`)
   }

   if (hits.length > 0) {
      console.error(`✖ COMMIT REJECTED — banned keywords found (list: ${KEYWORDS_FILE}):`)
      for (const h of hits) console.error(`   ${h.where} → "${h.keyword}"`)
      console.error('remove them (or edit the banned list). bypass: git commit --no-verify')
      process.exit(1)
   }
}

main()
