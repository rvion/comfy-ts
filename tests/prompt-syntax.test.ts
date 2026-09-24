import { describe, expect, it } from 'bun:test'
import { v } from 'src/vars/ComfyVars.ts'
import {
   adjustWeight,
   completionWord,
   estimateTokens,
   formatTag,
   normalizeTag,
   parsePromptText,
   promptMarks,
   tagIssues,
   toggleComment,
   toggleNegative,
   type EditResult,
   type TextChange,
} from 'src/vars/promptSyntax.ts'

/** apply a change list the way CodeMirror does: every offset refers to the ORIGINAL text */
function apply(text: string, changes: TextChange[]): string {
   let out = text
   for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
   return out
}

function weigh(text: string, from: number, to: number, delta: number): { text: string; sel: string } | null {
   const r: EditResult | null = adjustWeight(text, from, to, delta)
   if (r == null) return null
   const next = apply(text, r.changes)
   return { text: next, sel: next.slice(r.selection.anchor, r.selection.head) }
}

describe('comments', () => {
   it('a whole // line is dropped, as before', () => {
      expect(parsePromptText('a, b\n// note\nc')).toEqual({ positive: 'a, b\nc', negative: '' })
   })
   it('a trailing // cuts the rest of the line', () => {
      expect(parsePromptText('1girl, red hair // try blue').positive).toBe('1girl, red hair')
   })
   it('a url is not a comment', () => {
      expect(parsePromptText('see http://host/x, 1girl').positive).toBe('see http://host/x, 1girl')
   })
   it('a negative line keeps its trailing comment out too', () => {
      expect(parsePromptText('a\n- blurry, text // too strong?\n- // nothing')).toEqual({
         positive: 'a',
         negative: 'blurry, text',
      })
   })
   it('PromptVar builds with the same rules', () => {
      const p = v.prompt('1girl // later: 2girls\n- bad // why')
      expect(p.outValue()).toEqual({ positive: '1girl', negative: 'bad' })
   })
})

describe('weights', () => {
   it('the tag under the cursor gets wrapped', () => {
      const t = '1girl, red hair, smile'
      expect(weigh(t, 10, 10, 0.05)).toEqual({ text: '1girl, (red hair:1.05), smile', sel: 'red hair' })
   })
   it('a selection gets wrapped, surrounding spaces left out', () => {
      expect(weigh('a,  big eyes , b', 2, 13, -0.05)?.text).toBe('a,  (big eyes:0.95) , b')
   })
   it('inside a group the number moves', () => {
      expect(weigh('(red hair:1.1), x', 3, 3, 0.05)).toEqual({ text: '(red hair:1.15), x', sel: 'red hair' })
   })
   it('reaching 1 unwraps', () => {
      expect(weigh('a, (red hair:1.05)', 6, 6, -0.05)).toEqual({ text: 'a, red hair', sel: 'red hair' })
   })
   it('no float drift over many steps', () => {
      let t = 'x'
      let r = weigh(t, 0, 1, 0.05)
      for (let i = 0; i < 6 && r != null; i++) {
         t = r.text
         r = weigh(t, 1, 1, 0.05)
      }
      expect(r?.text).toBe('(x:1.35)')
   })
   it('escaped parens are part of the tag, not a group', () => {
      expect(weigh('hammer \\(sunset beach\\)', 3, 3, 0.1)?.text).toBe('(hammer \\(sunset beach\\):1.1)')
   })
   it('nothing to weigh: a comment, an empty chunk, a selection over two lines', () => {
      expect(adjustWeight('a // note', 7, 7, 0.1)).toBeNull()
      expect(adjustWeight('a, , b', 3, 3, 0.1)).toBeNull()
      expect(adjustWeight('a\nb', 0, 3, 0.1)).toBeNull()
   })
   it('works on the second line with absolute offsets', () => {
      expect(weigh('first\n- blurry', 9, 9, 0.1)?.text).toBe('first\n- (blurry:1.1)')
   })
})

