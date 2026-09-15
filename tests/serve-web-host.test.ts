// the host protocol (src/cli/serve/web/state/host.ts): a page embedding the panel can only
// learn what the panel says, and can only ask what the panel understands. Both parsers are
// pure, so this is where a malformed message is proven harmless.
import { describe, expect, it } from 'bun:test'
import { isEmbedded, parseFromHost, readUrlPrompt } from 'src/cli/serve/web/state/host.ts'

describe('messages from the host', () => {
   it('host-actions keeps well-formed entries and drops the rest', () => {
      expect(
         parseFromHost({
            comfyTs: 'host-actions',
            actions: [
               { id: 'keep', label: 'send to chat', title: 'DM it' },
               { id: '', label: 'x' },
               'junk',
               { id: 'a' },
            ],
         }),
      ).toEqual({ comfyTs: 'host-actions', actions: [{ id: 'keep', label: 'send to chat', title: 'DM it' }] })
   })

   it('set-prompt needs a string', () => {
      expect(parseFromHost({ comfyTs: 'set-prompt', text: 'a fox' })).toEqual({ comfyTs: 'set-prompt', text: 'a fox' })
      expect(parseFromHost({ comfyTs: 'set-prompt', text: 3 })).toBeNull()
   })

   it('anything else on the window is not ours', () => {
      expect(parseFromHost(null)).toBeNull()
      expect(parseFromHost('hello')).toBeNull()
      expect(parseFromHost({ type: 'webpackOk' })).toBeNull()
      expect(parseFromHost({ comfyTs: 'result-action', id: 'x' })).toBeNull()
      expect(parseFromHost({ comfyTs: 'host-actions', actions: 'nope' })).toBeNull()
   })
})

describe('the url prompt', () => {
   it('reads ?prompt=, url-decoded, and nothing when absent or empty', () => {
      expect(readUrlPrompt('?workflow=x&prompt=a%20fox%20in%20the%20snow')).toBe('a fox in the snow')
      expect(readUrlPrompt('?prompt=')).toBeNull()
      expect(readUrlPrompt('')).toBeNull()
      expect(readUrlPrompt('?%%%')).toBeNull()
   })
})

describe('embedding', () => {
   it('headless is not embedded', () => {
      expect(isEmbedded()).toBe(false)
   })
})
