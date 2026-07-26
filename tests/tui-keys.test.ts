import { describe, expect, it } from 'bun:test'
import { parseModifyOtherKeysEnter } from 'src/cli/tui/keys.ts'

describe('modifyOtherKeys modified-enter translation', () => {
   it('translates CSI 27;mods;13~ (as ink delivers it, escape stripped) into return + modifiers', () => {
      // repro: ⇧⏎ committed the prompt — vscode/xterm encodes it as mods=2
      expect(parseModifyOtherKeysEnter('[27;2;13~')).toEqual({ return: true, shift: true, meta: false, ctrl: false })
      expect(parseModifyOtherKeysEnter('[27;3;13~')).toEqual({ return: true, shift: false, meta: true, ctrl: false }) // alt
      expect(parseModifyOtherKeysEnter('[27;5;13~')).toEqual({ return: true, shift: false, meta: false, ctrl: true })
      expect(parseModifyOtherKeysEnter('[27;6;13~')).toEqual({ return: true, shift: true, meta: false, ctrl: true })
      expect(parseModifyOtherKeysEnter('[27;4;13~')).toEqual({ return: true, shift: true, meta: true, ctrl: false }) // shift+alt
   })

   it('leaves everything else alone', () => {
      expect(parseModifyOtherKeysEnter('a')).toBeNull()
      expect(parseModifyOtherKeysEnter('')).toBeNull()
      expect(parseModifyOtherKeysEnter('[27;2;14~')).toBeNull() // not enter
      expect(parseModifyOtherKeysEnter('[28;2;13~')).toBeNull() // not the 27 form
      expect(parseModifyOtherKeysEnter('[27;2;13')).toBeNull() // unterminated
   })
})
