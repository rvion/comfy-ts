import { describe, expect, it } from 'bun:test'
import { groupPlaces } from 'src/cli/serve/web/state/varGroups.ts'

describe('var groups', () => {
   it('consecutive rows of one group form one block: start, middle, end', () => {
      const places = groupPlaces([{}, { group: 's' }, { group: 's' }, { group: 's', groupColor: 'red' }, {}])
      expect(places.map((p) => p?.pos ?? null)).toEqual([null, 'start', 'mid', 'end', null])
      // the tint comes from whichever member sets it
      expect(places[1]?.color).toBe('red')
   })

   it('a lone member is a block of one, a split group is two blocks', () => {
      expect(groupPlaces([{ group: 'a' }]).map((p) => p?.pos)).toEqual(['solo'])
      expect(groupPlaces([{ group: 'a' }, {}, { group: 'a' }]).map((p) => p?.pos ?? null)).toEqual([
         'solo',
         null,
         'solo',
      ])
   })

   it('control: no groups, no blocks', () => {
      expect(groupPlaces([{}, {}])).toEqual([null, null])
   })
})
