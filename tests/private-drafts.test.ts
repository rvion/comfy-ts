// drafts hold hand-tuned prompts, some explicit: they never reach git. A managed .gitignore block
// once re-included `.comfy-ts/drafts/` and every draft showed up as an untracked file, one
// `git add -A` away from being published
import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'

const ignored = (path: string): boolean => spawnSync('git', ['check-ignore', '-q', path]).status === 0

describe('drafts stay private', () => {
   it('every draft path is ignored by git', () => {
      expect(ignored('.comfy-ts/drafts/10-anima-t2i/default.json')).toBe(true)
      expect(ignored('.comfy-ts/drafts/any-workflow/any draft.json')).toBe(true)
   })

   it('control: the prompt enhancer templates stay tracked, the one published part of .comfy-ts', () => {
      expect(ignored('.comfy-ts/prompt-enhancers/refine-krea2-prompt.md')).toBe(false)
   })

   // why we think it is actually a bug, and not just meaning spec should change: the gitignore's own
   // comment says the master prompts are tracked, and a check on an already TRACKED file cannot see
   // it (git never reports a tracked path as ignored), so a new master prompt was silently left out
   it('a NEW master prompt is not ignored either, so it can be committed', () => {
      expect(ignored('.comfy-ts/prompt-enhancers/a-new-master-prompt.md')).toBe(false)
   })

   it('llm configs stay private like drafts', () => {
      expect(ignored('.comfy-ts/llm-configs/wm-9b.json')).toBe(true)
   })
})
