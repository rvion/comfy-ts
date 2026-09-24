import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { commitMessageText, loadBannedRules, parseBannedRows, scanFile, scanText } from 'scripts/bannedKeywords.ts'

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'check-banned.ts')
// key shapes assembled at runtime so THIS repo's own guard never sees a literal
const API_KEY_ROW = 're:comfyui-[a-z0-9]{16,}'

describe('banned keyword matching', () => {
   test('content hits case-insensitively and names the file and line; # rows are comments', () => {
      const rules = parseBannedRows('# comment\nMySecretLora\n')
      expect(rules.map((r) => r.row)).toEqual(['MySecretLora'])
      const hits = scanFile(rules, 'a.ts', 'ok\nconst x = "mysecretlora_v2.safetensors"\n')
      expect(hits).toEqual([{ where: 'a.ts:2', keyword: 'MySecretLora' }])
   })

   test('a PATH carrying a keyword hits even with clean content', () => {
      const hits = scanFile(parseBannedRows('secret-input\n'), 'secret-input-photo.txt', 'clean content\n')
      expect(hits).toEqual([{ where: 'path secret-input-photo.txt', keyword: 'secret-input' }])
   })

   test('clean content passes, and a word glued inside a longer one does not hit', () => {
      const rules = parseBannedRows('MySecretLora\n')
      expect(scanFile(rules, 'a.ts', 'const x = 1\n')).toEqual([])
      expect(scanText(rules, 'x', 'notmysecretloraatall')).toEqual([])
   })

   test('binary content is skipped, its path is still checked', () => {
      const rules = parseBannedRows('MySecretLora\n')
      expect(scanFile(rules, 'img.png', 'MySecretLora\0\0')).toEqual([])
      expect(scanFile(rules, 'MySecretLora.png', '\0')).toHaveLength(1)
   })

   test('a commit message drops git comment lines before matching', () => {
      const rules = parseBannedRows('MySecretLora\n')
      expect(scanText(rules, 'commit message', commitMessageText('feat: add mysecretlora preset\n# c\n'))).toHaveLength(
         1,
      )
      expect(
         scanText(rules, 'commit message', commitMessageText('feat: clean\n# mysecretlora in a comment\n')),
      ).toEqual([])
   })

   test('re: rows match as case-insensitive regex, in content and in messages', () => {
      const rules = parseBannedRows(`${API_KEY_ROW}\n`)
      expect(scanText(rules, 'a.ts:1', `const key = "${'comfyui-' + 'deadbeef'.repeat(4)}"`)).toHaveLength(1)
      expect(scanText(rules, 'commit message', `oops ${'COMFYUI-' + 'a1b2'.repeat(5)} leaked`)).toHaveLength(1)
   })

   test('re: rows do NOT match legit prefixed names (ComfyUI-Manager)', () => {
      const rules = parseBannedRows(`${API_KEY_ROW}\n`)
      expect(
         scanFile(rules, 'a.ts', 'import { x } from "ComfyUI-Manager"\nconst y = "comfyui-frontend-master"\n'),
      ).toEqual([])
   })

   test('an invalid re: row fails LOUDLY, naming the row', () => {
      expect(() => parseBannedRows('re:[unclosed\n')).toThrow('re:[unclosed')
   })

   test('a missing keywords file is null, so the hook warns and skips', () => {
      expect(loadBannedRules(join(tmpdir(), 'no-such-dir-for-banned', 'banned-keywords.txt'))).toBeNull()
   })
})

describe('check-banned hook, end to end through git', () => {
   test('a staged content hit and a staged path hit reject the commit', () => {
      const dir = mkdtempSync(join(tmpdir(), 'check-banned-'))
      spawnSync('git', ['init', '-q'], { cwd: dir })
      mkdirSync(join(dir, '.shipkit/private'), { recursive: true })
      writeFileSync(join(dir, '.shipkit/private/banned-keywords.txt'), 'MySecretLora\nsecret-input\n')
      writeFileSync(join(dir, 'a.ts'), 'const x = "mysecretlora_v2.safetensors"\n')
      writeFileSync(join(dir, 'secret-input-photo.txt'), 'clean\n')
      spawnSync('git', ['add', 'a.ts', 'secret-input-photo.txt'], { cwd: dir })
      const res = spawnSync('bun', [SCRIPT, '--staged'], { cwd: dir, encoding: 'utf8' })
      expect(res.status).toBe(1)
      expect(res.stderr).toContain('a.ts:1')
      expect(res.stderr).toContain('path secret-input-photo.txt')
   })
})
