import { describe, expect, it } from 'bun:test'
import { workspaceLabels } from 'src/cli/serve/workspaceLabels.ts'

describe('workspace labels', () => {
   it('home becomes ~ and a root inside the workspace is relative', () => {
      const l = workspaceLabels({
         workspace: '/Users/x/dev/comfy-ts',
         root: '/Users/x/dev/comfy-ts/examples/rvion',
         home: '/Users/x',
      })
      expect(l.workspace).toEqual({ path: '/Users/x/dev/comfy-ts', label: '~/dev/comfy-ts' })
      expect(l.root).toEqual({ path: '/Users/x/dev/comfy-ts/examples/rvion', label: 'examples/rvion' })
   })

   it('the workspace itself as root reads as .', () => {
      expect(workspaceLabels({ workspace: '/w/', root: '/w', home: '/h' }).root.label).toBe('.')
   })

   it('a root outside the workspace keeps its own path, a sibling prefix is not inside', () => {
      const l = workspaceLabels({ workspace: '/Users/x/dev/app', root: '/Users/x/dev/app-flows', home: '/Users/x' })
      expect(l.root.label).toBe('~/dev/app-flows')
   })
})
