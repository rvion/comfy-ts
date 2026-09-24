import { describe, expect, it } from 'bun:test'
import { describeVar } from 'src/cli/serve/describeVar.ts'
import { v } from 'src/vars/ComfyVars.ts'

describe('var looks set by the workflow', () => {
   it('ui() chains, keeps the var and its type, and merges repeated calls', () => {
      const safety = v.choice(['safe', 'nsfw'], 'safe').ui({ color: '#9ece6a' }).ui({ description: 'the rating tag' })
      expect(safety.kind).toBe('choice')
      const value: 'safe' | 'nsfw' = safety.value
      expect(value).toBe('safe')
      expect(safety.uiOpts).toEqual({ color: '#9ece6a', description: 'the rating tag' })
   })

   it('the panel receives the looks, and a var without any carries no ui key', () => {
      expect(describeVar(v.int(8).ui({ icon: 'M4 12h16', labelColor: 'red' })).ui).toEqual({
         icon: 'M4 12h16',
         labelColor: 'red',
      })
      expect('ui' in describeVar(v.int(8))).toBe(false)
   })

   it('looks never reach a draft', () => {
      expect(v.int(8).ui({ color: 'red' }).toJSON()).toBe(8)
   })
})
