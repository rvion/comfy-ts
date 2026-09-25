import { describe, expect, it } from 'bun:test'
import { type TagNode, workflowTags } from 'src/cli/serve/workflowTags.ts'

const node = (p: Partial<TagNode> & { id: string; classType: string }): TagNode => ({
   outputNode: false,
   outputTypes: [],
   links: [],
   ...p,
})

describe('workflow tags', () => {
   it('an output node fed by an AUDIO slot tags audio', () => {
      const nodes = [
         node({ id: '1', classType: 'VAEDecodeAudio', outputTypes: ['AUDIO'] }),
         node({ id: '2', classType: 'PreviewAudio', outputNode: true, links: [['1', 0]] }),
      ]
      expect(workflowTags({ nodes, varKinds: [] })).toEqual(['audio'])
   })

   it('the producer slot type decides, so PreviewAny fed a STRING is text', () => {
      const nodes = [
         node({ id: '1', classType: 'TextGenerate', outputTypes: ['STRING', 'STRING'] }),
         node({ id: '2', classType: 'PreviewAny', outputNode: true, links: [['1', 1]] }),
      ]
      expect(workflowTags({ nodes, varKinds: [] })).toEqual(['text', 'llm'])
   })

   it('an image var adds edit, media come in a fixed order, free tags last and deduped', () => {
      const nodes = [
         node({ id: '1', classType: 'VAEDecode', outputTypes: ['IMAGE'] }),
         node({ id: '2', classType: 'StringConcat', outputTypes: ['STRING'] }),
         node({ id: '3', classType: 'PreviewAny', outputNode: true, links: [['2', 0]] }),
         node({ id: '4', classType: 'SaveImage', outputNode: true, links: [['1', 0]] }),
      ]
      expect(workflowTags({ nodes, varKinds: ['prompt', 'image'], extra: ['Anime', 'image', ' '] })).toEqual([
         'image',
         'text',
         'edit',
         'anime',
      ])
   })

   it('a link into a node that is not an output tags nothing', () => {
      const nodes = [
         node({ id: '1', classType: 'VAEDecode', outputTypes: ['IMAGE'] }),
         node({ id: '2', classType: 'ImageScale', outputTypes: ['IMAGE'], links: [['1', 0]] }),
      ]
      expect(workflowTags({ nodes, varKinds: [] })).toEqual([])
   })
})
