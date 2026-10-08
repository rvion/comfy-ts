// the negative (`- `) and comment (`// `) lines of a prompt survive an enhance verbatim, each on
// its own line: the enhancer keeps them itself instead of trusting the model to copy them
import { describe, expect, it } from 'bun:test'
import { finishRewrite, splitKeptLines } from 'src/cli/serve/web/state/keptLines.ts'

describe('kept lines around an enhance', () => {
   const original = 'a girl with a red umbrella, rain\n- blurry, jpeg artifacts, cropped'

   it('only the body is sent to the model', () => {
      expect(splitKeptLines(original)).toEqual({
         body: 'a girl with a red umbrella, rain',
         kept: ['- blurry, jpeg artifacts, cropped'],
      })
   })

   // why we think it is actually a bug, and not just meaning spec should change: every master
   // prompt says to keep the "- " lines verbatim on their own line, and the anima runs glued the
   // negative onto the last sentence, so the workflow read it as positive text
   it('the negative comes back on its own line even when the model glues it to its last sentence', () => {
      const model = '1girl, red umbrella, rain\nA girl walks in the rain. - blurry, jpeg artifacts'
      expect(finishRewrite(model, ['- blurry, jpeg artifacts, cropped'])).toBe(
         '1girl, red umbrella, rain\nA girl walks in the rain.\n- blurry, jpeg artifacts, cropped',
      )
   })

   it('a negative line the model wrote itself is replaced by the kept one, never doubled', () => {
      const model = '1girl, rain\n- blurry'
      expect(finishRewrite(model, ['- blurry, cropped'])).toBe('1girl, rain\n- blurry, cropped')
   })

   // why we think it is actually a bug, and not just meaning spec should change: the kept lines
   // are the USER's, and a "- " line the model invents becomes a negative on apply; a 9B echoed the
   // input subject as one, so apply would steer the workflow away from the very thing asked for
   it('with nothing kept, a negative or comment line the model invents is dropped', () => {
      const model = '// a cat on a roof\n- "a cat on a roof"\nA tabby cat sits on a red tiled roof at dusk.'
      expect(finishRewrite(model, [])).toBe('A tabby cat sits on a red tiled roof at dusk.')
   })

   it('control: with nothing kept, the rewrite is the model output, trimmed', () => {
      expect(finishRewrite('  1girl, rain \n', [])).toBe('1girl, rain')
      expect(splitKeptLines('just a prompt')).toEqual({ body: 'just a prompt', kept: [] })
   })

   it('comment lines are kept too, in their order', () => {
      const s = splitKeptLines('// v2\ncat\n- dog')
      expect(s).toEqual({ body: 'cat', kept: ['// v2', '- dog'] })
      expect(finishRewrite('a cat', s.kept)).toBe('a cat\n// v2\n- dog')
   })
})
