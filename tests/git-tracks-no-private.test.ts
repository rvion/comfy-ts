import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'

// the git half of tests/npm-tarball.test.ts: that one guards what npm packs, this one what git tracks
describe('git tracked files', () => {
   it('carry no private machine file', () => {
      const res = spawnSync('git', ['ls-files'], { encoding: 'utf8' })
      const tracked = res.stdout.split('\n').filter(Boolean)
      expect(tracked.filter((p) => p.includes('windows-machine') || p.startsWith('.rv-'))).toEqual([])
   })
})
