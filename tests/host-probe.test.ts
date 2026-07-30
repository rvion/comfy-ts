import { describe, expect, it } from 'bun:test'
import { probeVerdict, WS_ALIVE_MS } from 'src/cli/tui/state/HostSt.ts'

// his repro 2026-07-30: 'windows-1 appears offline' while the browser tab kept
// generating — ComfyUI is single-threaded, NEW connects stall mid-generation
// while the established ws streams. The verdict is pure, so it tests headless.
describe('probeVerdict', () => {
   const now = 1_000_000

   it('http ok → up, via reflects the socket', () => {
      expect(probeVerdict({ httpOk: true, wsOpen: true, lastWsMessageAt: null, now })).toEqual({
         status: 'up',
         via: 'ws',
      })
      expect(probeVerdict({ httpOk: true, wsOpen: false, lastWsMessageAt: null, now })).toEqual({
         status: 'up',
         via: 'http',
      })
   })

   it('http fail + ws talked recently → up via ws (busy server, his repro)', () => {
      expect(probeVerdict({ httpOk: false, wsOpen: true, lastWsMessageAt: now - 2000, now })).toEqual({
         status: 'up',
         via: 'ws',
      })
   })

   it('http fail + ws silent past the window → down (half-open sockets never revive)', () => {
      expect(probeVerdict({ httpOk: false, wsOpen: true, lastWsMessageAt: now - WS_ALIVE_MS, now })).toEqual({
         status: 'down',
         via: null,
      })
      expect(probeVerdict({ httpOk: false, wsOpen: true, lastWsMessageAt: null, now })).toEqual({
         status: 'down',
         via: null,
      })
   })

   it('http fail + no ws at all → down, whatever the recency says', () => {
      expect(probeVerdict({ httpOk: false, wsOpen: false, lastWsMessageAt: now - 100, now })).toEqual({
         status: 'down',
         via: null,
      })
   })
})
