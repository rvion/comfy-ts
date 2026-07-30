import { Box, Text, useApp, useInput, useStdin } from 'ink'
import { observer } from 'mobx-react-lite'
import { basename } from 'pathe'
import { DraftsOverlay } from 'src/cli/tui/components/DraftsOverlay.tsx'
import { Header } from 'src/cli/tui/components/Header.tsx'
import { HostPanel } from 'src/cli/tui/components/HostPanel.tsx'
import { HostsOverlay } from 'src/cli/tui/components/HostsOverlay.tsx'
import { LorasOverlay } from 'src/cli/tui/components/LorasOverlay.tsx'
import { ChoiceOverlay, SizeOverlay } from 'src/cli/tui/components/PickerOverlays.tsx'
import { PreviewPanel } from 'src/cli/tui/components/PreviewPanel.tsx'
import { PromptOverlay } from 'src/cli/tui/components/PromptOverlay.tsx'
import { KeyBar, ProgressLine } from 'src/cli/tui/components/StatusBar.tsx'
import { ImagePickerOverlay } from 'src/cli/tui/imagePicker/ImagePickerOverlay.tsx'
import { LogsPanel } from 'src/cli/tui/components/LogsPanel.tsx'
import { TextOverlay } from 'src/cli/tui/components/TextOverlay.tsx'
import { TreePanel } from 'src/cli/tui/components/TreePanel.tsx'
import { VarsPanel } from 'src/cli/tui/components/VarsPanel.tsx'
import { parseModifyOtherKeysEnter } from 'src/cli/tui/keys.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

