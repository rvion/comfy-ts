// the matching core of scripts/check-banned.ts, pure so it tests without git or a subprocess
// rows: plain text = case-insensitive WORD match (anything that is not a letter or a digit is
// a break, so `folder/word`, `foo,word,bar` and `word_v2.safetensors` all hit, while a word
// glued inside a longer one does not); `re:<pattern>` = case-insensitive regex
import { existsSync, readFileSync } from 'node:fs'

export type BannedRule = { row: string; re: RegExp }
export type Hit = { where: string; keyword: string }

function escapeRegex(raw: string): string {
   return raw.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/** one matcher per row; an invalid `re:` row throws naming the row, never skips it */
export function parseBannedRows(text: string): BannedRule[] {
   const rules: BannedRule[] = []
   for (const raw of text.split('\n')) {
      const row = raw.trim()
      if (row === '' || row.startsWith('#')) continue
      if (!row.startsWith('re:')) {
         // a leaked name arrives as a path or a filename far more often than as a bare word
         rules.push({ row, re: new RegExp(`(?<![a-z0-9])${escapeRegex(row)}(?![a-z0-9])`, 'i') })
         continue
      }
      try {
         rules.push({ row, re: new RegExp(row.slice(3), 'i') })
      } catch (err) {
         throw new Error(`invalid regex row "${row}": ${String(err)}`, { cause: err })
      }
   }
   return rules
}

/** null when the file is missing: the caller warns and skips */
export function loadBannedRules(path: string): BannedRule[] | null {
   if (!existsSync(path)) return null
   return parseBannedRows(readFileSync(path, 'utf8'))
}

export function scanText(rules: BannedRule[], where: string, text: string): Hit[] {
   return rules.filter((r) => r.re.test(text)).map((r) => ({ where, keyword: r.row }))
}

/** a staged file: its path, then every line of a text content (binary content is skipped) */
export function scanFile(rules: BannedRule[], file: string, content: string): Hit[] {
   const hits = scanText(rules, `path ${file}`, file)
   if (content.includes('\0')) return hits
   const lines = content.split('\n')
   for (let i = 0; i < lines.length; i++) hits.push(...scanText(rules, `${file}:${i + 1}`, lines[i] ?? ''))
   return hits
}

/** git comment lines are not part of the commit */
export function commitMessageText(raw: string): string {
   return raw
      .split('\n')
      .filter((l) => !l.startsWith('#'))
      .join('\n')
}
