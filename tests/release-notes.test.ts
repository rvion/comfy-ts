import { describe, expect, it } from 'bun:test'
import { extractChangelogSection } from 'scripts/release.ts'

describe('extractChangelogSection', () => {
   it('extracts one section, stopping at the next version header', () => {
      const changelog = ['# pkg', '', '## 2.0.0', '', 'newer stuff', '', '## 1.0.0', '', 'older stuff', ''].join('\n')
      expect(extractChangelogSection({ changelog, version: '2.0.0' })).toBe('newer stuff')
      expect(extractChangelogSection({ changelog, version: '1.0.0' })).toBe('older stuff')
   })

   it('throws loud on a missing or empty section', () => {
      expect(() => extractChangelogSection({ changelog: '## 1.0.0\nbody', version: '9.9.9' })).toThrow('no "## 9.9.9"')
      expect(() => extractChangelogSection({ changelog: '## 1.0.0\n\n## 0.9.0\nbody', version: '1.0.0' })).toThrow(
         'is empty',
      )
   })

   it('finds every published version in the real CHANGELOG.md', async () => {
      const changelog = await Bun.file(new URL('../CHANGELOG.md', import.meta.url).pathname).text()
      for (const version of ['0.3.0', '0.4.0', '1.0.0', '1.1.0']) {
         const notes = extractChangelogSection({ changelog, version })
         expect(notes.length).toBeGreaterThan(50)
         expect(notes).not.toContain('\n## ')
      }
   })
})
