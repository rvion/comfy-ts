import { describe, expect, it } from 'bun:test'
import { localOutputPath } from 'src/runner/outputPath.ts'

// his repro 2026-07-31: prefix `foo/krea/` produced `.comfy-ts/outputs/
// foo/krea_00001_.png` (dir intent mangled into a filename prefix) AND
// every run OVERWROTE it — cloud hosts reset the _00001_ counter per run,
// so the server filename is not unique. => local names carry a timestamp
// by default and the prompt's own filename_prefix owns the directory.

const T = '20260731-154210'

describe('localOutputPath (pure): dir intent + timestamp, never the raw server name', () => {
   it('trailing-slash prefix is a DIRECTORY: files land inside it', () => {
      expect(
         localOutputPath({
            filenamePrefix: 'foo/krea/',
            subfolder: 'foo',
            filename: 'krea_00001_.png',
            timestamp: T,
         }),
      ).toBe('foo/krea/20260731-154210_00001.png')
   })

   it('plain prefix keeps its last segment as the name stem', () => {
      expect(
         localOutputPath({
            filenamePrefix: 'foo/krea',
            subfolder: 'foo',
            filename: 'krea_00001_.png',
            timestamp: T,
         }),
      ).toBe('foo/krea_20260731-154210_00001.png')
   })

   it('flat prefix: stem + timestamp + counter in the outputs root', () => {
      expect(
         localOutputPath({
            filenamePrefix: 'comfy-ts-example',
            subfolder: '',
            filename: 'comfy-ts-example_00007_.png',
            timestamp: T,
         }),
      ).toBe('comfy-ts-example_20260731-154210_00007.png')
   })

   it('no prefix known (non-SaveImage nodes): server subfolder + stem survive, timestamp still in', () => {
      expect(
         localOutputPath({
            filenamePrefix: undefined,
            subfolder: 'sub',
            filename: 'ComfyUI_00003_.png',
            timestamp: T,
         }),
      ).toBe('sub/ComfyUI_20260731-154210_00003.png')
   })

   it('server filename without a counter still gets the timestamp before the extension', () => {
      expect(
         localOutputPath({
            filenamePrefix: undefined,
            subfolder: '',
            filename: 'audio.flac',
            timestamp: T,
         }),
      ).toBe('audio_20260731-154210.flac')
   })

   it('an explicit local dir override (save.prefix) wins over everything', () => {
      expect(
         localOutputPath({
            localDir: 'my/place',
            filenamePrefix: 'foo/krea/',
            subfolder: 'foo',
            filename: 'krea_00001_.png',
            timestamp: T,
         }),
      ).toBe('my/place/20260731-154210_00001.png')
   })

   it('two runs with different timestamps never collide (his overwrite repro)', () => {
      const run = (ts: string) =>
         localOutputPath({ filenamePrefix: 'foo/krea/', subfolder: 'foo', filename: 'krea_00001_.png', timestamp: ts })
      expect(run('20260731-154210')).not.toBe(run('20260731-154299'))
   })
})

describe('reviewer catches', () => {
   it('sf.prefix override keeps the workflow stem — identity survives the dir move', () => {
      expect(
         localOutputPath({
            localDir: 'my/place',
            filenamePrefix: 'foo/krea/',
            subfolder: 'foo',
            filename: 'krea_00001_.png',
            timestamp: T,
         }),
      ).toBe('my/place/20260731-154210_00001.png')
      expect(
         localOutputPath({
            localDir: 'my/place',
            filenamePrefix: 'foo/krea',
            subfolder: 'foo',
            filename: 'krea_00001_.png',
            timestamp: T,
         }),
      ).toBe('my/place/krea_20260731-154210_00001.png')
   })

   it('uniquifyOutputPath: claimed-but-unwritten paths bump too (same-second concurrent runs)', async () => {
      const { uniquifyOutputPath } = await import('src/runner/outputPath.ts')
      const claimed = new Set<string>()
      const a = uniquifyOutputPath({ path: '/o/x_1.png', exists: () => false, claimed })
      const b = uniquifyOutputPath({ path: '/o/x_1.png', exists: () => false, claimed })
      const c = uniquifyOutputPath({ path: '/o/x_1.png', exists: () => false, claimed })
      expect(a).toBe('/o/x_1.png')
      expect(b).toBe('/o/x_1-2.png')
      expect(c).toBe('/o/x_1-3.png')
      const d = uniquifyOutputPath({ path: '/o/y.png', exists: (s) => s === '/o/y.png', claimed })
      expect(d).toBe('/o/y-2.png')
   })
})
