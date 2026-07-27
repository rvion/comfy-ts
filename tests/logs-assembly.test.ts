import { describe, expect, it } from 'bun:test'
import { assembleLogChunks } from 'src/cli/tui/state/LogsSt.ts'

// real /internal/logs/raw shape: entries are write CHUNKS, "\n" arrives alone,
// lines arrive in fragments, tqdm redraws via \r
describe('assembleLogChunks', () => {
   it('assembles fragmented chunks into lines (captured comfy shape)', () => {
      const lines: string[] = []
      const partial = assembleLogChunks({
         lines,
         partial: '',
         entries: [
            { t: '', m: '** ComfyUI startup time:' },
            { t: '', m: ' ' },
            { t: '', m: '2026-07-27 08:46:48.528' },
            { t: '', m: '\n' },
            { t: '', m: '[START] Security scan' },
            { t: '', m: '\n' },
         ],
      })
      expect(lines).toEqual(['** ComfyUI startup time: 2026-07-27 08:46:48.528', '[START] Security scan'])
      expect(partial).toBe('')
   })

   it('keeps an unterminated tail as the partial (live tqdm row)', () => {
      const lines: string[] = []
      const partial = assembleLogChunks({
         lines,
         partial: '',
         entries: [
            { t: '', m: 'loading model' },
            { t: '', m: '…' },
         ],
      })
      expect(lines).toEqual([])
      expect(partial).toBe('loading model…')
   })

   it('\\r resets the partial: tqdm redraws collapse to the last state', () => {
      const lines: string[] = []
      const partial = assembleLogChunks({
         lines,
         partial: '',
         entries: [{ t: '', m: ' 25%|██        | 2/8\r 50%|█████     | 4/8\r 75%|███████   | 6/8' }],
      })
      expect(lines).toEqual([])
      expect(partial).toBe(' 75%|███████   | 6/8')
   })

   it('strips ansi and drops blank lines', () => {
      const lines: string[] = []
      const partial = assembleLogChunks({
         lines,
         partial: '',
         entries: [
            { t: '', m: '\x1b[32m[INFO]\x1b[0m Prompt executed\n' },
            { t: '', m: '\n' },
            { t: '', m: '   \n' },
         ],
      })
      expect(lines).toEqual(['[INFO] Prompt executed'])
      expect(partial).toBe('')
   })

   it('continues a partial across calls', () => {
      const lines: string[] = []
      let partial = assembleLogChunks({ lines, partial: '', entries: [{ t: '', m: 'got prompt' }] })
      partial = assembleLogChunks({ lines, partial, entries: [{ t: '', m: ' 9f0526fd\n' }] })
      expect(lines).toEqual(['got prompt 9f0526fd'])
      expect(partial).toBe('')
   })
})
