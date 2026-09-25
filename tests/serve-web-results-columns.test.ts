import { describe, expect, it } from 'bun:test'
import { clampResultsColumns, readResultsColumns } from 'src/cli/serve/web/state/WebSt.ts'

describe('results columns', () => {
   it('a whole number from one full width image to a wall of eight', () => {
      expect(clampResultsColumns(0)).toBe(1)
      expect(clampResultsColumns(20)).toBe(8)
      expect(clampResultsColumns(2.6)).toBe(3)
      expect(clampResultsColumns('two')).toBe(1)
   })

   it('a blob from the fit and grid era keeps its look: fit is one column, grid is three', () => {
      expect(readResultsColumns({ resultsView: 'fit' })).toBe(1)
      expect(readResultsColumns({ resultsView: 'grid', resultsSize: 200 })).toBe(3)
      expect(readResultsColumns({})).toBe(1)
      expect(readResultsColumns({ resultsColumns: 2, resultsView: 'grid' })).toBe(2)
   })
})
