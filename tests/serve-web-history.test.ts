import { describe, expect, it } from 'bun:test'
import { HISTORY_CAP, pushHistory, searchHistory, timeAgo, type HistoryEntry } from 'src/cli/serve/web/state/history.ts'

const add = (list: HistoryEntry<string>[], text: string, at: number): HistoryEntry<string>[] =>
   pushHistory(list, { text, value: text, at, source: 'wf · prompt' })

describe('submitted history', () => {
   it('newest first, and submitting a text again moves it to the top with its count', () => {
      let h: HistoryEntry<string>[] = []
      h = add(h, 'a cat', 1)
      h = add(h, 'a dog', 2)
      h = add(h, 'a cat', 3)
      expect(h.map((e) => [e.text, e.at, e.count])).toEqual([
         ['a cat', 3, 2],
         ['a dog', 2, 1],
      ])
   })

   it('an empty submit is not history', () => {
      expect(add([], '   ', 1)).toEqual([])
   })

   it('the list is bounded, the oldest go first', () => {
      let h: HistoryEntry<string>[] = []
      for (let i = 0; i < HISTORY_CAP + 5; i++) h = add(h, `p${i}`, i)
      expect(h.length).toBe(HISTORY_CAP)
      expect(h[0]?.text).toBe(`p${HISTORY_CAP + 4}`)
      expect(h.some((e) => e.text === 'p0')).toBe(false)
   })

   it('search needs every word, in any order and any case, and keeps the newest first', () => {
      let h: HistoryEntry<string>[] = []
      h = add(h, 'red umbrella in the rain', 1)
      h = add(h, 'a cat on a mat', 2)
      h = add(h, 'Rain over a red city', 3)
      expect(searchHistory(h, 'red rain').map((e) => e.text)).toEqual([
         'Rain over a red city',
         'red umbrella in the rain',
      ])
      expect(searchHistory(h, 'umbrella cat')).toEqual([])
      expect(searchHistory(h, '  ').length).toBe(3)
   })

   it('says how long ago in words a glance reads', () => {
      expect(timeAgo(0, 3000)).toBe('just now')
      expect(timeAgo(0, 42_000)).toBe('42s ago')
      expect(timeAgo(0, 5 * 60_000)).toBe('5 min ago')
      expect(timeAgo(0, 125 * 60_000)).toBe('2 h 5 min ago')
      expect(timeAgo(1000, 0)).toBe('just now')
   })
})
