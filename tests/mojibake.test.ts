import { describe, expect, it } from 'bun:test'
import { repairMojibake } from 'src/utils/mojibake.ts'

describe('repairMojibake', () => {
   it('his repro: tqdm bars arrive cp1252-mangled', () => {
      // '█' (E2 96 88) decoded as cp1252 = 'â' + en-dash + 'ˆ'
      const mangled = '100%|â–ˆâ–ˆ| 8/8 [00:05<00:00,  1.50it/s]'
      expect(repairMojibake(mangled)).toBe('100%|██| 8/8 [00:05<00:00,  1.50it/s]')
   })

   it('plain ascii passes through untouched', () => {
      expect(repairMojibake('[INFO] Prompt executed in 6.21 seconds')).toBe('[INFO] Prompt executed in 6.21 seconds')
   })

   it('genuine accented text is NOT wrecked', () => {
      // 'é' alone is invalid UTF-8 as byte E9 → repair declines
      expect(repairMojibake('exécution terminée')).toBe('exécution terminée')
   })

   it('already-correct unicode with no cp1252 mapping is left alone', () => {
      expect(repairMojibake('progress █ done ✓')).toBe('progress █ done ✓')
   })
})
