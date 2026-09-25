import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'
import {
   ENHANCER_KEYS,
   SHORTCUT_KEYS,
   type EnhancerShortcut,
   type Shortcut,
} from 'src/cli/serve/web/state/shortcuts.ts'

/** every key the panel binds, as the shortcuts popup lists it. The jump and enhancer rows are
 * DERIVED from their key tables (a Record, so a new shortcut without a line fails typecheck); the
 * prompt editor rows name their codemirror bindings, which tests/serve-web-shortcut-catalog.test.ts
 * checks against promptExtensions.ts */
export type ShortcutRow = { keys: string[]; what: string; cm?: string[] }
export type ShortcutGroup = { title: string; rows: ShortcutRow[] }

const JUMP_WHAT: Record<Shortcut, string> = {
   'focus-prompt': 'focus the first prompt',
   'open-loras': 'open the lora picker',
   'open-enhancer': 'open the prompt enhancer',
   'rename-draft': 'rename the draft',
   'duplicate-draft': 'duplicate the draft',
   'toggle-menu': 'fold or unfold the menu',
   'toggle-blur': 'blur or unblur the results',
}

const ENHANCER_WHAT: Record<EnhancerShortcut, string> = {
   enhance: 'enhance the prompt',
   apply: 'apply the rewrite to the prompt',
}

const cap = (mod: string, k: string): string => (/^F\d{1,2}$/.test(k) ? k : `${mod}${k}`)

export function shortcutCatalog(mod: string = MOD_KEY): ShortcutGroup[] {
   const jumps = (Object.keys(JUMP_WHAT) as Shortcut[]).map((s) => ({
      keys: [cap(mod, SHORTCUT_KEYS[s])],
      what: JUMP_WHAT[s],
   }))
   const enhancer = (Object.keys(ENHANCER_WHAT) as EnhancerShortcut[]).map((s) => ({
      keys: [cap(mod, ENHANCER_KEYS[s])],
      what: ENHANCER_WHAT[s],
   }))
   return [
      {
         title: 'anywhere',
         rows: [
            { keys: [`${mod}⏎`], what: 'run the draft' },
            { keys: [`${mod}K`, `${mod}J`], what: 'search every workflow and draft' },
            { keys: [`${mod}1 … ${mod}8`], what: 'open tab 1 to 8' },
            { keys: [`${mod}9`], what: 'open the last tab' },
            { keys: [`${mod}PageUp`, `${mod}PageDown`], what: 'previous or next tab, wrapping' },
            ...jumps,
            { keys: [`${mod}A`], what: 'select all in the field you are in' },
            { keys: ['Esc'], what: 'close the popup on top' },
         ],
      },
      {
         title: 'prompt editor',
         rows: [
            {
               keys: [`${mod}↑`, `${mod}↓`],
               what: 'weight of the word or selection up or down',
               cm: ['Mod-ArrowUp', 'Mod-ArrowDown', 'Ctrl-ArrowUp', 'Ctrl-ArrowDown'],
            },
            { keys: [`${mod}/`], what: 'comment the line in or out', cm: ['Mod-/'] },
            { keys: [`${mod}⇧-`], what: 'make the line negative, or positive again', cm: ['Mod-Shift--', 'Mod-_'] },
            { keys: ['⌥↑', '⌥↓'], what: 'move the line up or down', cm: ['Alt-ArrowUp', 'Alt-ArrowDown'] },
            { keys: [`${mod}Z`, `${mod}⇧Z`], what: 'undo, redo' },
            { keys: ['↑', '↓', '⏎', 'Esc'], what: 'in the completion list: move, pick, dismiss' },
         ],
      },
      {
         title: 'prompt enhancer',
         rows: [...enhancer, { keys: [`${mod}⏎`], what: 'run with the rewrite, the prompt stays as it is' }],
      },
      {
         title: 'lightbox',
         rows: [
            { keys: ['↑', '↓'], what: 'previous or next image of the gallery' },
            { keys: ['scroll'], what: 'zoom at the pointer, drag to pan' },
            { keys: ['double click'], what: 'back to fit' },
            { keys: ['Esc'], what: 'close' },
         ],
      },
      {
         title: 'search and history pickers',
         rows: [
            { keys: ['↑', '↓'], what: 'move' },
            { keys: ['⏎'], what: 'open the pick' },
            { keys: ['Esc'], what: 'close' },
         ],
      },
      {
         title: 'renaming',
         rows: [
            { keys: ['⏎'], what: 'keep the new name' },
            { keys: ['Esc'], what: 'cancel' },
         ],
      },
   ]
}
