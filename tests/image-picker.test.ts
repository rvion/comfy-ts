import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyTS } from 'src/state.ts'
import { hasImageExtension, listImageDir, parentDir } from 'src/cli/tui/imagePicker/fsListing.ts'
import { PickerPrefs, pickerPrefs, RECENTS_CAP } from 'src/cli/tui/imagePicker/pickerPrefs.ts'

// the global registration is process-wide state (comfyts-singleton precedent):
// run on an OWN temp root, restore whatever another test file registered
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let comfy: ComfyTS
let host: ComfyHost<'picker-host'>
let root: string
let imagesDir: string

const EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   root = mkdtempSync(join(tmpdir(), 'comfy-ts-picker-'))
   comfy = new ComfyTS({ rootPath: root })
   host = comfy.host({ id: 'picker-host', host: '127.0.0.1', port: 65499 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
   // fixture tree: a real decodable jpg (preview test), stub images, noise
   imagesDir = join(root, 'pics')
   mkdirSync(join(imagesDir, 'sub'), { recursive: true })
   writeFileSync(join(imagesDir, 'b.jpg'), 'stub')
   writeFileSync(join(imagesDir, 'a.png'), 'stub')
   writeFileSync(join(imagesDir, 'notes.txt'), 'not an image')
   writeFileSync(join(imagesDir, '.hidden.png'), 'dotfile')
   writeFileSync(join(imagesDir, 'sub', 'c.webp'), 'stub')
   cpSync(join(import.meta.dir, '..', 'examples', 'images', 'dog_512x512.jpg'), join(imagesDir, 'dog.jpg'))
})

afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

describe('fsListing (pure fs layer)', () => {
   it('lists dirs first then images, alphabetical, dotfiles skipped, extension-filtered', () => {
      const listing = listImageDir(imagesDir, EXTS)
      expect(listing.dirs).toEqual(['sub'])
      expect(listing.images).toEqual(['a.png', 'b.jpg', 'dog.jpg'])
   })

   it('extension filter narrows the images, never the dirs', () => {
      const listing = listImageDir(imagesDir, ['png'])
      expect(listing.dirs).toEqual(['sub'])
      expect(listing.images).toEqual(['a.png'])
   })

   it('unreadable dir throws loud (never a silent empty listing)', () => {
      expect(() => listImageDir(join(imagesDir, 'does-not-exist'), EXTS)).toThrow()
   })

   it('parentDir walks up and the fs root is its own parent', () => {
      expect(parentDir(join(imagesDir, 'sub'))).toBe(imagesDir)
      expect(parentDir('/')).toBe('/')
   })

   it('hasImageExtension is case-insensitive and wants a real extension', () => {
      expect(hasImageExtension('photo.PNG', ['png'])).toBe(true)
      expect(hasImageExtension('noext', EXTS)).toBe(false)
      expect(hasImageExtension('.hidden', EXTS)).toBe(false)
   })
})

describe('PickerPrefs (favorites/recents/lastFolder store)', () => {
   it('round-trips through its human-editable json file', () => {
      const path = join(root, 'prefs-a', 'image-picker.json')
      const a = new PickerPrefs(path)
      a.toggleFavorite('/fav/one')
      a.toggleFavorite('/fav/two')
      a.recordPick(join(imagesDir, 'a.png'))
      // the file is plain readable json, letter-driven, hand-editable
      const onDisk = JSON.parse(readFileSync(path, 'utf8'))
      expect(onDisk).toEqual({
         favorites: ['/fav/one', '/fav/two'],
         recents: [join(imagesDir, 'a.png')],
         lastFolder: imagesDir,
      })
      // a fresh instance loads the same state back
      const b = new PickerPrefs(path)
      expect(b.favorites).toEqual(['/fav/one', '/fav/two'])
      expect(b.recents).toEqual([join(imagesDir, 'a.png')])
      expect(b.lastFolder).toBe(imagesDir)
      // toggling off removes and persists
      b.toggleFavorite('/fav/one')
      expect(new PickerPrefs(path).favorites).toEqual(['/fav/two'])
   })

   it('recents dedupe to newest-first and cap at RECENTS_CAP', () => {
      const p = new PickerPrefs(join(root, 'prefs-b', 'image-picker.json'))
      p.recordPick('/img/1.png')
      p.recordPick('/img/2.png')
      p.recordPick('/img/1.png') // re-pick moves to front, no duplicate
      expect(p.recents).toEqual(['/img/1.png', '/img/2.png'])
      for (let i = 0; i < RECENTS_CAP + 5; i++) p.recordPick(`/img/bulk-${i}.png`)
      expect(p.recents.length).toBe(RECENTS_CAP)
      expect(p.recents[0]).toBe(`/img/bulk-${RECENTS_CAP + 4}.png`)
   })

   it('corrupt file logs and starts fresh, never throws', () => {
      const path = join(root, 'prefs-c', 'image-picker.json')
      mkdirSync(join(root, 'prefs-c'), { recursive: true })
      writeFileSync(path, '{ this is not json')
      const p = new PickerPrefs(path)
      expect(p.favorites).toEqual([])
      expect(p.recents).toEqual([])
      expect(p.lastFolder).toBeNull()
   })

   it('wrong-typed fields are dropped, valid ones kept', () => {
      const path = join(root, 'prefs-d', 'image-picker.json')
      mkdirSync(join(root, 'prefs-d'), { recursive: true })
      writeFileSync(path, JSON.stringify({ favorites: ['/ok', 42], recents: 'nope', lastFolder: '/last' }))
      const p = new PickerPrefs(path)
      expect(p.favorites).toEqual(['/ok'])
      expect(p.recents).toEqual([])
      expect(p.lastFolder).toBe('/last')
   })
})

