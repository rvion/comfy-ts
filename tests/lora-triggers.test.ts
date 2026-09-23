import { describe, expect, it } from 'bun:test'
import { loraTriggersOf } from 'src/host/loraInfoCache.ts'

// the three mirror shapes the lora manager's list endpoint really returns
describe('trigger word state of a mirror item', () => {
   it('words when civitai lists them', () => {
      expect(loraTriggersOf({ civitai: { id: 1, modelId: 2, name: 'v1', trainedWords: ['toon style'] } })).toEqual({
         state: 'words',
         words: ['toon style'],
      })
   })

   it('none when the block is linked to civitai but carries no words (the extension drops an empty list)', () => {
      expect(loraTriggersOf({ civitai: { id: 1, modelId: 2, name: 'v1' } })).toEqual({ state: 'none' })
   })

   it('unfetched when there is no civitai block, or an empty one', () => {
      expect(loraTriggersOf({ from_civitai: false })).toEqual({ state: 'unfetched' })
      expect(loraTriggersOf({ civitai: {} })).toEqual({ state: 'unfetched' })
   })
})

describe('a recorded civitai miss', () => {
   it('turns an unfetched lora into not-on-civitai, and never overrides words or a linked none', () => {
      expect(loraTriggersOf({ from_civitai: false }, { civitaiMiss: true })).toEqual({ state: 'not-on-civitai' })
      expect(loraTriggersOf({ civitai: { id: 1, name: 'v1' } }, { civitaiMiss: true })).toEqual({ state: 'none' })
      expect(loraTriggersOf({ civitai: { id: 1, trainedWords: ['x'] } }, { civitaiMiss: true })).toEqual({
         state: 'words',
         words: ['x'],
      })
   })
})
