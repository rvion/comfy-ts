// every form row can go back to what the workflow declares, one click, whatever the draft holds
import { describe, expect, it } from 'bun:test'
import { describeVar } from 'src/cli/serve/describeVar.ts'
import { VarSt } from 'src/cli/serve/web/state/FormSt.ts'
import { v } from 'src/vars/ComfyVars.ts'

describe('reset a var to the workflow default', () => {
   it('a changed var goes back to the declared default, and says it is there', () => {
      const s = new VarSt('steps', describeVar(v.int(20, { min: 1, max: 60 })), 30)
      expect(s.isAtDefault).toBe(false)
      s.resetToDefault()
      expect(s.value).toBe(20)
      expect(s.isAtDefault).toBe(true)
      // a reset is an edit like any other: the draft autosaves it and revert brings back 30
      expect(s.dirty).toBe(true)
   })

   it('a structured default (a size, a choice list) compares by value, not by reference', () => {
      const size = new VarSt('size', describeVar(v.size({ width: 1024, height: 1024 })), { width: 1024, height: 1024 })
      expect(size.isAtDefault).toBe(true)
      const many = new VarSt('score', describeVar(v.choice(['6', '7'], ['7'], { select: 'many' })), ['6', '7'])
      expect(many.isAtDefault).toBe(false)
      many.resetToDefault()
      expect(many.value).toEqual(['7'])
   })
})
