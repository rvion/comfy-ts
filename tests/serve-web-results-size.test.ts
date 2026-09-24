import { describe, expect, it } from 'bun:test'
import { clampResultsSize, DEFAULT_RESULTS_SIZE } from 'src/cli/serve/web/state/WebSt.ts'

describe('result size in grid view', () => {
   it('stays between a thumbnail wall and one big image', () => {
      expect(clampResultsSize(50)).toBe(120)
      expect(clampResultsSize(2000)).toBe(640)
      expect(clampResultsSize(401.4)).toBe(401)
   })

   it('a blob without it draws the default size', () => {
      expect(clampResultsSize(undefined)).toBe(DEFAULT_RESULTS_SIZE)
   })
})
