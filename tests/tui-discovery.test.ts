import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { join } from 'pathe'
import { mergeWorkflowSources, scanCflowFiles } from 'src/cli/tui/discoverWorkflows.ts'
import { bundledExamplesDir } from 'src/exampleAssets.ts'

describe('mergeWorkflowSources', () => {
   const own = ['/proj/a.cflow.ts', '/proj/sub/b.cflow.ts']
   const ex = ['/pkg/examples/01.cflow.ts', '/pkg/examples/02.cflow.ts']

   it('cwd-only when the bundled dir is missing (empty bundled list)', () => {
      const d = mergeWorkflowSources({ explicitTarget: false, scanned: own, bundledFiles: [] })
      expect(d.files).toEqual(own)
      expect(d.bundled.size).toBe(0)
   })

   it('appends bundled examples after the user files, marked bundled', () => {
      const d = mergeWorkflowSources({ explicitTarget: false, scanned: own, bundledFiles: ex })
      expect(d.files).toEqual([...own, ...ex])
      expect([...d.bundled]).toEqual(ex)
   })

   it('dedupes bundled files the cwd scan already found, keeping them GROUPED as bundled', () => {
      // the repo case: ./examples is under cwd, so the scan lists them too
      const d = mergeWorkflowSources({ explicitTarget: false, scanned: [...own, ex[0]!], bundledFiles: ex })
      expect(d.files).toEqual([...own, ...ex]) // listed once, at the bundled position
      expect(d.bundled.has(ex[0]!)).toBe(true)
   })

   it('explicit target bypasses the bundled merge entirely', () => {
      const d = mergeWorkflowSources({ explicitTarget: true, scanned: own, bundledFiles: ex })
      expect(d.files).toEqual(own)
      expect(d.bundled.size).toBe(0)
   })
})

describe('scanCflowFiles', () => {
   it('skips everything below node_modules (pnpm symlink layouts listed packaged examples twice)', () => {
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-scan-'))
      try {
         mkdirSync(join(root, 'sub'), { recursive: true })
         writeFileSync(join(root, 'mine.cflow.ts'), '')
         writeFileSync(join(root, 'sub', 'deep.cflow.ts'), '')
         mkdirSync(join(root, 'node_modules', 'comfy-ts', 'examples'), { recursive: true })
         writeFileSync(join(root, 'node_modules', 'comfy-ts', 'examples', '01.cflow.ts'), '')
         const files = scanCflowFiles(root)
         expect(files).toEqual([join(root, 'mine.cflow.ts'), join(root, 'sub', 'deep.cflow.ts')])
      } finally {
         rmSync(root, { recursive: true, force: true })
      }
   })

   it('a scan root ITSELF inside node_modules still scans (explicit arg into the package)', () => {
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-scan-'))
      try {
         const inside = join(root, 'node_modules', 'comfy-ts', 'examples')
         mkdirSync(inside, { recursive: true })
         writeFileSync(join(inside, '01.cflow.ts'), '')
         expect(scanCflowFiles(inside)).toEqual([join(inside, '01.cflow.ts')])
      } finally {
         rmSync(root, { recursive: true, force: true })
      }
   })

   it('survives a malformed package.json on the bundledExamplesDir walk-up', () => {
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-scan-'))
      try {
         writeFileSync(join(root, 'package.json'), '{ not json')
         mkdirSync(join(root, 'dist'), { recursive: true })
         // walk continues past the broken file and eventually returns null or
         // the repo package, never throws a parse error
         expect(() => bundledExamplesDir(pathToFileURL(join(root, 'dist', 'cli.js')).href)).not.toThrow(SyntaxError)
      } finally {
         rmSync(root, { recursive: true, force: true })
      }
   })
})

describe('bundledExamplesDir', () => {
   it('resolves this repo examples/ from the module location, never cwd', () => {
      const dir = bundledExamplesDir()
      expect(dir).not.toBeNull()
      expect(dir!.endsWith('examples')).toBe(true)
      expect(scanCflowFiles(dir!).some((f) => f.endsWith('01-txt2img.cflow.ts'))).toBe(true)
   })

   it('finds examples next to the nearest comfy-ts package.json (consumer dist layout)', () => {
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-pkg-'))
      try {
         writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'comfy-ts' }))
         mkdirSync(join(root, 'examples'))
         const fromDist = pathToFileURL(join(root, 'dist', 'cli.js')).href
         expect(bundledExamplesDir(fromDist)).toBe(join(root, 'examples'))
      } finally {
         rmSync(root, { recursive: true, force: true })
      }
   })

   it('is silently absent when the examples folder was pruned', () => {
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-pkg-'))
      try {
         writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'comfy-ts' }))
         expect(bundledExamplesDir(pathToFileURL(join(root, 'dist', 'cli.js')).href)).toBeNull()
      } finally {
         rmSync(root, { recursive: true, force: true })
      }
   })

   it('is silently absent when comfy-ts is inlined into a foreign package', () => {
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-pkg-'))
      try {
         writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'someone-elses-app' }))
         mkdirSync(join(root, 'examples')) // theirs, not ours: must NOT be picked up
         expect(bundledExamplesDir(pathToFileURL(join(root, 'dist', 'cli.js')).href)).toBeNull()
      } finally {
         rmSync(root, { recursive: true, force: true })
      }
   })
})

describe('rememberedWorkflow (no-arg tui reopens the last module)', () => {
   it('present in the tree → picked; stale/absent/non-string/missing file → null', async () => {
      const { rememberedWorkflow } = await import('src/cli/tui/run-tui.tsx')
      const { settingsPathFor } = await import('src/state.ts')
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-resume-'))
      try {
         const files = ['/tree/a.cflow.ts', '/tree/sub/b.cflow.ts']
         const settings = settingsPathFor(root)
         mkdirSync(join(root, '.comfy-ts'), { recursive: true })
         // the one settings-path rule: SettingsSt writes where run-tui reads
         expect(settings).toBe(join(root, '.comfy-ts', 'settings.json'))
         writeFileSync(settings, JSON.stringify({ lastWorkflow: '/tree/sub/b.cflow.ts' }))
         expect(rememberedWorkflow(files, settings)).toBe('/tree/sub/b.cflow.ts')
         // moved/deleted module: stored path no longer in the tree
         writeFileSync(settings, JSON.stringify({ lastWorkflow: '/gone/x.cflow.ts' }))
         expect(rememberedWorkflow(files, settings)).toBeNull()
         writeFileSync(settings, JSON.stringify({ lastWorkflow: 42 }))
         expect(rememberedWorkflow(files, settings)).toBeNull()
         writeFileSync(settings, 'not json at all')
         expect(rememberedWorkflow(files, settings)).toBeNull()
         expect(rememberedWorkflow(files, join(root, 'nope.json'))).toBeNull()
      } finally {
         rmSync(root, { recursive: true, force: true })
      }
   })
})
