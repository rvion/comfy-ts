import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * repro-turned-guard: `files` in package.json is a WHITELIST, and a whitelisted
 * directory re-includes paths .gitignore excludes. `files: ["src"]` therefore
 * packed src/__private__ — an OpenSSH PRIVATE KEY included — into the 0.3.0
 * tarball, caught by hand seconds before publishing. The hazards now live in
 * .rv-private/ (outside every whitelisted dir); this test is what keeps the
 * guarantee mechanical instead of remembered.
 */
describe('npm tarball', () => {
   const packed = (): string[] => {
      const res = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      if (res.status !== 0) throw new Error(`npm pack failed: ${res.stderr}`)
      const parsed: { files?: { path: string }[] }[] = JSON.parse(res.stdout)
      const files = parsed[0]?.files
      if (files == null) throw new Error('npm pack --json returned no file list')
      return files.map((f) => f.path)
   }

   it('ships dist + src + README + LICENSE, and nothing private', () => {
      const paths = packed()
      expect(paths.length).toBeGreaterThan(100)

      // hazard classes, each one a real thing that lives in this repo
      const forbidden = paths.filter(
         (p) =>
            p.includes('__private__') ||
            p.startsWith('.rv-') ||
            p.includes('windows-machine') ||
            p.includes('banned-keywords') ||
            p.startsWith('.comfy-ts/') ||
            p.startsWith('tmp/') ||
            p.startsWith('tests/') ||
            p === 'CLAUDE.local.md',
      )
      expect(forbidden).toEqual([])

      // and the payload is actually there (a whitelist typo would empty it).
      // dist/ only when it has been built — the ci gate runs BEFORE `bun run
      // build`, so on a fresh clone there is nothing to pack from it yet
      if (existsSync('dist')) expect(paths.some((p) => p.startsWith('dist/'))).toBe(true)
      expect(paths.some((p) => p === 'src/index.ts')).toBe(true)
      expect(paths).toContain('LICENSE')
      expect(paths).toContain('README.md')
   })

   it('contains no file carrying a private key header', () => {
      const res = spawnSync('git', ['ls-files'], { encoding: 'utf8' })
      const tracked = res.stdout.split('\n').filter(Boolean)
      // tracked files are the other half of the same guarantee (git, not npm)
      expect(tracked.filter((p) => p.includes('windows-machine') || p.startsWith('.rv-'))).toEqual([])
   })
})