describe('ImagePickerSt (overlay state machine)', () => {
   it('activate on an image var opens the picker; browse lists, filters, navigates, picks', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'picker-nav-test',
         vars: { image: v.image('', { folder: imagesDir }), steps: v.int(8) },
         build: () => {},
      })
      const st = new TuiSt(wf)
      const ip = st.imagePicker

      // ⏎/→ on the image var row opens the overlay (TuiSt.activate, ONE code path)
      st.selIx = 0
      st.activate()
      expect(st.mode).toBe('overlay-image')
      // value unset + no lastFolder yet → opts.folder wins the open order
      expect(ip.folder).toBe(imagesDir)
      // dirs first, then images, alphabetical
      expect(ip.rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
         'dir:sub',
         'image:a.png',
         'image:b.jpg',
         'image:dog.jpg',
      ])

      // plain chars ALWAYS filter (LorasSt precedent)
      ip.filterInput('a')
      expect(ip.rows.map((r) => r.name)).toEqual(['a.png'])
      ip.filterBackspace()
      expect(ip.rows.length).toBe(4)

      // → enters the highlighted dir, ← goes back to the parent, filter resets
      ip.filterInput('su')
      ip.enter()
      expect(ip.folder).toBe(join(imagesDir, 'sub'))
      expect(ip.filter).toBe('')
      expect(ip.rows.map((r) => r.name)).toEqual(['c.webp'])
      ip.goParent()
      expect(ip.folder).toBe(imagesDir)

      // ⏎ on an image SELECTS: absolute path into the var, recents + lastFolder recorded
      ip.move(1) // sub → a.png
      expect(ip.current?.name).toBe('a.png')
      ip.commit()
      expect(st.mode).toBe('nav')
      expect(wf.vars.image.value).toBe(join(imagesDir, 'a.png'))
      expect(pickerPrefs().recents[0]).toBe(join(imagesDir, 'a.png'))
      expect(pickerPrefs().lastFolder).toBe(imagesDir)
      // write-through: the prefs file exists under .comfy-ts/ and is valid json
      const onDisk = JSON.parse(readFileSync(join(comfy.baseFolder, 'image-picker.json'), 'utf8'))
      expect(onDisk.recents[0]).toBe(join(imagesDir, 'a.png'))

      // reopening starts at dirname(value) now that the value is set
      ip.begin()
      expect(st.mode).toBe('overlay-image')
      expect(ip.folder).toBe(imagesDir)
      st.dispose()
   })

   it('favorites toggle (folders only), pane cycling, recents pick, vanished recent skipped', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'picker-pane-test',
         vars: { image: v.image('', { folder: imagesDir }) },
         build: () => {},
      })
      const st = new TuiSt(wf)
      const ip = st.imagePicker
      st.selIx = 0
      st.activate()

      // ⌃F on a dir row favorites THAT dir
      expect(ip.current?.kind).toBe('dir')
      ip.toggleFavorite()
      expect(pickerPrefs().favorites).toContain(join(imagesDir, 'sub'))
      // ⌃F on an image row favorites the CURRENT folder
      ip.move(1)
      expect(ip.current?.kind).toBe('image')
      ip.toggleFavorite()
      expect(pickerPrefs().favorites).toContain(imagesDir)

      // tab cycles browse → favorites → recents → browse
      ip.cyclePane()
      expect(ip.pane).toBe('favorites')
      expect(ip.rows.map((r) => r.path)).toEqual([join(imagesDir, 'sub'), imagesDir])
      // ⏎ on a favorite jumps browse into that folder
      ip.commit()
      expect(ip.pane).toBe('browse')
      expect(ip.folder).toBe(join(imagesDir, 'sub'))

      // recents pane: a vanished path renders missing and is skipped on ⏎
      pickerPrefs().recordPick(join(imagesDir, 'ghost.png'))
      ip.cyclePane()
      ip.cyclePane()
      expect(ip.pane).toBe('recents')
      const { runInAction } = await import('mobx')
      const ghost = ip.rows.find((r) => r.path.endsWith('ghost.png'))
      expect(ghost?.kind === 'image' && ghost.missing).toBe(true)
      runInAction(() => (ip.ix = ip.rows.findIndex((r) => r.path.endsWith('ghost.png'))))
      ip.commit()
      expect(st.mode).toBe('overlay-image') // still open, value untouched
      expect(wf.vars.image.value).toBe('')
      // a present recent picks fine
      runInAction(() => (ip.ix = ip.rows.findIndex((r) => r.path.endsWith('a.png'))))
      ip.commit()
      expect(st.mode).toBe('nav')
      expect(wf.vars.image.value).toBe(join(imagesDir, 'a.png'))

      // cleanup the favorites so other tests see a known state
      pickerPrefs().toggleFavorite(join(imagesDir, 'sub'))
      pickerPrefs().toggleFavorite(imagesDir)
      st.dispose()
   })

   it('esc cancels with the value untouched', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'picker-cancel-test',
         vars: { image: v.image(join(imagesDir, 'b.jpg'), { folder: imagesDir }) },
         build: () => {},
      })
      const st = new TuiSt(wf)
      st.selIx = 0
      st.activate()
      st.imagePicker.move(2)
      st.imagePicker.cancel()
      expect(st.mode).toBe('nav')
      expect(wf.vars.image.value).toBe(join(imagesDir, 'b.jpg'))
      st.dispose()
   })

   it('highlighted image previews through the shared overlay slot (debounced); a bad file lands a note', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'picker-preview-test',
         vars: { image: v.image('', { folder: imagesDir }) },
         build: () => {},
      })
      const st = new TuiSt(wf)
      const { runInAction } = await import('mobx')
      // deterministic ansi path, no terminal protocol
      runInAction(() => (st.settings.previewRenderer = 'pixel'))
      const ip = st.imagePicker
      st.selIx = 0
      st.activate()

      // highlight the real jpg (rows: sub, a.png, b.jpg, dog.jpg)
      runInAction(() => (ip.ix = 3))
      expect(ip.highlightedImage).toBe(join(imagesDir, 'dog.jpg'))
      await Bun.sleep(350) // debounce ~120ms + sharp render
      expect(st.preview.overlay?.name).toBe('dog.jpg')
      expect(st.preview.overlay?.ansi).not.toBeNull()
      expect(st.preview.overlay?.note).toBeNull()

      // a stub 'png' sharp cannot decode → note placeholder, never a crash
      runInAction(() => (ip.ix = 1))
      await Bun.sleep(350)
      expect(st.preview.overlay?.name).toBe('a.png')
      expect(st.preview.overlay?.ansi).toBeNull()
      expect(st.preview.overlay?.note).not.toBeNull()

      // closing the overlay clears the slot (reaction fires on mode change)
      ip.cancel()
      await Bun.sleep(250)
      expect(st.preview.overlay).toBeNull()
      st.dispose()
   })
})

describe('tui render smoke (real ink mount, pipe stdout — never a look judgement)', () => {
   it('the overlay OPENS and lists the folder entries', () => {
      const res = spawnSync('bun', [join(import.meta.dir, 'tui-smoke.driver.tsx')], {
         encoding: 'utf8',
         timeout: 30_000,
      })
      expect(res.stderr ?? '').not.toContain('error')
      expect(res.stdout).toContain('SMOKE_OK')
      // the ink frame carries the pane strip and the listed entries
      expect(res.stdout).toContain('browse')
      expect(res.stdout).toContain('favorites')
      expect(res.stdout).toContain('portraits/')
      expect(res.stdout).toContain('alpha.png')
      expect(res.stdout).toContain('beta.jpg')
      expect(res.status).toBe(0)
   })
})
