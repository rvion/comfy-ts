import { describe, expect, it } from 'bun:test'
import { waitForVersion } from 'scripts/release.ts'

// why we think it is actually a bug, and not just meaning spec should change: `bun publish` exited
// 0 while the registry never received the version, and the release went on to tag and to cut a
// GitHub release for a version npm does not have
describe('the release waits for npm to list the version', () => {
   it('a version that never shows up fails, after the given tries', async () => {
      let calls = 0
      const ok = await waitForVersion({
         version: '9.9.9',
         tries: 3,
         wait: () => Promise.resolve(),
         versions: () => {
            calls++
            return Promise.resolve({ '9.9.8': {} })
         },
      })
      expect(ok).toBe(false)
      expect(calls).toBe(3)
   })

   it('control: a version that shows up on a later try passes', async () => {
      let calls = 0
      const ok = await waitForVersion({
         version: '9.9.9',
         tries: 5,
         wait: () => Promise.resolve(),
         versions: () => Promise.resolve(++calls >= 2 ? { '9.9.9': {} } : {}),
      })
      expect(ok).toBe(true)
      expect(calls).toBe(2)
   })
})
