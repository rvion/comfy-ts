import { describe, expect, it } from 'bun:test'
import { duplicateDraftName, freeDraftName } from 'src/cli/serve/web/state/draftNames.ts'

describe('draft names given without asking', () => {
   it('new takes the first free `new`, `new 2`, …', () => {
      expect(freeDraftName(['default'])).toBe('new')
      expect(freeDraftName(['new', 'new 2'])).toBe('new 3')
   })

   it('a duplicate increments a trailing number and skips taken names', () => {
      expect(duplicateDraftName('girl-octopus-3', ['girl-octopus-3', 'girl-octopus-4'])).toBe('girl-octopus-5')
      expect(duplicateDraftName('default', ['default'])).toBe('default-2')
   })
})
