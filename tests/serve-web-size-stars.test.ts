import { describe, expect, it } from 'bun:test'
import { aspectBox, starredPresets, toggleStar } from 'src/cli/serve/web/state/sizeStars.ts'

const PRESETS = [
   { label: '1:1 square', width: 1024, height: 1024 },
   { label: '3:4 portrait', width: 896, height: 1152 },
   { label: '16:9 widescreen', width: 1344, height: 768 },
]

describe('size stars', () => {
   it('the var decides the stars until you star something yourself', () => {
      expect(
         starredPresets({ presets: PRESETS, defaults: ['1:1 square'], mine: undefined }).map((p) => p.label),
      ).toEqual(['1:1 square'])
      expect(
         starredPresets({ presets: PRESETS, defaults: ['1:1 square'], mine: ['16:9 widescreen'] }).map((p) => p.label),
      ).toEqual(['16:9 widescreen'])
   })

   it('quick buttons follow the preset order, not the order you starred them in', () => {
      const mine = ['16:9 widescreen', '1:1 square']
      expect(starredPresets({ presets: PRESETS, defaults: [], mine }).map((p) => p.label)).toEqual([
         '1:1 square',
         '16:9 widescreen',
      ])
   })

   it('a toggle starts from the effective stars, so un-starring a default works', () => {
      expect(toggleStar({ defaults: ['1:1 square', '3:4 portrait'], mine: undefined, label: '1:1 square' })).toEqual([
         '3:4 portrait',
      ])
      expect(toggleStar({ defaults: [], mine: ['a'], label: 'b' })).toEqual(['a', 'b'])
   })

   it('an unstarred-everything list stays empty, never falls back to the defaults', () => {
      expect(starredPresets({ presets: PRESETS, defaults: ['1:1 square'], mine: [] })).toEqual([])
   })
})

describe('aspect icon', () => {
   it('the long side fills the box, the short one keeps the ratio', () => {
      expect(aspectBox(1344, 768, 14)).toEqual({ w: 14, h: 8 })
      expect(aspectBox(768, 1344, 14)).toEqual({ w: 8, h: 14 })
      expect(aspectBox(1024, 1024, 14)).toEqual({ w: 14, h: 14 })
   })

   it('a broken size draws a square rather than nothing', () => {
      expect(aspectBox(0, 100, 14)).toEqual({ w: 14, h: 14 })
   })
})
