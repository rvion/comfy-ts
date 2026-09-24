import { describe, expect, it } from 'bun:test'
import { bunPackList, npmPackList } from 'tests/packList.ts'

// npm-tarball.test.ts reads bun's packer because npm's costs 2.2s; npm is what publishes.
// this is the slow tier guard that the two still agree
describe('npm tarball parity', () => {
   it('bun pm pack lists exactly the files npm pack ships', () => {
      expect(bunPackList().sort()).toEqual(npmPackList().sort())
   })
})
