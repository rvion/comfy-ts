import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { bunPackList } from 'tests/packList.ts'

/**
 * repro-turned-guard: `files` in package.json is a WHITELIST, and a whitelisted
 * directory re-includes paths .gitignore excludes. `files: ["src"]` therefore
 * packed src/__private__ — an OpenSSH PRIVATE KEY included — into the 0.3.0
 * tarball, caught by hand seconds before publishing. The hazards now live in
 * .shipkit/private/ (outside every whitelisted dir); this test is what keeps the
 * guarantee mechanical instead of remembered. The list comes from bun's packer
 * (0.04s against npm's 2.2s); npm-tarball-parity.test.ts pins that both agree.
 */
describe('npm tarball', () => {
   it('ships dist + src + README + LICENSE, and nothing private', () => {
      const paths = bunPackList()
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
      // npm force-includes README* whatever the whitelist says: the 1.0 README
      // rework parked the old one as README.v1.md and it RODE THE TARBALL until
      // deleted at approval. Only the one true README may ever ship.
      expect(paths.filter((p) => /^README/i.test(p))).toEqual(['README.md'])
      // the TUI's no-arg discovery lists the packaged examples: they must ship
      expect(paths).toContain('examples/rvion/01-txt2img.cflow.ts')
      // bundled input images: i2i/i2v examples default to these, they must ship
      expect(paths).toContain('examples/images/dog_512x512.jpg')
   })
})
