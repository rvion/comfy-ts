import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { listWindow } from 'src/cli/tui/listWindow.ts'

// his repro 2026-07-31: "on small terminal, the (t)ree section now cause
// vertical overflow ; tree should not be higher than available space. tree,
// should be scrollable"

describe('listWindow (pure): budget-inclusive scroll window around a selection', () => {
   it('everything fits: full range, no markers', () => {
      expect(listWindow({ count: 5, selected: 2, budget: 10 })).toEqual({
         start: 0,
         end: 5,
         moreAbove: false,
         moreBelow: false,
      })
      expect(listWindow({ count: 10, selected: 9, budget: 10 })).toEqual({
         start: 0,
         end: 10,
         moreAbove: false,
         moreBelow: false,
      })
   })

   it('selection near the top: window pinned at 0, only a below marker', () => {
      const w = listWindow({ count: 30, selected: 0, budget: 10 })
      expect(w).toEqual({ start: 0, end: 9, moreAbove: false, moreBelow: true })
   })

   it('selection in the middle: both markers, selection inside the slice', () => {
      const w = listWindow({ count: 30, selected: 15, budget: 10 })
      expect(w.moreAbove).toBe(true)
      expect(w.moreBelow).toBe(true)
      // both markers eat 2 of the 10 lines
      expect(w.end - w.start).toBe(8)
      expect(w.start).toBeGreaterThan(0)
      expect(w.end).toBeLessThan(30)
      expect(w.start).toBeLessThanOrEqual(15)
      expect(w.end).toBeGreaterThan(15)
   })

   it('selection at the bottom: window pinned at the end, only an above marker', () => {
      const w = listWindow({ count: 30, selected: 29, budget: 10 })
      expect(w).toEqual({ start: 21, end: 30, moreAbove: true, moreBelow: false })
   })

   it('total rendered lines never exceed the budget, whatever the selection', () => {
      for (let sel = 0; sel < 30; sel++) {
         const w = listWindow({ count: 30, selected: sel, budget: 7 })
         const lines = (w.moreAbove ? 1 : 0) + (w.end - w.start) + (w.moreBelow ? 1 : 0)
         expect(lines).toBeLessThanOrEqual(7)
         expect(sel).toBeGreaterThanOrEqual(w.start)
         expect(sel).toBeLessThan(w.end)
      }
   })

   it('walking the selection down scrolls the window monotonically', () => {
      let prevStart = 0
      for (let sel = 0; sel < 50; sel++) {
         const w = listWindow({ count: 50, selected: sel, budget: 12 })
         expect(w.start).toBeGreaterThanOrEqual(prevStart)
         prevStart = w.start
      }
   })

   it('degenerate budgets: 1 and 2 show the selection without markers', () => {
      expect(listWindow({ count: 30, selected: 15, budget: 1 })).toEqual({
         start: 15,
         end: 16,
         moreAbove: false,
         moreBelow: false,
      })
      const w2 = listWindow({ count: 30, selected: 15, budget: 2 })
      expect(w2.end - w2.start).toBe(2)
      expect(w2.moreAbove).toBe(false)
      expect(w2.moreBelow).toBe(false)
      expect(15).toBeGreaterThanOrEqual(w2.start)
      expect(15).toBeLessThan(w2.end)
   })

   it('empty list and zero budget yield an empty window', () => {
      expect(listWindow({ count: 0, selected: 0, budget: 10 })).toEqual({
         start: 0,
         end: 0,
         moreAbove: false,
         moreBelow: false,
      })
      expect(listWindow({ count: 30, selected: 5, budget: 0 })).toEqual({
         start: 5,
         end: 5,
         moreAbove: false,
         moreBelow: false,
      })
   })
})

