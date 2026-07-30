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

   test('re: rows match as case-insensitive regex (api-key shapes)', () => {
      const dir = makeRepo({ keywords: 're:comfyui-[a-z0-9]{16,}\n' })
      // key shape assembled at runtime so THIS repo's own guard never sees a literal
      writeFileSync(join(dir, 'a.ts'), `const key = "${'comfyui-' + 'deadbeef'.repeat(4)}"\n`)
      spawnSync('git', ['add', 'a.ts'], { cwd: dir })
      const res = run({ cwd: dir, args: ['--staged'] })
      expect(res.status).toBe(1)
      expect(res.stderr).toContain('a.ts:1')
   })

   test('re: rows do NOT match legit prefixed names (ComfyUI-Manager)', () => {
      const dir = makeRepo({ keywords: 're:comfyui-[a-z0-9]{16,}\n' })
      writeFileSync(join(dir, 'a.ts'), 'import { x } from "ComfyUI-Manager"\nconst y = "comfyui-frontend-master"\n')
      spawnSync('git', ['add', 'a.ts'], { cwd: dir })
      const res = run({ cwd: dir, args: ['--staged'] })
      expect(res.status).toBe(0)
   })

   test('re: rows apply to the commit message too', () => {
      const dir = makeRepo({ keywords: 're:comfyui-[a-z0-9]{16,}\n' })
      const msg = join(dir, 'MSG')
      writeFileSync(msg, `oops leaked ${'COMFYUI-' + 'a1b2'.repeat(5)} in the message\n`)
      const res = run({ cwd: dir, args: ['--msg', msg] })
      expect(res.status).toBe(1)
      expect(res.stderr).toContain('commit message')
   })

   test('invalid re: row fails LOUDLY instead of silently skipping', () => {
      const dir = makeRepo({ keywords: 're:[unclosed\n' })
      writeFileSync(join(dir, 'a.ts'), 'clean\n')
      spawnSync('git', ['add', 'a.ts'], { cwd: dir })
      const res = run({ cwd: dir, args: ['--staged'] })
      expect(res.status).not.toBe(0)
      expect(res.stderr).toContain('re:[unclosed')
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
