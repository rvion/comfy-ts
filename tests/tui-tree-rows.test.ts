import { describe, expect, it } from 'bun:test'
import { assignFamilyColors, buildFileRows, FAMILY_PALETTE, familyOf, moduleName } from 'src/cli/tui/treeRows.ts'

const none = new Set<string>()

describe('moduleName / familyOf', () => {
   it('strips dir and .cflow extension, family = first dash word', () => {
      expect(moduleName('/a/b/flux1-i2i.cflow.ts')).toBe('flux1-i2i')
      expect(moduleName('/a/b/thing.cflow.tsx')).toBe('thing')
      expect(familyOf('flux1-i2i')).toBe('flux1')
      expect(familyOf('standalone')).toBe('standalone')
   })
})

describe('assignFamilyColors', () => {
   it('same family same color, consecutive families get distinct palette entries', () => {
      const colors = assignFamilyColors([
         '/z/flux1-i2i.cflow.ts',
         '/z/flux1-t2i.cflow.ts',
         '/z/flux2-i2i.cflow.ts',
         '/z/hidream-t2i.cflow.ts',
      ])
      expect(colors.get('flux1')).toBe(FAMILY_PALETTE[0]!)
      expect(colors.get('flux2')).toBe(FAMILY_PALETTE[1]!)
      expect(colors.get('hidream')).toBe(FAMILY_PALETTE[2]!)
   })
})

describe('buildFileRows', () => {
   const user = ['/proj/a-t2i.cflow.ts', '/proj/gen/b-t2i.cflow.ts', '/proj/gen/deep/c-t2i.cflow.ts']
   const bundled = ['/pkg/examples/comfy-cloud/flux1-t2i.cflow.ts', '/pkg/examples/rvion/01-txt2img.cflow.ts']

   it('roots user files at their common dir, files before subdirs', () => {
      const rows = buildFileRows({ userFiles: user, bundledFiles: [], collapsedDirs: none, filter: '' })
      expect(rows.map((r) => (r.kind === 'dir' ? `dir:${r.label}@${r.depth}` : `file:${r.name}@${r.depth}`))).toEqual([
         'file:a-t2i@0',
         'dir:gen@0',
         'file:b-t2i@1',
         'dir:deep@1',
         'file:c-t2i@2',
      ])
   })

   it('groups bundled files LAST under one node with per-dir children', () => {
      const rows = buildFileRows({
         userFiles: ['/proj/a-t2i.cflow.ts'],
         bundledFiles: bundled,
         collapsedDirs: none,
         filter: '',
      })
      expect(rows.map((r) => (r.kind === 'dir' ? `dir:${r.label}@${r.depth}` : `file:${r.name}@${r.depth}`))).toEqual([
         'file:a-t2i@0',
         'dir:comfy-ts examples@0',
         'dir:comfy-cloud@1',
         'file:flux1-t2i@2',
         'dir:rvion@1',
         'file:01-txt2img@2',
      ])
   })

   it('merges single-child dir chains into one a/b row', () => {
      const rows = buildFileRows({
         userFiles: ['/proj/root.cflow.ts', '/proj/a/b/leaf.cflow.ts'],
         bundledFiles: [],
         collapsedDirs: none,
         filter: '',
      })
      expect(rows.map((r) => (r.kind === 'dir' ? `dir:${r.label}` : `file:${r.name}`))).toEqual([
         'file:root',
         'dir:a/b',
         'file:leaf',
      ])
   })

   it('chain merge never clobbers a real sibling dir of the same name', () => {
      // /r/a/b + /r/b: merging chain a/b re-keyed as 'b' used to overwrite
      // sibling b, silently dropping its subtree
      const rows = buildFileRows({
         userFiles: ['/r/a/b/x.cflow.ts', '/r/b/y.cflow.ts'],
         bundledFiles: [],
         collapsedDirs: none,
         filter: '',
      })
      expect(rows.map((r) => (r.kind === 'dir' ? `dir:${r.label}` : `file:${r.name}`))).toEqual([
         'dir:a/b',
         'file:x',
         'dir:b',
         'file:y',
      ])
   })

   it('filter never matches the .cflow.ts extension, only module name + dirs', () => {
      const rows = buildFileRows({ userFiles: user, bundledFiles: [], collapsedDirs: none, filter: 'cflow' })
      expect(rows).toEqual([])
      const dot = buildFileRows({ userFiles: user, bundledFiles: [], collapsedDirs: none, filter: '.' })
      expect(dot).toEqual([])
   })

   it('collapsed dir keeps its row, hides its children', () => {
      const rows = buildFileRows({
         userFiles: user,
         bundledFiles: [],
         collapsedDirs: new Set(['/proj/gen']),
         filter: '',
      })
      expect(rows.map((r) => (r.kind === 'dir' ? `dir:${r.label}:${r.expanded}` : `file:${r.name}`))).toEqual([
         'file:a-t2i',
         'dir:gen:false',
      ])
   })

   it('filter matches name or dir path, prunes empty dirs, ignores folds', () => {
      const rows = buildFileRows({
         userFiles: user,
         bundledFiles: bundled,
         collapsedDirs: new Set(['/proj/gen']),
         filter: 'flux',
      })
      expect(rows.map((r) => (r.kind === 'dir' ? `dir:${r.label}` : `file:${r.name}`))).toEqual([
         'dir:comfy-ts examples',
         'dir:comfy-cloud',
         'file:flux1-t2i',
      ])
      const byDir = buildFileRows({
         userFiles: user,
         bundledFiles: [],
         collapsedDirs: new Set(['/proj/gen']),
         filter: 'deep',
      })
      expect(byDir.map((r) => (r.kind === 'dir' ? `dir:${r.label}` : `file:${r.name}`))).toEqual([
         'dir:gen',
         'dir:deep',
         'file:c-t2i',
      ])
   })

   it('single user file shows flat, no dir rows', () => {
      const rows = buildFileRows({
         userFiles: ['/proj/solo.cflow.ts'],
         bundledFiles: [],
         collapsedDirs: none,
         filter: '',
      })
      expect(rows).toEqual([{ kind: 'file', file: '/proj/solo.cflow.ts', name: 'solo', depth: 0 }])
   })
})
