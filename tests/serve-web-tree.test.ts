import { describe, expect, it } from 'bun:test'
import { groupModulesByFolder } from 'src/cli/serve/web/state/moduleTree.ts'

const mod = (module: string, file: string): { module: string; file: string } => ({ module, file })

describe('sidebar module tree', () => {
   it('serving ONE folder still names it: a flat list with the prefix eaten is the bug', () => {
      const groups = groupModulesByFolder([
         mod('04-krea2', '/Users/x/dev/comfy-ts/examples/rvion/04-krea2.cflow.ts'),
         mod('01-txt2img', '/Users/x/dev/comfy-ts/examples/rvion/01-txt2img.cflow.ts'),
      ])
      expect(groups).toHaveLength(1)
      expect(groups[0]?.folder).toBe('rvion')
      // modules sort alphabetically inside a group
      expect(groups[0]?.modules.map((m) => m.module)).toEqual(['01-txt2img', '04-krea2'])
   })

   it('several folders keep enough prefix to tell them apart', () => {
      const groups = groupModulesByFolder([
         mod('a', '/repo/examples/rvion/a.cflow.ts'),
         mod('b', '/repo/examples/cloud/b.cflow.ts'),
         mod('c', '/repo/examples/rvion/nested/c.cflow.ts'),
      ])
      expect(groups.map((g) => g.folder)).toEqual(['examples/cloud', 'examples/rvion', 'examples/rvion/nested'])
   })

   it('a single module still shows its folder', () => {
      expect(groupModulesByFolder([mod('one', '/repo/flows/one.cflow.ts')])[0]?.folder).toBe('flows')
   })

   it('windows separators and a bare filename do not break the grouping', () => {
      expect(groupModulesByFolder([mod('w', 'C:\\dev\\flows\\w.cflow.ts')])[0]?.folder).toBe('flows')
      expect(groupModulesByFolder([mod('bare', 'bare.cflow.ts')])[0]?.folder).toBe('')
   })

   it('no modules, no groups', () => {
      expect(groupModulesByFolder([])).toEqual([])
   })
})