describe('line toggles', () => {
   it('⌘/ comments every touched line, then uncomments them', () => {
      const t = 'a\n  b\n\nc'
      const once = apply(t, toggleComment(t, 0, 4))
      expect(once).toBe('// a\n  // b\n\nc')
      expect(apply(once, toggleComment(once, 0, once.length - 2))).toBe(t)
   })
   it('a mixed selection comments the rest rather than flipping each', () => {
      const t = '// a\nb'
      expect(apply(t, toggleComment(t, 0, t.length))).toBe('// a\n// b')
   })
   it('a selection ending at column 0 leaves that line alone', () => {
      const t = 'a\nb'
      expect(apply(t, toggleComment(t, 0, 2))).toBe('// a\nb')
   })
   it('⌘⇧- moves lines into the negative prompt and back, comments untouched', () => {
      const t = 'a\n// note\nb'
      const once = apply(t, toggleNegative(t, 0, t.length))
      expect(once).toBe('- a\n// note\n- b')
      expect(apply(once, toggleNegative(once, 0, once.length))).toBe(t)
   })
})

describe('marks', () => {
   it('comment, negative dash and body, weight parts', () => {
      const t = 'a, (b:1.2) // c\n- d'
      const got = promptMarks(t).map((m) => [m.kind, t.slice(m.from, m.to)])
      expect(got).toEqual([
         ['weight-paren', '('],
         ['weight-paren', ':'],
         ['weight-num', '1.2'],
         ['weight-paren', ')'],
         ['comment', '// c'],
         ['negative-dash', '-'],
         ['negative', 'd'],
      ])
   })
   it('a weight inside a comment is not a weight', () => {
      expect(promptMarks('// (a:1.2)').map((m) => m.kind)).toEqual(['comment'])
   })
})

describe('tag issues', () => {
   const at = (t: string, issues: { from: number; to: number; message: string }[]): string[][] =>
      issues.map((i) => [t.slice(i.from, i.to), i.message])
   it('a tag written twice is flagged at the second one, spelling and weight ignored', () => {
      const t = 'long hair, smile, (Long_Hair:1.2)'
      expect(at(t, tagIssues(t))).toEqual([['(Long_Hair:1.2)', "'long hair' is already in the prompt"]])
   })
   it('a tag the lora adds, and a tag in both prompts', () => {
      const t = 'rvcat, smile\n- smile'
      expect(at(t, tagIssues(t, { injected: [{ tag: 'rvcat', source: 'cat style' }] }))).toEqual([
         ['rvcat', "'rvcat' is already added by the lora cat style"],
         ['smile', "'smile' is also in the negative prompt"],
      ])
   })
   it('comments are not tags', () => {
      expect(tagIssues('a // a\n// a')).toEqual([])
   })
   it('weights are flagged only when the model ignores them', () => {
      expect(tagIssues('(a:1.2)')).toEqual([])
      expect(tagIssues('(a:1.2)', { weights: false }).map((i) => i.message)).toEqual([
         'this model ignores weights: the text inside is read, the number is not',
      ])
   })
   it('normalizeTag', () => {
      expect(normalizeTag(' (Hammer_\\(Sunset_Beach\\):0.9) ')).toBe('hammer (sunset beach)')
   })
})

describe('token estimate', () => {
   it('counts words and punctuation of the positive only', () => {
      expect(estimateTokens('1girl, smile // not me\n- not me either')).toBe(4)
   })
   it('a long word counts more than one', () => {
      expect(estimateTokens('supercalifragilistic')).toBeGreaterThan(1)
   })
})

describe('completion', () => {
   it('the word being typed starts after the last comma or paren', () => {
      expect(completionWord('1girl, long ha', 14)).toEqual({ from: 7, text: 'long ha' })
      expect(completionWord('(sil', 4)).toEqual({ from: 1, text: 'sil' })
      expect(completionWord('- blu', 5)).toEqual({ from: 2, text: 'blu' })
   })
   it('none inside a comment', () => {
      expect(completionWord('a // lo', 7)).toBeNull()
   })
   it('formatTag: spaces, escaped parens, artist prefix', () => {
      expect(formatTag('long_hair', 0, {})).toBe('long hair')
      expect(formatTag('long_hair', 0, { underscores: true })).toBe('long_hair')
      expect(formatTag('>_<', 0, {})).toBe('>_<')
      expect(formatTag('hammer_(sunset_beach)', 1, { artistPrefix: '@' })).toBe('@hammer \\(sunset beach\\)')
      expect(formatTag('hammer_(sunset_beach)', 1, { weights: false })).toBe('hammer (sunset beach)')
   })
})
