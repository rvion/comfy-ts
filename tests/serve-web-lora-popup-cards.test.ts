// picking a lora in the popup must not move the gallery: the picked card stays where it is
import { describe, expect, it } from 'bun:test'
import { popupCardClick, popupCards } from 'src/cli/serve/web/state/loraSort.ts'

describe('lora popup cards', () => {
   it('keeps a picked lora in the gallery, at its place', () => {
      const r = popupCards({ matches: ['a', 'b', 'c'], picked: ['b'], cap: 10 })
      expect(r.cards).toEqual(['a', 'b', 'c'])
   })

   it('enter adds the first card not picked yet', () => {
      expect(popupCards({ matches: ['a', 'b', 'c'], picked: ['a', 'b'], cap: 10 }).enterPick).toBe('c')
      expect(popupCards({ matches: ['a', 'b'], picked: [], cap: 10 }).enterPick).toBe('a')
   })

   it('enter adds nothing when every drawn card is picked', () => {
      expect(popupCards({ matches: ['a', 'b'], picked: ['a', 'b'], cap: 10 }).enterPick).toBeNull()
   })

   it('the cap counts every card, picked ones included', () => {
      const r = popupCards({ matches: ['a', 'b', 'c', 'd'], picked: ['a'], cap: 2 })
      expect(r.cards).toEqual(['a', 'b'])
      expect(r.enterPick).toBe('b')
   })
})

describe('lora popup card click', () => {
   it('adds, then pauses, then resumes: the same switch as the form card, never a removal', () => {
      expect(popupCardClick({ picked: false, on: false })).toBe('add')
      expect(popupCardClick({ picked: true, on: true })).toBe('pause')
      expect(popupCardClick({ picked: true, on: false })).toBe('resume')
   })
})