describe('TreeSt viewport: the tree never claims more rows than measured', () => {
   // the global registration is process-wide state: isolate this file and
   // restore whatever another test file (workflow-builder) registered
   let stP: Promise<import('src/cli/tui/state/TuiSt.ts').TuiSt> | null = null
   let prior: unknown
   beforeAll(() => {
      prior = (globalThis as { comfyts?: unknown }).comfyts
      Reflect.deleteProperty(globalThis, 'comfyts')
   })
   afterAll(async () => {
      // kill the state tree's reactions BEFORE the global goes away, or they
      // fire "between tests" against a deleted `comfyts`
      if (stP != null) (await stP).dispose()
      if (prior != null) (globalThis as { comfyts?: unknown }).comfyts = prior
      else Reflect.deleteProperty(globalThis, 'comfyts')
   })
   const build = () => {
      stP ??= (async () => {
         const { ComfyTS } = await import('src/state.ts')
         const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
         const root = mkdtempSync(join(tmpdir(), 'comfy-ts-viewport-'))
         // a deep-ish flow tree so rows outnumber any small viewport
         const flows = join(root, 'flows')
         mkdirSync(flows, { recursive: true })
         for (let i = 0; i < 20; i++) writeFileSync(join(flows, `fam${i}-mode.cflow.ts`), '// stub')
         const comfy = new ComfyTS({ rootPath: root })
         const host = comfy.host({ id: 'viewport-host', host: '127.0.0.1', port: 65497 })
         const wf = host.defineWorkflow({ id: 'viewport-test', vars: {}, build: () => {} })
         const st = new TuiSt(wf)
         st.workflows.files = Array.from({ length: 20 }, (_, i) => join(flows, `fam${i}-mode.cflow.ts`))
         return st
      })()
      return stP.then((st) => {
         st.tree.setViewH(0)
         st.tree.ix = 0
         st.tree.clearFilter()
         return st
      })
   }

   it('window slice + markers fit the measured height minus the panel chrome', async () => {
      const st = await build()
      st.tree.setViewH(10) // measured panel height: 2 border rows + 8 content rows
      const w = st.tree.window
      const lines = (w.moreAbove ? 1 : 0) + (w.end - w.start) + (w.moreBelow ? 1 : 0)
      expect(st.tree.rows.length).toBeGreaterThan(8)
      expect(lines).toBeLessThanOrEqual(8)
   })

   it('the filter line costs one row of budget while active', async () => {
      const st = await build()
      st.tree.setViewH(10)
      const before = st.tree.window
      st.tree.beginFilter()
      const during = st.tree.window
      const count = (w: { start: number; end: number }) => w.end - w.start
      expect(count(during)).toBe(count(before) - 1)
   })

   it('moving the selection to the last row keeps it inside the window', async () => {
      const st = await build()
      st.tree.setViewH(9)
      st.tree.ix = st.tree.rows.length - 1
      const w = st.tree.window
      expect(st.tree.ix).toBeGreaterThanOrEqual(w.start)
      expect(st.tree.ix).toBeLessThan(w.end)
      expect(w.moreBelow).toBe(false)
      expect(w.moreAbove).toBe(true)
   })

   it('before any measurement the estimate fallback still yields a positive budget', async () => {
      const st = await build()
      expect(st.tree.viewBudget).toBeGreaterThan(0)
   })
})

describe('small-terminal frame smoke (his repro: tree overflowed the terminal)', () => {
   it('the real TuiApp frame at 14 rows never exceeds 14 lines and windows the tree', async () => {
      const { spawnSync } = await import('node:child_process')
      const { join } = await import('pathe')
      const res = spawnSync('bun', [join(import.meta.dir, 'tui-tree-smoke.driver.tsx')], {
         encoding: 'utf8',
         timeout: 30_000,
         env: { ...process.env, SMOKE_ROWS: '14' },
      })
      expect(res.stderr ?? '').not.toContain('error')
      expect(res.stdout).toContain('SMOKE_OK')
      expect(res.status).toBe(0)
      // the final ink frame is everything before the SMOKE_OK sentinel
      const frame = (res.stdout.split('SMOKE_OK')[0] ?? '').replace(/\n+$/, '')
      const frameLines = frame.split('\n')
      expect(frameLines.length).toBeLessThanOrEqual(14)
      // mid-list selection on 25 workflows in 14 rows: both scroll markers show
      expect(frame).toContain('…')
      // the selected workflow is inside the window
      expect(frame).toContain('fam12-mode')
   })
})

