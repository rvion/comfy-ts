import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'check-banned.ts')

function makeRepo(p: { keywords?: string }): string {
   const dir = mkdtempSync(join(tmpdir(), 'check-banned-'))
   spawnSync('git', ['init', '-q'], { cwd: dir })
   if (p.keywords != null) {
      mkdirSync(join(dir, '.rv-private'), { recursive: true })
      writeFileSync(join(dir, '.rv-private/banned-keywords.txt'), p.keywords)
   }
   return dir
}

function run(p: { cwd: string; args: string[] }) {
   return spawnSync('bun', [SCRIPT, ...p.args], { cwd: p.cwd, encoding: 'utf8' })
}

describe('check-banned', () => {
   test('rejects staged CONTENT containing a banned keyword (case-insensitive)', () => {
      const dir = makeRepo({ keywords: '# comment\nMySecretLora\n' })
      writeFileSync(join(dir, 'a.ts'), 'const x = "mysecretlora_v2.safetensors"\n')
      spawnSync('git', ['add', 'a.ts'], { cwd: dir })
      const res = run({ cwd: dir, args: ['--staged'] })
      expect(res.status).toBe(1)
      expect(res.stderr).toContain('a.ts:1')
      expect(res.stderr).toContain('MySecretLora')
   })

   test('rejects staged PATH containing a banned keyword', () => {
      const dir = makeRepo({ keywords: 'secret-input\n' })
      writeFileSync(join(dir, 'secret-input-photo.txt'), 'clean content\n')
      spawnSync('git', ['add', '.'], { cwd: dir })
      const res = run({ cwd: dir, args: ['--staged'] })
      expect(res.status).toBe(1)
      expect(res.stderr).toContain('path secret-input-photo.txt')
   })

   test('passes a clean stage', () => {
      const dir = makeRepo({ keywords: 'MySecretLora\n' })
      writeFileSync(join(dir, 'a.ts'), 'const x = 1\n')
      spawnSync('git', ['add', 'a.ts'], { cwd: dir })
      const res = run({ cwd: dir, args: ['--staged'] })
      expect(res.status).toBe(0)
   })

   test('rejects a commit MESSAGE containing a banned keyword, ignoring # lines', () => {
      const dir = makeRepo({ keywords: 'MySecretLora\n' })
      const msg = join(dir, 'MSG')
      writeFileSync(msg, 'feat: add mysecretlora preset\n# comment\n')
      const res = run({ cwd: dir, args: ['--msg', msg] })
      expect(res.status).toBe(1)
      expect(res.stderr).toContain('commit message')

      writeFileSync(msg, 'feat: clean\n# mysecretlora only in a git comment line\n')
      const res2 = run({ cwd: dir, args: ['--msg', msg] })
      expect(res2.status).toBe(0)
   })

   test('missing keywords file: loud warning, passes', () => {
      const dir = makeRepo({})
      writeFileSync(join(dir, 'a.ts'), 'whatever\n')
      spawnSync('git', ['add', 'a.ts'], { cwd: dir })
      const res = run({ cwd: dir, args: ['--staged'] })
      expect(res.status).toBe(0)
      expect(res.stderr + res.stdout).toContain('SKIPPED')
   })
})