export const TuiApp = observer((p: { st: TuiSt }) => {
   const app = useApp()
   const s = p.st
   const stdin = useStdin()

   useInput(
      (input, key) => {
         // modifyOtherKeys terminals (vscode/xterm.js) deliver modified ⏎ as
         // the unparsed literal '[27;<mods>;13~' — fold it back into key flags
         // so every branch below sees a normal (modified) return
         const modEnter = parseModifyOtherKeysEnter(input)
         if (modEnter != null) {
            input = ''
            key = { ...key, ...modEnter }
         }
         // ⌃R runs from ANY mode (plain letters type into filters/editors)
         if (key.ctrl && input === 'r') return void s.exec.run()
         if (s.mode === 'edit' || s.mode === 'overlay-text') {
            const ed = s.editor
            const multi = s.mode === 'overlay-text'
            if (key.escape) return ed.cancel()
            if (multi && key.ctrl && input === 's') return ed.commitMultiline()
            // ⏎ SAVES; newline via ⇧⏎ (kitty/modifyOtherKeys terminals) or ⌥⏎ (everywhere)
            if (multi && key.return && (key.shift || key.meta)) return ed.newline()
            if (key.return) return multi ? ed.commitMultiline() : ed.commitInline()
            // word ops: alt+backspace (ESC-DEL) or ctrl+w
            if ((key.meta && (key.backspace || key.delete)) || (key.ctrl && input === 'w')) return ed.deleteWordBack()
            // mac sends backspace as 'delete' in some terminals — treat both as backspace
            if (key.backspace || key.delete) return ed.backspace()
            // word jumps: alt+arrows (ESC[1;3C/D) or ESC-b / ESC-f (option-as-meta)
            if (key.meta && key.leftArrow) return ed.wordLeft()
            if (key.meta && key.rightArrow) return ed.wordRight()
            if (key.meta && input === 'b') return ed.wordLeft()
            if (key.meta && input === 'f') return ed.wordRight()
            // line ops: ⌘←→ (kitty terminals report ⌘ as super), Home/End, and
            // ⌃A/⌃E — 'natural text editing' terminals (iTerm2 preset, VSCode on
            // macOS) rewrite ⌘←/⌘→ to ^A/^E, so those MUST be line-wise too
            if ((key.super && key.leftArrow) || key.home || (key.ctrl && input === 'a')) return ed.lineHome()
            if ((key.super && key.rightArrow) || key.end || (key.ctrl && input === 'e')) return ed.lineEnd()
            // ⌥↑↓ move the logical line (before plain ↑↓ cursor moves)
            if (multi && key.meta && key.upArrow) return ed.moveLine(-1)
            if (multi && key.meta && key.downArrow) return ed.moveLine(1)
            // comment toggle: ⌘/ (kitty) · ⌃/ (kitty, or legacy 0x1f byte) · ⌥/
            if (multi && input === '/' && (key.super || key.ctrl || key.meta)) return ed.toggleComment()
            if (multi && input.length === 1 && input.charCodeAt(0) === 0x1f) return ed.toggleComment()
            if (key.leftArrow) return ed.cursorLeft()
            if (key.rightArrow) return ed.cursorRight()
            if (multi && key.upArrow) return ed.cursorUp()
            if (multi && key.downArrow) return ed.cursorDown()
            if (key.ctrl && input === 'u') return ed.killToStart()
            if (key.ctrl && input === 'k') return ed.killToEnd()
            if (input && !key.ctrl && !key.meta) return ed.input(input)
            return
         }
         if (s.mode === 'overlay-choice' || s.mode === 'overlay-size') {
            const pk = s.picker
            if (key.escape) return s.editor.cancel()
            if (key.return) return pk.commit()
            if (key.upArrow) return pk.move(-1)
            if (key.downArrow) return pk.move(1)
            if ((key.meta && (key.backspace || key.delete)) || (key.ctrl && input === 'w')) return pk.filterDeleteWord()
            if (key.backspace || key.delete) return pk.filterBackspace()
            if (input && !key.ctrl && !key.meta) return pk.filterInput(input)
            return
         }
         if (s.mode === 'overlay-loras') {
            const lo = s.loras
            if (key.escape) return s.editor.cancel()
            if (key.ctrl && input === 'a') return lo.setAll(true)
            if (key.ctrl && input === 'n') return lo.setAll(false)
            if (key.ctrl && input === 'k') return lo.beginKeyword()
            if (key.return || input === ' ') return lo.toggle()
            if (key.upArrow) return lo.move(-1)
            if (key.downArrow) return lo.move(1)
            if (key.leftArrow) return lo.adjust(-0.05)
            if (key.rightArrow) return lo.adjust(0.05)
            if ((key.meta && (key.backspace || key.delete)) || (key.ctrl && input === 'w')) return lo.filterDeleteWord()
            if (key.backspace || key.delete) return lo.filterBackspace()
            if (input && !key.ctrl && !key.meta) return lo.filterInput(input)
            return
         }
         if (s.mode === 'overlay-image') {
            const ip = s.imagePicker
            if (key.escape) return ip.cancel()
            if (key.tab || input === '\t') return ip.cyclePane()
            if (key.ctrl && input === 'f') return ip.toggleFavorite()
            if (key.return) return ip.commit()
            if (key.upArrow) return ip.move(-1)
            if (key.downArrow) return ip.move(1)
            if (key.leftArrow) return ip.goParent()
            if (key.rightArrow) return ip.enter()
            if ((key.meta && (key.backspace || key.delete)) || (key.ctrl && input === 'w')) return ip.filterDeleteWord()
            if (key.backspace || key.delete) return ip.filterBackspace()
            if (input && !key.ctrl && !key.meta) return ip.filterInput(input)
            return
         }
         if (s.mode === 'tree') {
            const tr = s.tree
            // the `/` filter owns plain keys while active (letters type into it)
            if (tr.filtering) {
               if (key.escape) return tr.clearFilter()
               if (key.return) return void tr.commit()
               if (key.upArrow) return tr.move(-1)
               if (key.downArrow) return tr.move(1)
               if (key.leftArrow) return tr.fold()
               if (key.rightArrow) return tr.unfold()
               if (key.backspace || key.delete) return tr.filterBackspace()
               if (input && !key.ctrl && !key.meta) return tr.filterInput(input)
               return
            }
            if (key.escape) return tr.filter !== '' ? tr.clearFilter() : tr.blur()
            if (input === 't') return tr.blur()
            if (input === '/') return tr.beginFilter()
            if (key.return || input === ' ') return void tr.commit()
            if (key.upArrow) return tr.move(-1)
            if (key.downArrow) return tr.move(1)
            if (key.leftArrow) return tr.fold()
            if (key.rightArrow) return tr.unfold()
            if (input === 'v') return tr.blur()
            if (input === 'n') return tr.promptNewDraft()
            if (input === 'e') return tr.draftOp('rename')
            if (input === 'c') return tr.draftOp('duplicate')
            if (input === 'x') return tr.draftOp('delete')
            // global keys keep working from the tree (c is taken by duplicate)
            if (input === 'r') return void s.exec.run()
            if (input === 's') return s.exec.randomizeSeedAndRun()
            if (input === 'd') return s.drafts.begin()
            if (input === 'h') return s.host.beginPicker()
            if (input === 'a') return s.host.begin()
            if (input === 'p') return s.preview.beginMenu()
            if (input === 'o') return s.exec.openLastOutput()
            if (input === 'q') {
               s.onExit()
               return app.exit()
            }
            return
         }
         if (s.mode === 'host') {
            const h = s.host
            if (key.escape || input === 'a' || input === 'v') return h.blur()
            if (input === 'h') return h.beginPicker()
            if (key.return || input === ' ') return void h.commit()
            if (key.upArrow) return h.move(-1)
            if (key.downArrow) return h.move(1)
            if (input === 'q') {
               s.onExit()
               return app.exit()
            }
            return
         }
         if (s.mode === 'overlay-hosts') {
            const h = s.host
            if (key.escape || input === 'h') return h.cancelPicker()
            if (key.return || input === ' ') return h.commitPicker()
            if (key.upArrow) return h.pickerMove(-1)
            if (key.downArrow) return h.pickerMove(1)
            return
         }
         if (s.mode === 'preview') {
            const pv = s.preview
            // ⏎ CONFIRMS (closes): ←→ already changed the value in place
            if (key.escape || key.return || input === 'p' || input === 'v') return pv.blurMenu()
            if (key.upArrow) return pv.menuMove(-1)
            if (key.downArrow) return pv.menuMove(1)
            if (key.leftArrow) return pv.menuCycle(-1)
            if (key.rightArrow || input === ' ') return pv.menuCycle(1)
            // global keys keep working from the menu (mirrors the tree)
            if (input === 'r') return void s.exec.run()
            if (input === 's') return s.exec.randomizeSeedAndRun()
            if (input === 'd') return s.drafts.begin()
            if (input === 'h') return s.host.beginPicker()
            if (input === 'a') return s.host.begin()
            if (input === 'o') return s.exec.openLastOutput()
            if (input === 'q') {
               s.onExit()
               return app.exit()
            }
            return
         }
         if (s.mode === 'overlay-drafts') {
            const d = s.drafts
            if (key.escape) return s.editor.cancel()
            if (key.return) return d.commit()
            if (key.upArrow) return d.move(-1)
            if (key.downArrow) return d.move(1)
            if (input === 'n') return d.promptNew('overlay-drafts')
            if (input === 'e' && d.selectedName != null)
               return d.promptRename(d.selectedName, undefined, 'overlay-drafts')
            if (input === 'c' && d.selectedName != null)
               return d.promptDuplicate(d.selectedName, undefined, 'overlay-drafts')
            if (input === 'x' && d.selectedName != null) {
               d.deleteDraft(d.selectedName)
               return d.begin()
            }
            return
         }
         if (input === 'q') {
            s.onExit()
            return app.exit()
         }
         if (key.upArrow) return s.moveSel(-1)
         if (key.downArrow) return s.moveSel(1)
         // spatial nav: the tree lives on the left, editing on the right
         if (key.leftArrow) return s.tree.focus()
         if (key.rightArrow || key.return || input === ' ') return s.activate()
         if (s.navKey(input)) return
         if (input === '/') {
            s.tree.focus()
            return s.tree.beginFilter()
         }
         if (input === 'e') return s.drafts.beginRename()
         if (input === 'r') return void s.exec.run()
         if (input === 's') return s.exec.randomizeSeedAndRun()
         if (input === 't' || input === 'w') return s.tree.focus()
         if (input === 'h') return s.host.beginPicker()
         if (input === 'a') return s.host.begin()
         if (input === 'd') return s.drafts.begin()
         if (input === 'p') return s.preview.beginMenu()
         if (input === 'o') return s.exec.openLastOutput()
         if (input === 'c') return void s.exec.copyWorkflowJson()
         if (input === 'C') return void s.exec.copyApiJson()
      },
      // render-only when the terminal can't do raw input (pipes, CI).
      // strict boolean: ink only skips on `isActive === false`, and bun pipes
      // report isTTY as undefined
      { isActive: stdin.isRawModeSupported === true },
   )

   return (
      <Box flexDirection="column" minHeight={s.termRows - 1}>
         <Header st={s} />
         <Box flexDirection="row" flexGrow={1}>
            <TreePanel st={s} />
            <Box flexDirection="column" flexGrow={1}>
               {/* ink has no z-order: the overlay replaces the vars panel while open */}
               {s.mode === 'edit' && s.editor.isCustom ? (
                  <PromptOverlay st={s} />
               ) : s.mode === 'host' ? (
                  <HostPanel st={s} />
               ) : s.mode === 'overlay-text' ? (
                  <TextOverlay st={s} />
               ) : s.mode === 'overlay-choice' ? (
                  <ChoiceOverlay st={s} />
               ) : s.mode === 'overlay-size' ? (
                  <SizeOverlay st={s} />
               ) : s.mode === 'overlay-loras' ? (
                  <LorasOverlay st={s} />
               ) : s.mode === 'overlay-image' ? (
                  <ImagePickerOverlay st={s} />
               ) : s.mode === 'overlay-drafts' ? (
                  <DraftsOverlay st={s} />
               ) : s.mode === 'overlay-hosts' ? (
                  <HostsOverlay st={s} />
               ) : (
                  <VarsPanel st={s} />
               )}
               <Box paddingX={1}>
                  <ProgressLine st={s} />
               </Box>
               {s.exec.outputs.length > 0 && (
                  <Box borderStyle="round" paddingX={1} flexDirection="column">
                     {s.exec.outputs.map((o) => (
                        <Text key={o} color="green" wrap="truncate">
                           {basename(o)} <Text color="gray">{o}</Text>
                        </Text>
                     ))}
                  </Box>
               )}
               {/* hidden while an overlay owns the vars area: typing space > logs */}
               {!s.mode.startsWith('overlay-') && !(s.mode === 'edit' && s.editor.isCustom) && <LogsPanel st={s} />}
            </Box>
            {(s.preview.show || s.preview.menuOpen) && <PreviewPanel st={s} />}
         </Box>
         <KeyBar st={s} />
      </Box>
   )
})