describe('VarsPanel viewport (reviewer follow-up: selection clipped off-screen on small terminals)', () => {
   let stP: Promise<import('src/cli/tui/state/TuiSt.ts').TuiSt> | null = null
   let prior: unknown
   beforeAll(() => {
      prior = (globalThis as { comfyts?: unknown }).comfyts
      Reflect.deleteProperty(globalThis, 'comfyts')
   })
   afterAll(async () => {
      if (stP != null) (await stP).dispose()
      if (prior != null) (globalThis as { comfyts?: unknown }).comfyts = prior
      else Reflect.deleteProperty(globalThis, 'comfyts')
   })
   const build = () => {
      stP ??= (async () => {
         const { ComfyTS } = await import('src/state.ts')
         const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
         const { v } = await import('src/vars/ComfyVars.ts')
         const root = mkdtempSync(join(tmpdir(), 'comfy-ts-vars-viewport-'))
         const comfy = new ComfyTS({ rootPath: root })
         const host = comfy.host({ id: 'vars-viewport-host', host: '127.0.0.1', port: 65495 })
         const wf = host.defineWorkflow({
            id: 'vars-viewport-test',
            vars: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`n${i}`, v.int(i)])),
            build: () => {},
         })
         return new TuiSt(wf)
      })()
      return stP.then((st) => {
         st.setVarsViewH(0)
         st.selIx = 0
         return st
      })
   }

   it('window slice + markers fit the measured height minus the border chrome', async () => {
      const st = await build()
      st.setVarsViewH(8) // 2 border rows + 6 content rows
      const w = st.varsWindow
      const lines = (w.moreAbove ? 1 : 0) + (w.end - w.start) + (w.moreBelow ? 1 : 0)
      expect(st.entries.length).toBe(14)
      expect(lines).toBeLessThanOrEqual(6)
   })

   it('the selection stays inside the window at both ends', async () => {
      const st = await build()
      st.setVarsViewH(8)
      st.selIx = 13
      expect(st.selIx).toBeGreaterThanOrEqual(st.varsWindow.start)
      expect(st.selIx).toBeLessThan(st.varsWindow.end)
      expect(st.varsWindow.moreAbove).toBe(true)
      expect(st.varsWindow.moreBelow).toBe(false)
   })

   it('compact mode: on while the list overflows, off when everything fits', async () => {
      const st = await build()
      st.setVarsViewH(8)
      expect(st.varsCompact).toBe(true)
      st.setVarsViewH(40)
      expect(st.varsCompact).toBe(false)
   })

   it('before any measurement the estimate fallback still yields a positive budget', async () => {
      const st = await build()
      expect(st.varsBudget).toBeGreaterThan(0)
   })

   it('frame smoke at 14 rows: the selected var stays visible under a tall prompt', async () => {
      const { spawnSync } = await import('node:child_process')
      const { join: joinPath } = await import('pathe')
      const res = spawnSync('bun', [joinPath(import.meta.dir, 'tui-tree-smoke.driver.tsx')], {
         encoding: 'utf8',
         timeout: 30_000,
         env: { ...process.env, SMOKE_ROWS: '14', SMOKE_MODE: 'vars' },
      })
      expect(res.stderr ?? '').not.toContain('error')
      expect(res.stdout).toContain('SMOKE_OK')
      expect(res.status).toBe(0)
      const frame = (res.stdout.split('SMOKE_OK')[0] ?? '').replace(/\n+$/, '')
      expect(frame.split('\n').length).toBeLessThanOrEqual(14)
      // the selected var, 12 rows deep behind a tall wrapping prompt, is on screen
      expect(frame).toContain('n12')
   })
})
