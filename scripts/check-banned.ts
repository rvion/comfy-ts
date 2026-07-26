// commit guard: rejects commits containing keywords from .rv-private/banned-keywords.txt
// usage: check-banned.ts --staged        (pre-commit: staged contents + staged paths)
//        check-banned.ts --msg <file>    (commit-msg: the commit message)
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'pathe'

const KEYWORDS_FILE = '.rv-private/banned-keywords.txt'

function git(args: string[]): string {
   const res = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
   if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
   return res.stdout
}

type Hit = { where: string; keyword: string }

function main(): void {
   const mode = process.argv[2]
   const repoRoot = git(['rev-parse', '--show-toplevel']).trim()

   const keywordsPath = join(repoRoot, KEYWORDS_FILE)
   if (!existsSync(keywordsPath)) {
      console.warn(`⚠ ${KEYWORDS_FILE} not found — banned-keywords check SKIPPED`)
      return
   }
   const keywords = readFileSync(keywordsPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
   if (keywords.length === 0) return

   const hits: Hit[] = []
   const scan = (p: { where: string; text: string }): void => {
      const low = p.text.toLowerCase()
      for (const kw of keywords) {
         if (low.includes(kw.toLowerCase())) hits.push({ where: p.where, keyword: kw })
      }
   }

   if (mode === '--staged') {
      const files = git(['-C', repoRoot, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
         .split('\0')
         .filter((f) => f !== '')
      for (const file of files) {
         scan({ where: `path ${file}`, text: file })
         const content = git(['-C', repoRoot, 'show', `:0:${file}`])
         if (content.includes('\0')) continue // binary: path checked above, content skipped
         const lines = content.split('\n')
         for (let i = 0; i < lines.length; i++) scan({ where: `${file}:${i + 1}`, text: lines[i] ?? '' })
      }
   } else if (mode === '--msg') {
      const msgFile = process.argv[3]
      if (msgFile == null) throw new Error('--msg requires the commit message file path')
      const msg = readFileSync(msgFile, 'utf8')
         .split('\n')
         .filter((l) => !l.startsWith('#')) // git comment lines are not part of the commit
         .join('\n')
      scan({ where: 'commit message', text: msg })
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
