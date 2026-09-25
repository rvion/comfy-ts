import { describe, expect, it } from 'bun:test'
import { optionsFor, type PromptEditorCtx } from 'src/cli/serve/web/promptEditor/promptExtensions.ts'

const ctx = (tags: PromptEditorCtx['tags']): PromptEditorCtx => ({
   weights: true,
   tags,
   searchTags: () => Promise.resolve([{ name: 'silver_hair', count: 1000 }]),
   injected: () => [],
   loraWords: () => [{ word: 'silver sheep', source: 'sheep lora' }],
   onTagError: () => {},
})

describe('prompt completion is opt in per workflow', () => {
   it('a prompt that declares no tag list completes nothing, not even its loras words', async () => {
      // why we think it is actually a bug, and not just meaning spec should change: completion is a per workflow opt in (v.prompt(…, { tags })), and the krea2 prompt, which never opted in, popped completions from its loras' trigger words
      const options = await optionsFor(ctx(null), 'sil', new AbortController().signal)
      expect(options).toEqual([])
   })

   it('control: a prompt that opted in gets its loras words and the tag hits', async () => {
      const options = await optionsFor(ctx({ underscores: false }), 'sil', new AbortController().signal)
      expect(options.map((o) => o.label)).toEqual(['silver sheep', 'silver hair'])
   })
})
