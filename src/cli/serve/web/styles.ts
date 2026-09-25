// the ONE stylesheet, injected by main.tsx — no css framework on purpose
// (agent/coding.md: prefer obvious code over a new dependency)
export const STYLES = /* css */ `
:root {
   --bg: #101217;
   --panel: #171a21;
   --panel-2: #1d2129;
   --border: #2a2f3a;
   --text: #e8eaf0;
   --dim: #8b93a7;
   --accent: #7aa2f7;
   --accent-dim: #33415e;
   --green: #9ece6a;
   --red: #f7768e;
   --amber: #e0af68;
}
* { box-sizing: border-box; }
/* every scroller: a thin thumb in the theme, no track. The system scrollbar is a 15px dark band
   under always-visible scrollbars, beside each panel's own padding and the split handle */
* { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--dim) 40%, transparent) transparent; }
html, body { margin: 0; height: 100%; }
body {
   background: var(--bg);
   color: var(--text);
   font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
#root { height: 100%; }
.app { display: flex; flex-direction: column; height: 100%; }
.cols { display: flex; flex: 1; min-height: 0; position: relative; }

/* ⌘K / ⌘J: every workflow and draft, fuzzy matched. Above the other modals, so it opens from
   inside the loras popup too */
.omni-overlay { z-index: 60; align-items: flex-start; padding-top: 12vh; }
.modal.omni { width: min(560px, 100%); max-height: min(70vh, 100%); }
.omni-list { padding: 4px; }
.omni-row {
   display: flex; width: 100%; gap: 8px; align-items: center;
   text-align: left; border: 0; background: none; color: var(--text); padding: 5px 10px;
   border-radius: 6px; cursor: pointer; font: inherit;
}
.omni-row:hover { background: var(--panel-2); }
.omni-row.sel { background: var(--accent-dim); color: #fff; }
.omni-row.workflow { margin-top: 6px; padding-top: 7px; padding-bottom: 7px; }
.omni-row.workflow:first-child { margin-top: 0; }
.omni-row.draft { padding-left: 38px; color: var(--dim); }
.omni-row.draft .icon { opacity: 0.6; flex-shrink: 0; }
.omni-row.draft.sel, .omni-row.draft:hover { color: var(--text); }
.omni-row.draft.open .omni-draft { color: var(--text); font-weight: 600; }
.omni-draft { overflow-wrap: anywhere; }
.omni-open { margin-left: auto; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--green); }
.omni-icon {
   display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
   width: 22px; height: 22px; border-radius: 6px; background: var(--panel-2);
}
.omni-path { min-width: 0; overflow-wrap: anywhere; }
.omni-folder { color: var(--dim); font-size: 12px; }
.omni-name { font-weight: 600; }
.omni-tags { margin-left: auto; display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
.omni-tag {
   font-size: 10.5px; line-height: 1; padding: 3px 6px; border-radius: 999px;
   color: var(--dim); border: 1px solid var(--border);
}
.omni-host { color: var(--dim); font-size: 11px; white-space: nowrap; margin-left: 4px; opacity: 0.7; }
.tint-image { color: var(--accent); }
.tint-audio { color: var(--green); }
.tint-video { color: var(--amber); }
.tint-text, .tint-llm { color: #bb9af7; }
.tint-edit { color: var(--red); }
.tint-workflow { color: var(--dim); }
.omni-tag[class*='tint-'] { background: color-mix(in srgb, currentColor 12%, transparent); border-color: color-mix(in srgb, currentColor 35%, transparent); }
/* a chip the query named: the filter that is on */
.omni-tag.hit { border-color: currentColor; background: color-mix(in srgb, currentColor 24%, transparent); font-weight: 600; }
.omni-errors { margin: 10px 6px 4px; padding: 8px; border: 1px solid var(--red); border-radius: 6px; font-size: 12px; }
.omni-errors .section-title { margin-top: 0; color: var(--red); }
.omni-errors .file { color: var(--dim); word-break: break-all; }
.omni-errors .msg { color: var(--red); margin-bottom: 6px; white-space: pre-wrap; }
button.link.load-errors { color: var(--red); font-size: 11px; }

/* the ONE scrolling element. --main-pad-y is its own top+bottom padding, published so the
   sticky results column can subtract exactly that: a column sized to the full VIEWPORT inside
   a padded scrollport is always taller than the room it has, which is a scrollbar on a page
   that fits. The bottom padding is small on purpose — everything that floats here (the run
   bar, the pinned preview) is position:sticky, so it occupies flow space and needs no
   clearance; the old 48px was left from a fixed bar and was pure phantom scroll height */
.main { --main-pad-y: 26px; flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 14px; }
.main h2 { font-size: 14px; margin: 0; color: var(--dim); font-weight: 500; }
.main h2 b { color: var(--text); }

/* the menu column: the TUI header on the web, one labelled card per scope, stacked */
.menu-layout { flex: 1; min-width: 0; height: 100%; }
.menu-panel { height: 100%; overflow-y: auto; overscroll-behavior: contain; background: var(--panel); border-right: 1px solid var(--border); }
.menu-main { height: 100%; display: flex; min-width: 0; }
.menu-main > .main { height: 100%; }
.menu-col { padding: 8px 10px 14px; }
.menu-top { display: flex; justify-content: flex-end; margin-bottom: 6px; }
.menu-cards { display: flex; flex-direction: column; gap: 14px; }
.menu-cards .head-box { background: var(--bg); }
.menu-cards .head-label { background: var(--bg); }
.menu-cards .head-line { flex-wrap: wrap; }
.menu-cards .head-select { max-width: 100%; min-width: 0; }
.menu-rail { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 0; }
.path-value { color: var(--text) !important; font-weight: 500 !important; max-width: 100%; }
.path-value .icon { color: var(--dim); flex-shrink: 0; }
.path-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
/* phones: the menu is a drawer, a slim bar names where you are */
.mobile-bar {
   display: flex; align-items: center; gap: 8px; padding: 6px 10px;
   border-bottom: 1px solid var(--border); background: var(--panel);
}
.mobile-where { border: 0; background: none; font: inherit; color: var(--text); padding: 0; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-draft { color: var(--accent); }
.drawer-overlay { position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / 0.5); }
.drawer {
   position: absolute; top: 0; bottom: 0; left: 0; width: min(320px, 86vw); overflow-y: auto;
   background: var(--panel); border-right: 1px solid var(--border); padding: 8px 12px 16px;
}
.head-box {
   position: relative; border: 1px solid var(--border); border-radius: 8px;
   padding: 5px 9px; background: var(--panel); min-width: 0;
}
.head-label {
   position: absolute; top: -7px; left: 9px; padding: 0 5px; background: var(--bg);
   color: var(--dim); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
}
.head-value { font-weight: 600; overflow-wrap: anywhere; }
.head-value.app { color: var(--amber); }
.head-value.draft { color: var(--accent); }
.head-value.host { color: var(--green); }
.head-select { padding: 2px 6px; font-size: 13px; font-weight: 600; color: var(--green); max-width: 220px; }
.head-select.draft { color: var(--accent); }
/* a head value that acts: reads like the text beside it, behaves like a button */
.head-value.as-link {
   border: 0; background: none; padding: 0; font: inherit; font-weight: 600; cursor: pointer;
   color: var(--amber); display: inline-flex; align-items: center; gap: 5px;
}
.head-value.as-link:hover { color: var(--accent); text-decoration: underline; }
button.danger { color: var(--dim); }
/* a button that asks to be pressed: the host changed under the panel */
button.attention { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); font-size: 11px; white-space: nowrap; }
button.danger:hover { color: var(--red); border-color: var(--red); }

/* the label column is fit-content CAPPED, not a fixed slab: with short labels the controls
   start right after them. Rows are subgrids of .vars so the column still lines up across
   rows — a per-row grid would give every row its own width. The 150px track is the
   pre-subgrid fallback, kept first so an old engine still gets aligned columns */
/* the form needs air under the head boxes: the first var sat flush against them */
.vars { display: grid; grid-template-columns: 120px minmax(0, 1fr); margin-top: 14px; position: relative; padding-left: 22px; }
/* each row's reset, in the form's left gutter (the padding above): borderless until
   hovered, out of the flow so it never moves a label */
.var-row { position: relative; }
button.var-reset {
   position: absolute; left: -20px; top: 6px; width: 20px; height: 20px; padding: 0;
   display: inline-flex; align-items: center; justify-content: center;
   border: 1px solid transparent; border-radius: 5px; background: none; color: var(--dim); cursor: pointer;
}
button.var-reset:hover:not(:disabled) { border-color: var(--border); color: var(--text); background: var(--panel-2); }
button.var-reset:disabled { opacity: 0.25; cursor: default; }
/* the label column's edge: a thin strip you drag, lit on hover */
.label-resizer {
   position: absolute; top: 0; bottom: 0; width: 6px; margin-left: -3px; z-index: 5;
   cursor: col-resize; border-radius: 3px;
}
.label-resizer:hover, .label-resizer:active { background: var(--accent-dim); }
.var-row {
   display: grid; grid-template-columns: 150px 1fr; grid-column: 1 / -1;
   grid-template-columns: subgrid; gap: 8px; align-items: start;
   /* no rule between rows: the label column and the spacing already separate them. Every
   row has the same side padding, so a tinted group block has room and its labels still line
   up with the plain rows */
   padding: 4px 8px;
}
/* vars that go together (VarUi.group): one tinted block, rounded at its ends */
.var-row.in-group { background: rgba(122, 162, 247, 0.06); }
.var-row.group-start { border-radius: 8px 8px 0 0; margin-top: 6px; }
.var-row.group-end { border-radius: 0 0 8px 8px; margin-bottom: 6px; }
.var-row.group-solo { border-radius: 8px; margin: 6px 0; }
/* the label IS the drag handle for its row: no separate grip to reveal or aim at */
/* labels never wrap: one line at the height of a control, cut with an ellipsis, whole on hover.
   The icon and the (?) keep their size, only the name gives way */
.var-label { display: flex; align-items: center; justify-content: flex-end; min-height: 28px; min-width: 0; cursor: grab; }
.var-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
/* the ⌘ key that jumps to this var, on its own line under the name */
.var-label.has-kbd { flex-wrap: wrap; align-content: center; row-gap: 3px; }
.var-kbd-line { flex-basis: 100%; display: flex; justify-content: flex-end; color: var(--dim); }
.var-row.inactive .var-control { opacity: 0.18; filter: grayscale(1); }
.var-row.inactive .var-label { opacity: 0.45; }
.var-label:active { cursor: grabbing; }
.lora-chip[draggable='true'] { cursor: grab; }
/* the card drags from anywhere, so its own controls must keep their cursor */
.lora-chip input, .lora-chip label, .lora-chip button { cursor: pointer; }
.lora-chip input[type='number'] { cursor: text; }
/* the modified mark: a small dot pinned to the cell's left edge, OUT of the flow, so a field
   that changes never moves its label */
.var-label { position: relative; }
.var-label .dirty-dot {
   position: absolute; left: -4px; top: 50%; transform: translateY(-50%);
   width: 7px; height: 7px; padding: 0; border: 0; border-radius: 50%;
   background: var(--amber); font-size: 0; cursor: pointer;
}
.var-label .dirty-dot:hover { background: var(--red); }
.var-control { min-width: 0; }
/* a workflow's own icons: beside a label, or inside a choice button */
.var-icon { width: 15px; height: 15px; margin-right: 5px; flex-shrink: 0; }
.btn-group button .var-icon { margin-right: 3px; }
.var-help {
   flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; margin-right: 5px;
   width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--dim);
   color: var(--dim); font-size: 10px; line-height: 1; cursor: help; vertical-align: 1px;
}
.hint { color: var(--dim); font-size: 11px; margin-top: 2px; }

input[type='text'], input[type='number'], textarea, select {
   background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
   border-radius: 6px; padding: 3px 7px; font: inherit; max-width: 100%;
}
input[type='text'] { width: 100%; }
input[type='number'] { width: 110px; }
textarea { width: 100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); }
input[type='range'] { width: 100%; accent-color: var(--accent); }
/* a steps or cfg slider across a whole wide row is a long drag for a small number: 320px is
   still a fine grain for 1..60, and the number box keeps its place right after it */
.var-control input[type='range'] { max-width: 320px; }
input[type='checkbox'] { accent-color: var(--accent); width: 16px; height: 16px; }
.row-inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
/* lanes (src/vars/lanes.ts): named groups merged top to bottom. Each lane is a BAND: a tinted
   strip, its name as plain small text on the left (clickable, not dressed as a button: click
   switches it, drag reorders, double-click renames), its content on the right. An inactive lane
   is dimmed, never hidden */
.lora-lanes { display: flex; flex-direction: column; gap: 4px; }
.lanes { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
.lane-box, .lora-section.laned {
   display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; align-items: start;
   background: var(--panel); border-radius: 8px; padding: 5px 6px 5px 8px;
}
.lane-bar { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding-top: 4px; }
.lane-pill {
   background: none; border: 0; padding: 0; max-width: 100%; cursor: grab;
   font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--accent);
   overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
}
.lane-pill:hover { text-decoration: underline dotted; }
.lane-pill.off { color: var(--dim); font-weight: 400; text-decoration: line-through; }
.lane-bar input.lane-name { width: 100%; padding: 1px 6px; font-size: 12px; height: 22px; }
/* the tools of a lane only show under the pointer: a calm list of lanes at rest */
.lane-tools { display: inline-flex; gap: 4px; align-items: center; opacity: 0; transition: opacity 0.12s; }
.lane-box:hover .lane-tools, .lora-section:hover .lane-tools, .lane-tools:focus-within { opacity: 1; }
.lane-box.off textarea, .lane-box.off .prompt-editor, .lora-section.off .lora-lane { opacity: 0.4; }
/* the prompt editor's own colors live in its CodeMirror theme (web/promptEditor/); here only the footer */
.prompt-editor { position: relative; }
.pe-foot {
   position: absolute; right: 6px; bottom: 3px; display: flex; gap: 10px; font-size: 10px; color: var(--dim);
   background: var(--panel-2); padding: 0 4px; border-radius: 4px; opacity: 0; pointer-events: none; transition: opacity 0.12s;
}
.prompt-editor:focus-within .pe-foot, .pe-foot.has-error { opacity: 1; pointer-events: auto; }
.pe-keys, .pe-tokens { cursor: help; }
.pe-error { color: var(--red); margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lane-foot { gap: 14px; }
.lora-add-card {
   align-self: stretch; min-width: 56px; min-height: 56px; border: 1px dashed var(--border);
   background: none; color: var(--dim); border-radius: 8px; display: inline-flex;
   align-items: center; justify-content: center; font-size: 18px;
}
.lora-add-card:hover { border-color: var(--accent); color: var(--accent); }
/* ⋯ menus (components/MenuButton.tsx) */
.menu-box { display: inline-flex; }
button.menu-btn { height: 26px; width: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: none; border-color: transparent; color: var(--dim); }
button.menu-btn:hover, button.menu-btn[aria-expanded='true'] { color: var(--text); border-color: var(--border); background: var(--panel-2); }
.menu-list { min-width: 210px; left: auto; right: 0; }
.menu-item {
   display: flex; gap: 6px; align-items: center; width: 100%; text-align: left;
   background: none; border: 0; border-radius: 6px; padding: 5px 8px;
}
.menu-item:hover:not(:disabled) { background: var(--accent-dim); }
.menu-check { width: 12px; color: var(--accent); flex-shrink: 0; }
.menu-sep { height: 1px; background: var(--border); margin: 4px 2px; }

/* presets menu (text + prompt vars). The backdrop sits UNDER the menu and over everything
   else, so any outside click closes it without a document listener */
.preset-box { position: relative; }
.preset-btn { white-space: nowrap; }
.preset-backdrop { position: fixed; inset: 0; z-index: 40; }
.preset-menu {
   position: absolute; top: calc(100% + 4px); left: 0; z-index: 41;
   display: flex; flex-direction: column; min-width: 260px; max-width: min(520px, 90vw);
   max-height: 320px; overflow-y: auto;
   background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 4px;
   box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
}
.preset-item {
   display: flex; flex-direction: column; gap: 1px; align-items: flex-start;
   background: none; border: 0; border-radius: 6px; padding: 4px 7px; text-align: left; width: 100%;
}
.preset-item:hover { background: var(--accent-dim); border-color: transparent; }
.preset-item.on .preset-name { color: var(--accent); }
.preset-name { white-space: pre; }
/* size: starred aspect icons, the starrable list, fitted W × H */
.aspect-icon { display: inline-block; vertical-align: -0.2em; flex-shrink: 0; }
.size-row input.size-num { min-width: 0; padding-left: 5px; padding-right: 2px; }
.size-pick { display: inline-flex; gap: 6px; align-items: center; }
.size-menu { min-width: 300px; overflow-x: hidden; }
.size-item { display: flex; align-items: center; gap: 4px; border-radius: 6px; }
.size-item:hover { background: var(--accent-dim); }
.size-item.on .size-item-label { color: var(--accent); }
.size-item-pick {
   flex: 1; display: flex; gap: 8px; align-items: center; text-align: left;
   background: none; border: 0; padding: 4px 7px;
}
.size-item-label { flex: 1; white-space: nowrap; }
.size-star { background: none; border: 0; color: var(--dim); padding: 2px 8px; font-size: 14px; }
.size-star.on { color: var(--amber); }
.preset-peek {
   color: var(--dim); font-size: 11px; max-width: 100%;
   overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

button {
   background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
   border-radius: 6px; padding: 3px 8px; font: inherit; cursor: pointer;
}
button:hover { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
/* the run button is the loudest thing on the page, it does not need to be the biggest */
button.primary {
   background: var(--accent); border-color: var(--accent); color: #0d1117; font-weight: 600;
   padding: 5px 14px; display: inline-flex; align-items: center; gap: 6px;
}
/* running: the fill sweeps across a dim track, the text stays, so nothing beside it moves */
button.primary.running { color: #fff; border-color: var(--accent); }
/* the run button: one short word, so a compact button */
.kbd-hint {
   font-size: 10px; opacity: 0.65; border: 1px solid currentColor; border-radius: 4px;
   padding: 0 4px; line-height: 1.4;
}
button.link { border: 0; background: none; color: var(--accent); padding: 0; }
button.link.danger { color: var(--dim); }
button.link.danger:hover { color: var(--red); }
button.mode { padding: 2px 7px; font-size: 12px; }
button.mode.sel { background: var(--accent); border-color: var(--accent); color: #0d1117; }
/* the actions that START something (new draft, add loras): accent outline, so the eye finds
   them before the neutral ones. The lit segment of a group is a solid accent fill */
button.accent { color: var(--accent); border-color: var(--accent-dim); }
/* small secondary actions under a field (presets, enhance, lanes): one size, each its own box */
button.mini { height: 24px; padding: 0 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; color: var(--dim); }
button.mini:hover { color: var(--text); }
.prompt-actions { gap: 6px; margin-top: 4px; }
button.accent:hover { background: var(--accent-dim); color: #fff; }

/* two rows, three columns: Run / queue / images on top, the three buttons that end something
   underneath, one per column, all the same size */
.run-grid { display: inline-grid; grid-template-columns: repeat(3, minmax(110px, 1fr)); gap: 6px 8px; align-items: center; flex-shrink: 0; }
.run-grid > button { width: 100%; justify-content: center; }
.run-grid > button.primary { padding: 5px 12px; font-size: 13px; }
.run-count { text-align: center; font-size: 13px; color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
.run-count b { color: var(--text); font-weight: 600; }
.run-count.empty { opacity: 0.6; }
button.run-end { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 13px; }
button.run-end:not(:disabled):hover { color: #fff; background: var(--red); border-color: var(--red); }
button.run-end:disabled { opacity: 0.45; cursor: default; }
.run-error { flex: 1; min-width: 0; height: 1.4em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red); font-size: 12px; }
input[type='range'].setting-range:disabled { opacity: 0.3; }
.live-preview-error { margin-left: 4px; }
.live-preview-line { min-height: 1.35em; }
.runbar {
   position: sticky; bottom: 0; display: flex; gap: 14px; align-items: center;
   background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
   padding: 8px 12px; margin-top: 10px;
}
/* the changed-vars broom: FAR RIGHT of the draft box line and outside the button group, so
   appearing and disappearing with the dirty count never shifts the buttons beside it */
.head-box .head-right { margin-left: auto; padding: 2px 5px; }
.head-box button.dirty { color: var(--amber); }
.head-box button.dirty:hover { color: var(--red); border-color: var(--red); }
.runbar .error { color: var(--red); font-size: 12px; white-space: pre-wrap; }
.pulse { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.45; } }

.gallery { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.run-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.run-card .meta { color: var(--dim); font-size: 12px; margin-bottom: 8px; display: flex; justify-content: space-between; gap: 8px; }
.run-card .imgs { display: flex; flex-wrap: wrap; gap: 10px; }
.img-cell { display: flex; flex-direction: column; gap: 4px; }
/* the embedding page's buttons on a result (host protocol) — loud on purpose: they ARE the
   reason the panel is inside that page */
.host-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.host-action { border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 6px; padding: 4px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
.host-action:hover { filter: brightness(1.12); }
.host-action.danger { background: none; color: var(--dim); border-color: var(--dim); font-weight: 400; }
.host-action.danger:hover { color: var(--red); border-color: var(--red); }
.lightbox-bar .host-action { padding: 4px 10px; }
.run-card img { max-width: min(320px, 100%); max-height: 320px; border-radius: 6px; display: block; }
/* fit: every image as wide as the panel, one per row. grid: the slider sets the size (inline),
   run cards wrap several per row */
.gallery.view-fit .imgs { flex-direction: column; }
.gallery.view-fit .img-cell, .gallery.view-fit .img-button { width: 100%; }
.gallery.view-fit .run-card img { width: 100%; height: auto; max-width: 100%; max-height: none; }
.gallery.view-grid { flex-direction: row; flex-wrap: wrap; align-items: flex-start; }
.gallery.view-grid .run-card { max-width: 100%; }
.run-card .noimg { color: var(--dim); font-style: italic; }
.audio-cell { display: flex; flex-direction: column; gap: 4px; width: min(100%, 480px); }
.audio-cell audio { width: 100%; }
.run-card.running { border-color: var(--accent-dim); }
/* what the host is on, in the node's own unit — the live signal of a text run, which has
   neither a latent frame nor an image to show */

/* a STRING output: the answer is prose, so it wraps and selects like prose. Monospace because
   an expanded prompt is copied into another field verbatim */
.run-text { margin-top: 8px; border-top: 1px solid var(--border); padding-top: 6px; }
.run-text-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.run-text-body, .run-thinking {
   margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
   font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.5;
   background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 7px 9px;
   max-height: 40vh; overflow-y: auto;
}
.run-thinking { color: var(--dim); font-size: 12px; margin-bottom: 6px; }

/* the stream: pinned to its newest line, capped so a long answer never pushes the page around */
.run-live { margin-top: 6px; }
.run-live-body {
   margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
   font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5;
   background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;
   max-height: 30vh; overflow-y: auto;
}
.run-live-body.dim { color: var(--dim); }
.progress-track { height: 6px; background: var(--panel-2); border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
/* live previews under generate: compact, the name inline, each line cut to one; a click opens
   the full text. A negative line is dim red, as the prompt box would read it */
.live-previews { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.live-preview {
   display: flex; gap: 8px; align-items: baseline; width: 100%; min-width: 0; text-align: left;
   background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px;
   font-size: 11px; line-height: 1.4; cursor: pointer;
}
.live-preview:hover { border-color: var(--accent-dim); }
.live-preview-name { flex-shrink: 0; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px; }
.live-preview-lines { display: flex; flex-direction: column; min-width: 0; flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.live-preview-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.live-preview-line.negative { color: #c9848f; }
.live-preview.expanded .live-preview-line { white-space: pre-wrap; overflow-wrap: anywhere; }
/* the running image's frame, reserved at its final ratio: the latent fills it, the bar rides its
   foot, so a run never changes the page's height */
.run-frame { position: relative; max-width: 100%; background: var(--bg); border-radius: 6px; overflow: hidden; }
.run-frame .img-button { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: none; }
.run-frame img { width: 100%; height: 100%; object-fit: contain; display: block; }
.progress-track.over { position: absolute; left: 6px; right: 6px; bottom: 6px; margin: 0; background: rgba(0, 0, 0, 0.45); }
.run-meta-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.4s ease; }

.lora-chip {
   display: inline-flex; gap: 6px; align-items: center; max-width: 100%;
   background: var(--accent-dim); border-radius: 12px; padding: 3px 10px; font-size: 12px;
}
.lora-chip button { border: 0; background: none; color: inherit; padding: 0; font-size: 11px; }
.lora-chip button:hover { color: var(--red); }
/* image mode: the row chip becomes the same preview card as the popup */
.lora-chip.card {
   position: relative;
   flex-direction: column; align-items: stretch; border-radius: 8px; padding: 6px;
   background: var(--panel-2); border: 1px solid var(--border); width: 168px;
   /* anything that still outgrows the card is clipped IN PLACE, never painted over its
      neighbour. CLIP on x only: hidden on both axes would trap the tooltips too */
   overflow-x: clip; overflow-y: visible;
}
.lora-chip.card .lora-thumb { height: 130px; }
.lora-chip.card .chip-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-title { min-width: 0; }
/* the whole card is the pause/resume target — the palette gesture */
.lora-toggle {
   display: flex; flex-direction: column; gap: 4px; align-items: stretch; min-width: 0;
   border: 0; background: none; color: inherit; font: inherit; padding: 0; cursor: pointer; text-align: left;
}
.lora-chip:not(.card) .lora-toggle { flex-direction: row; align-items: center; gap: 6px; }
.lora-toggle:hover .chip-title { color: var(--accent); }
.chip-controls { display: flex; flex-direction: column; gap: 3px; }
/* trigger words under a row card: the words wrap, a missing state carries its fix */
.chip-triggers { font-size: 11px; line-height: 1.35; color: var(--text); overflow-wrap: anywhere; user-select: text; }
.chip-triggers.none, .chip-triggers.missing { color: var(--dim); font-style: italic; }
.chip-triggers.missing { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.lora-chip .chip-triggers .trigger-fetch {
   font-style: normal; font-size: 11px; padding: 1px 8px; border-radius: 6px;
   border: 1px solid var(--border); background: var(--panel); color: var(--accent);
}
.lora-chip .chip-triggers .trigger-fetch:hover { color: var(--accent); border-color: var(--accent); }
.lora-chip .chip-triggers .trigger-fetch:disabled { color: var(--dim); cursor: default; }
/* a line: label button, slider, number. The label toggles m+c ↔ m / c */
.st-line { display: flex; gap: 5px; align-items: center; }
.st-line .st-label {
   border: 0; background: none; padding: 0; cursor: pointer; font-size: 10px; letter-spacing: 0.03em;
   color: var(--dim); width: 24px; text-align: left; flex-shrink: 0;
}
.st-line .st-label:hover { color: var(--accent); }
/* wide enough for a signed two-decimal value plus the spinner: -0.55 was clipping */
.st-line input[type='number'] { width: 58px; flex-shrink: 0; padding: 1px 5px; font-size: 11px; }

/* the sliders, drawn rather than left to the browser's default chrome */
.st-line input[type='range'] {
   flex: 1; min-width: 40px; height: 14px; margin: 0; padding: 0;
   appearance: none; background: none; cursor: pointer;
}
.st-line input[type='range']::-webkit-slider-runnable-track {
   height: 3px; border-radius: 2px; background: var(--border);
}
.st-line input[type='range']::-webkit-slider-thumb {
   appearance: none; width: 11px; height: 11px; border-radius: 50%; margin-top: -4px;
   background: var(--accent); border: 0;
}
.st-line input[type='range']::-moz-range-track { height: 3px; border-radius: 2px; background: var(--border); }
.st-line input[type='range']::-moz-range-thumb {
   width: 11px; height: 11px; border: 0; border-radius: 50%; background: var(--accent);
}
.lora-chip.off .st-line input[type='range']::-webkit-slider-thumb { background: var(--dim); }
.lora-chip.off .st-line input[type='range']::-moz-range-thumb { background: var(--dim); }

/* the head line: switch, then the name */
.chip-head { display: flex; gap: 6px; align-items: center; min-width: 0; }
.chip-title.as-text {
   border: 0; background: none; padding: 0; color: inherit; font: inherit; cursor: pointer;
   overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; min-width: 0;
}
.chip-title.as-text:hover { color: var(--accent); }

/* the picture's own box: the ✕ is positioned against THIS, so it never depends on which
   ancestor happens to be positioned, and the image keeps the whole height */
.chip-media { position: relative; display: block; isolation: isolate; }
.chip-media .lora-toggle { display: block; width: 100%; }
/* ✕ is ALWAYS a corner overlay, on the card and in the popup row: it costs zero layout
   width, and it is never hover-gated — a phone has no hover, so a hidden ✕ is no ✕.
   The selector carries TWO classes on purpose: the .lora-chip button rule above is 0-1-1 and would
   otherwise win, stripping the padding and the backdrop off this one.
   width:auto because a stretch parent would otherwise pull it across the whole card */
.chip-media .chip-remove, .lora-active-row .chip-remove, .lora-card .chip-remove {
   position: absolute; top: 4px; right: 4px; z-index: 1; width: auto; height: auto;
   display: inline-flex; align-items: center; justify-content: center;
   border: 0; border-radius: 8px; padding: 7px; line-height: 0; color: #fff; cursor: pointer;
   background: rgba(16, 18, 23, 0.72); opacity: 0.85; transition: opacity 0.12s, color 0.12s;
}
.chip-media .chip-remove:hover, .lora-active-row .chip-remove:hover, .lora-card .chip-remove:hover { opacity: 1; color: var(--red); }

/* PAUSED: still in the palette, visibly not contributing to the graph */
.lora-toggle, .thumb-box { position: relative; display: block; }
.paused-mark {
   position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
   pointer-events: none; color: #fff; opacity: 0.8;
}
.paused-mark svg { background: rgba(16, 18, 23, 0.55); border-radius: 50%; padding: 10px; box-sizing: content-box; stroke-width: 3; }
.lora-chip.off, .lora-active-row.off { opacity: 0.55; }
.lora-chip.off { border-style: dashed; }
.lora-chip.off .lora-thumb, .lora-active-row.off .lora-thumb { filter: grayscale(1); }


.modal-overlay {
   position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, 0.55);
   display: flex; align-items: center; justify-content: center; padding: 20px;
}
.modal {
   background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
   width: min(860px, 100%); max-height: min(80vh, 100%); display: flex; flex-direction: column;
}
.modal-head { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid var(--border); }
.modal-head input { flex: 1; }
/* a popup whose content grows and shrinks (the loras picker): pinned near the top, one fixed
   height, so typing a filter or hiding images never moves it */
.modal-overlay.top { align-items: flex-start; padding-top: 5vh; }
.modal.loras-modal { height: min(86vh, 100%); max-height: none; }
.modal.loras-modal { width: min(1180px, 100%); }
/* the palette sits BESIDE the gallery, each scrolling alone: picking a lora grows the palette
   and never moves a card under the pointer. Narrow: a fixed-height strip above, same reason */
.loras-split { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 340px; }
.loras-split .modal-body { min-height: 0; }
.loras-palette { order: 2; border-left: 1px solid var(--border); }
.loras-palette .lora-active-row { flex-wrap: wrap; }
.lora-card.picked { border-color: var(--green); }
.lora-card.picked .lora-label { color: var(--green); }
.lora-card.picked.off { border-color: var(--border); border-style: dashed; opacity: 0.55; }
.lora-card.picked.off .lora-label { color: var(--dim); }
.lora-card.picked.off .lora-thumb { filter: grayscale(1); }
@media (max-width: 800px) {
   .loras-split { grid-template-columns: minmax(0, 1fr); grid-template-rows: 150px minmax(0, 1fr); }
   .loras-palette { order: 0; border-left: 0; border-bottom: 1px solid var(--border); }
}
.modal-head .modal-close { margin-left: 6px; }
/* a display setting's slider (lora image size, result size): grey and small, never the accent
   blue of the controls that change what runs */
input[type='range'].setting-range { width: 72px; flex: 0 0 72px; accent-color: var(--dim); opacity: 0.8; }
.menu-range { cursor: default; }
.menu-range input[type='range'].setting-range { margin-left: auto; width: 96px; flex-basis: 96px; }
.modal-foot { padding: 5px 10px; border-top: 1px solid var(--border); font-size: 11px; color: var(--dim); margin: 0; }
.modal-body { overflow-y: auto; padding: 10px; }
.section-title { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin: 8px 0 6px; }

.lora-active-row { position: relative; display: flex; gap: 10px; align-items: center; padding: 4px 22px 4px 0; border-bottom: 1px solid var(--border); }
.lora-active-text { flex: 1; min-width: 0; }
.lora-active-row input[type='number'] { width: 64px; padding: 2px 6px; font-size: 12px; }
.lora-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }

.lora-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.lora-sort-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
.lora-sort { display: inline-flex; align-items: center; gap: 4px; text-transform: none; letter-spacing: 0; }
.lora-sort .mode { font-size: 11px; padding: 2px 8px; }
.lora-card {
   position: relative; min-width: 0;
   background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
}
.lora-card-hit {
   display: flex; flex-direction: column; gap: 6px; padding: 6px; width: 100%; text-align: left;
   background: none; border: 0; cursor: pointer; color: inherit;
}
.lora-card:hover { border-color: var(--accent); }
/* CONTAIN, never cover: a cropped preview hides exactly what the lora looks like */
/* contain by default (nothing of the art is hidden); FILL crops to the card, which reads far
   better for style loras — the toggle lives in the loras row and persists */
.lora-thumb { width: 100%; height: 110px; object-fit: contain; border-radius: 6px; display: block; background: var(--bg); }
.lora-thumb.fill { object-fit: cover; }
.lora-active-row .lora-thumb { width: 48px; height: 48px; flex-shrink: 0; }
div.lora-thumb.none {
   display: flex; align-items: center; justify-content: center;
   color: var(--dim); font-size: 11px; background: var(--bg); font-style: italic;
}
.st-label { color: var(--dim); font-size: 11px; }

.img-button { padding: 0; border: 0; background: none; cursor: zoom-in; display: block; min-width: 0; }
.lightbox {
   display: flex; flex-direction: column; gap: 8px; max-width: min(1100px, 100%); max-height: 100%;
}
.lightbox img { max-width: 100%; max-height: calc(90vh - 60px); object-fit: contain; border-radius: 8px; }
/* wheel zoom: the viewport CLIPS, the image inside is transformed. transform-origin stays
   centred so the pan offsets computed from the cursor are the only thing moving it */
.zoom-view { overflow: hidden; border-radius: 8px; display: flex; justify-content: center; touch-action: none; }
.zoom-view img { transform-origin: center center; will-change: transform; }
.zoom-view.grabbing { cursor: grab; }
.zoom-view.grabbing:active { cursor: grabbing; }
.lightbox-bar {
   display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap;
   background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px;
}
.lightbox-bar a { color: var(--accent); text-decoration: none; }
.loras-more input[type='number'] { width: 72px; margin: 0 5px; }
.loras-more { color: var(--dim); font-size: 12px; padding: 4px 10px; }

/* prompt enhancer modal */
.modal-foot {
   display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
   padding: 10px; border-top: 1px solid var(--border);
}
/* one fixed size, pinned near the top: switching a tab or streaming a rewrite never moves it */
.modal.enh-modal { width: min(1180px, 100%); height: min(88vh, 100%); max-height: none; }
.enh-title { flex: 1; font-size: 15px; display: inline-flex; align-items: center; gap: 6px; }
.enh-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 240px minmax(0, 1fr); }
.enh-main { min-height: 0; display: flex; flex-direction: column; gap: 18px; padding: 14px 16px; font-size: 14px; }
.enh-side {
   min-height: 0; overflow-y: auto; padding: 12px 10px; border-right: 1px solid var(--border);
   background: var(--bg); display: flex; flex-direction: column; gap: 18px;
}
.enh-tabs-title {
   display: flex; align-items: center; gap: 6px; margin: 0 4px 6px;
   color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
}
.enh-save { margin-left: auto; color: var(--dim); font-weight: 400; text-transform: none; letter-spacing: 0; }
.enh-save.error { color: var(--red); }
.enh-tab-select { display: none; width: 100%; }
.enh-tab-list { display: flex; flex-direction: column; gap: 2px; }
.enh-tab { position: relative; display: flex; align-items: center; border-radius: 6px; border-left: 3px solid transparent; }
.enh-tab > button:first-child {
   flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; text-align: left;
   background: none; border: 0; padding: 7px 8px; font-size: 14px; color: var(--text); cursor: pointer;
}
.enh-tab:hover { background: var(--panel-2); }
.enh-tab.sel { background: var(--accent-dim); border-left-color: var(--accent); }
.enh-tab.sel > button:first-child { font-weight: 600; }
.enh-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.enh-tab-new {
   margin-top: 4px; display: flex; align-items: center; gap: 6px; background: none; border: 1px dashed var(--border);
   color: var(--dim); padding: 6px 8px; border-radius: 6px; font-size: 13px; cursor: pointer; text-align: left;
}
.enh-tab-new:hover { color: var(--accent); border-color: var(--accent); }
.enh-tab-edit { background: none; border: 0; color: var(--dim); padding: 4px 8px; cursor: pointer; }
.enh-tab-edit:hover, .enh-tab-edit.sel { color: var(--accent); }
.enh-right { position: relative; min-height: 0; display: flex; flex-direction: column; }
.enh-right > .enh-main { flex: 1; overflow: hidden; }
.enh-job { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.enh-job .enh-actions { margin-bottom: 8px; }
.enh-box { flex: 1; min-height: 60px; resize: none; }
.enh-box.enh-result { flex: 1.3; }
button.enh-go { min-width: 130px; justify-content: center; }
.enh-think-tip { margin-left: 6px; cursor: help; }
/* the editor covers the job, inside the modal: nothing clips it, nothing beside it moves */
.enh-edit {
   position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column;
   background: var(--panel); border-left: 3px solid var(--accent);
}
.enh-edit-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.enh-edit-head .enh-h { flex: 1; min-width: 0; }
button.enh-edit-close { background: var(--accent); border-color: var(--accent); color: #0d1117; font-weight: 600; padding: 5px 16px; }
.enh-edit-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
.enh-master { flex: 1; min-height: 240px; resize: none; }
.enh-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; background: var(--dim); }
.enh-dot.up { background: var(--green); }
.enh-dot.down { background: var(--red); }
.enh-dot.checking { background: var(--amber); }
.enh-empty { color: var(--dim); font-size: 13px; padding: 4px; }
.enh-h { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 16px; font-weight: 700; color: var(--text); }
.enh-h-name { color: var(--accent); font-weight: 600; }
.enh-label { font-size: 13px; color: var(--dim); margin-bottom: 4px; }
.enh-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.enh-text { width: 100%; font-size: 14px; line-height: 1.5; }
.enh-result { border-color: var(--accent-dim); }
.enh-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
button.enh-big { font-size: 14px; padding: 8px 18px; }
.enh-grid { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px 12px; align-items: center; }
.enh-grid > label { color: var(--dim); font-size: 13px; text-align: right; }
.enh-grid input[type='text'], .enh-grid input[type='password'], .enh-grid > select { width: 100%; }
.enh-inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
.enh-inline > select, .enh-inline > input[type='text'] { flex: 1; min-width: 160px; }
.enh-inline .row-inline { font-size: 13px; color: var(--dim); }

.img-preview { margin-top: 8px; }
.img-preview img { max-width: 220px; max-height: 220px; border-radius: 6px; border: 1px solid var(--border); }

.center { display: flex; height: 100%; align-items: center; justify-content: center; color: var(--dim); }
.center .error { color: var(--red); max-width: 640px; white-space: pre-wrap; }

/* history picker: one fixed size, matches left, the highlighted one in full on the right */
.modal-overlay.hist-overlay { z-index: 60; }
.modal.hist-modal { width: min(1100px, 100%); height: min(76vh, 100%); max-height: none; }
.hist-modal .modal-head { align-items: center; }
.hist-cols { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }
.hist-list { min-height: 0; overflow-y: auto; border-right: 1px solid var(--border); padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.hist-row {
   display: flex; flex-direction: column; gap: 2px; text-align: left; background: none; border: 0;
   border-left: 3px solid transparent; border-radius: 6px; padding: 6px 8px; cursor: pointer; color: var(--text); min-width: 0;
}
.hist-row.sel { background: var(--accent-dim); border-left-color: var(--accent); }
.hist-first { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.hist-meta { font-size: 11px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-empty { color: var(--dim); padding: 8px; font-size: 13px; }
.hist-preview { min-height: 0; display: flex; flex-direction: column; }
.hist-text {
   flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 12px 14px; white-space: pre-wrap; overflow-wrap: anywhere;
   font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.5;
}
.hist-foot { display: flex; align-items: center; gap: 10px; justify-content: space-between; padding: 8px 12px; border-top: 1px solid var(--border); }
@media (max-width: 700px) {
   .hist-cols { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
   .hist-list { border-right: 0; border-bottom: 1px solid var(--border); }
}
/* the corner latent: a zero-height sticky anchor, so the card floats over the gallery without
   taking a pixel of it; the card itself is one fixed size */
.corner-run-anchor { position: sticky; top: 6px; height: 0; z-index: 4; flex-basis: 100%; width: 100%; margin-bottom: -10px; }
.work.layout-pinned .corner-run-anchor { margin-bottom: -6px; }
.corner-run {
   position: absolute; top: 0; right: 6px; width: 168px; display: flex; flex-direction: column; gap: 4px;
   background: var(--panel); border: 1px solid var(--accent-dim); border-radius: 8px; padding: 6px;
   box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
}
.corner-run img { width: 100%; height: 120px; object-fit: contain; display: block; border-radius: 5px; background: var(--bg); }
.gallery.blur .corner-run img { filter: blur(14px); }
.corner-run-meta { display: flex; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--dim); white-space: nowrap; }
.corner-run-meta .run-meta-text { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* blur mode: every result, the latent frame included, stays blurred until the pointer is on it */
.gallery.blur img { filter: blur(22px); transition: filter 0.12s; }
.gallery.blur img:hover, .gallery.blur .img-cell:hover img, .gallery.blur button:hover img { filter: none; }
/* bigger control buttons: the preview head and the three cards at the top, one size with the
   rows below them */
.results-head .btn-group > button, .head-box .btn-group > button, .head-box button.head-icon {
   height: 28px; min-width: 28px; font-size: 13px;
   display: inline-flex; align-items: center; justify-content: center; gap: 4px;
}
/* the preview is its OWN surface: panel background and a border, so the editor and the
   results never read as one page. Placement rules below refine it (the corner card is tighter) */
.results-col { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px 10px; }
.results-col .gallery { margin-top: 0; }
.results-col .run-card { background: var(--bg); }
.work.layout-bottom .results-col { margin-top: 16px; }
/* the panel's own controls sit on top of it */
.head-group-labeled { display: flex; flex-direction: column; gap: 2px; }
.results-view { gap: 6px; flex-wrap: nowrap; }
.head-row { gap: 6px; flex-wrap: nowrap; }
.group-caption { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; padding-left: 2px; }
.results-head {
   display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap;
   padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--border);
}
.work.layout-pinned .results-head { justify-content: flex-end; padding-bottom: 4px; margin-bottom: 6px; }
/* placement off hides the panel and its buttons: this tab on the right edge brings it back */
.show-preview {
   position: fixed; right: 0; top: 30%; z-index: 20; padding: 6px 8px;
   border-radius: 8px 0 0 8px; border-right: 0; background: var(--panel); color: var(--dim);
}
.show-preview:hover { color: var(--text); }

/* LEFT / RIGHT on a wide screen: two full-height panels (react-resizable-panels), each
   scrolling on its own, split by a handle. The preview side is its own surface, full height */
.work.split { flex: 1; min-width: 0; height: 100%; gap: 0; align-items: stretch; }
.split-panel { height: 100%; overflow-y: auto; overscroll-behavior: contain; }
.split-form { padding: 12px 14px 14px; }
.split-results { background: var(--panel); padding: 10px 12px; }
.work.split .results-col {
   position: static; width: auto; max-height: none; overflow: visible;
   background: none; border: 0; border-radius: 0; padding: 0;
}
.split-handle { width: 5px; background: var(--border); cursor: col-resize; transition: background 0.1s; }
.split-handle:hover, .split-handle[data-separator-state='drag'] { background: var(--accent); }

/* the placements. Each one is a BUTTON and nothing else: there is no width rule that quietly
   moves the panel somewhere no button is showing */
.work.layout-side { display: flex; gap: 18px; align-items: flex-start; }
.work.layout-side .form-col { flex: 1; min-width: 0; }
.work.layout-side .results-col { width: min(380px, 45vw); flex-shrink: 0; }
.work.layout-side .results-col .gallery { margin-top: 0; }
/* results LEFT of the form: same column, the other side. flex order rather than
   row-reverse, so the dom order (form first) stays the reading and tab order */
.work.layout-left { display: flex; gap: 18px; align-items: flex-start; }
.work.layout-left .form-col { flex: 1; min-width: 0; order: 2; }
.work.layout-left .results-col { width: min(380px, 45vw); flex-shrink: 0; order: 1; }
.work.layout-left .results-col .gallery { margin-top: 0; }
.work.layout-left .results-col {
   position: sticky; top: 0; align-self: flex-start;
   max-height: calc(100dvh - var(--main-pad-y, 26px)); min-height: 0; overflow-y: auto; overscroll-behavior: contain;
}

/* a 380px column beside a form does not fit a phone: BOTH side placements stack there. This
   is the chosen mode adapting, not a different mode — the button stays lit and still says
   where the panel goes the moment there is room for it */
@media (max-width: 760px) {
   .work.layout-side, .work.layout-left { display: block; }
   .work.layout-side .results-col, .work.layout-left .results-col {
      position: static; width: auto; max-height: none; overflow-y: visible; margin-top: 12px;
   }
}

/* A COLUMN OF RESULTS IS NEVER TALLER THAN THE PAGE. Left to itself it grows with the run
   history and drags the document down, so reading a var meant scrolling past a stack of
   images. It sticks to the top of .main (the scroll container) and scrolls INSIDE itself,
   so the form column stays where it is however many runs pile up */
.work.layout-side .results-col {
   position: sticky; top: 0; align-self: flex-start;
   max-height: calc(100dvh - var(--main-pad-y, 26px)); min-height: 0; overflow-y: auto; overscroll-behavior: contain;
}
/* PINNED: the newest result floats over the bottom, the form scrolls under it — the phone
   answer to "I always have to scroll between them". Sticky, so it never covers the runbar.
   It HUGS its content: fit-content width + auto height, so an empty run or a tall portrait
   never leaves a band of dead space around the image */
.work.layout-pinned .results-col {
   /* bottom RIGHT corner: it hugs the image, so anchoring it to a corner keeps the form's
      left edge readable instead of splitting the page down the middle */
   position: sticky; bottom: 0; z-index: 15; margin-top: 10px;
   width: fit-content; max-width: 100%; margin-left: auto; margin-right: 0;
   max-height: 46vh; overflow-y: auto;
   background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
   box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.45); padding: 6px;
}
.work.layout-pinned .results-col .gallery { margin-top: 0; gap: 6px; }
/* the pinned card is the IMAGE plus its controls, nothing else: no meta line, no padding walls */
.work.layout-pinned .run-card { padding: 0; border: 0; background: none; }
.work.layout-pinned .run-card .meta { margin-bottom: 2px; font-size: 11px; }
.work.layout-pinned .run-card img { max-height: 34vh; width: auto; }
.results-run { display: flex; gap: 10px; align-items: center; flex-wrap: nowrap; margin-bottom: 8px; min-width: 0; }
.work.layout-pinned .results-run { margin-bottom: 6px; justify-content: flex-end; }
/* segmented control: ONE group, no gaps, only the outer corners rounded */
.btn-group { display: inline-flex; }
/* a many-choice with more options than a line holds wraps instead of pushing the row wide */
.btn-group.wrap { flex-wrap: wrap; row-gap: 4px; }
.btn-group button {
   padding: 2px 6px; font-size: 13px; line-height: 1.3; border-radius: 0; margin: 0;
   border-right-width: 0; background: var(--panel-2);
}
.btn-group button:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
.btn-group button:last-child { border-right-width: 1px; border-top-right-radius: 6px; border-bottom-right-radius: 6px; }
.btn-group button.sel { background: var(--accent); border-color: var(--accent); color: #0d1117; font-weight: 600; }
/* the selected segment owns the divider on both sides, else its highlight looks clipped */
.btn-group button.sel + button { border-left-color: var(--accent); }
.btn-group button:hover { background: var(--panel); }
.btn-group button.sel:hover { background: var(--accent); }
/* ONE height for every button a var row shows in a group or an action line: a choice, the
   lora toggles, a lane header, the seed modes. Before, each kind had its own padding and a
   choice sat visibly smaller than the toggles beside it */
.var-control .btn-group > button, .var-control .row-inline > button:not(.link):not(.lora-add-card):not(.mini),
.var-control .lora-actions > button {
   height: 28px; min-width: 28px; font-size: 13px;
   display: inline-flex; align-items: center; justify-content: center; gap: 4px;
}
/* everything on a var row is the SAME height as the input beside it, or the row steps.
   28px is what the slimmed input measures (14px text, 3px padding, 1px border) */
.field-height, .field-height button { height: 28px; }
.field-height button { display: inline-flex; align-items: center; justify-content: center; }
/* a one-character mode button still needs a target: = + ? are narrow glyphs */
.btn-group.field-height button { min-width: 28px; }
/* the draft line: rename, the name, delete, on one line around the name they act on */
.draft-line { display: flex; gap: 4px; align-items: center; min-width: 0; }
.draft-line select { flex: 1; min-width: 0; }
button.head-icon { padding: 2px 5px; background: none; border-color: transparent; color: var(--dim); }
button.head-icon:hover { border-color: var(--border); color: var(--text); }
button.head-icon.danger:hover { color: var(--red); border-color: var(--red); }
.head-input { padding: 2px 6px; font-size: 13px; font-weight: 600; color: var(--accent); max-width: 180px; }
.head-label .save-state { color: var(--dim); font-weight: 400; margin-left: 4px; }
.head-label .save-state.error { color: var(--red); }
/* every head box is two lines: what you are on, then what you can do to it */
.head-box { display: flex; flex-direction: column; gap: 5px; }
.head-line { display: flex; gap: 8px; align-items: center; min-height: 24px; }

/* the lora controls sit above the palette, left aligned */
.lora-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.lora-actions button { font-size: 12px; }
/* the words the loras prepend to the prompt: shown, not guessed. One quiet LINE per lora (its
   name, the words it adds, how many are disabled), cut with an ellipsis. Clickable without
   shouting: dim text, a dotted underline on hover. A lora that is not running keeps its line,
   fainter, so switching a lane never moves the form */
.kw-prefix { display: flex; flex-direction: column; gap: 1px; margin-bottom: 4px; }
.kw-box { max-width: 100%; }
.kw-line {
   display: flex; gap: 6px; align-items: baseline; max-width: 100%; min-width: 0;
   background: none; border: 0; padding: 1px 0; font-size: 11px; color: var(--dim); text-align: left; cursor: pointer;
}
.kw-line:hover .kw-words, .kw-line[aria-expanded='true'] .kw-words { color: var(--text); text-decoration: underline dotted; }
.kw-line.stopped { opacity: 0.45; }
.kw-lora { font-weight: 600; white-space: nowrap; flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
.kw-words { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #b4bccf; }
.kw-off { flex-shrink: 0; white-space: nowrap; font-style: italic; }
.kw-menu { min-width: 240px; }
.kw-menu-head { padding: 2px 6px 6px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.kw-menu-head .kw-lora { color: var(--text); margin-right: auto; }
.kw-item { display: flex; gap: 8px; align-items: center; padding: 3px 7px; border-radius: 6px; cursor: pointer; }
.kw-item:hover { background: var(--accent-dim); }
/* a real switch, not a word: the state is readable at a glance and hittable on a phone */
.switch { position: relative; display: inline-flex; width: 28px; height: 16px; flex-shrink: 0; cursor: pointer; }
.switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.switch .track {
   position: absolute; inset: 0; border-radius: 999px; background: var(--panel-2);
   border: 1px solid var(--border); transition: background 0.15s, border-color 0.15s;
}
.switch .track::after {
   content: ''; position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%;
   background: var(--dim); transition: transform 0.15s, background 0.15s;
}
.switch input:checked + .track { background: var(--accent-dim); border-color: var(--accent); }
.switch input:checked + .track::after { transform: translateX(12px); background: var(--accent); }
.switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }

/* the lora details sheet */
.lora-details { display: flex; gap: 14px; flex-wrap: wrap; }
/* its own ratio, always: the sheet is a flex row, and a stretched child is drawn as tall as the
   text beside it */
.detail-thumb {
   width: 220px; max-width: 100%; height: auto; max-height: 70vh; align-self: flex-start;
   object-fit: contain; border-radius: 8px;
}
.detail-list { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 6px; }
.detail-row { display: grid; grid-template-columns: 110px 1fr; gap: 10px; font-size: 12px; }
.detail-key { color: var(--dim); }
.detail-val { overflow-wrap: anywhere; }
.detail-val a { color: var(--accent); text-decoration: none; }
/* civitai's own words about the model. PLAIN TEXT: the extension answers html, and third
   party html is never injected into this page — the seam strips it to text */
.detail-desc {
   white-space: pre-wrap; font-size: 12px; line-height: 1.5; color: var(--text);
   background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
   padding: 8px 10px; max-height: 220px; overflow-y: auto;
}
.detail-examples { display: flex; gap: 8px; flex-wrap: wrap; }
.detail-examples img { width: 96px; height: 96px; object-fit: cover; border-radius: 6px; }

/* destructive but routine (clear queue): neutral at rest, it only turns red under the pointer */
button.quiet-danger:hover { color: var(--red); border-color: var(--red); }
/* a lora the manager knows and comfy does not: flagged, never hidden */
.lora-warn { color: var(--amber); display: inline-flex; margin-left: 4px; vertical-align: -0.1em; }
/* an anchor that must read as a button (it opens the host's own page, so it IS a link) */
.button-link {
   display: inline-flex; align-items: center; gap: 5px; text-decoration: none; font-size: 12px;
   background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
   border-radius: 6px; padding: 0 10px;
}
.button-link:hover { border-color: var(--accent); color: var(--accent); }

/* the ComfyUI console, only while asked for */
.logs { margin-top: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
.logs-head {
   display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
   padding: 6px 10px; border-bottom: 1px solid var(--border); color: var(--dim); font-size: 12px;
}
.logs pre {
   margin: 0; padding: 8px 10px; max-height: 240px; overflow: auto; white-space: pre-wrap;
   font-size: 11px; line-height: 1.35; color: var(--dim);
   font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* tooltips: ONE floating layer (components/TooltipLayer.tsx) reads every data-tip. Instant,
   because the native title waits about a second and cannot be styled. position: relative stays
   on the anchors, some of them position their own children against it */
[data-tip] { position: relative; }
.tooltip {
   z-index: 100; pointer-events: none; white-space: pre-line; max-width: 320px; width: max-content;
   /* light on a dark page: a tip must not be mistaken for part of the panel */
   background: #e8eaf0; color: #15181f; border: 0;
   border-radius: 6px; padding: 6px 10px; font-size: 13px; font-weight: 450; line-height: 1.4;
   box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
}

/* icons inherit the text they sit in, so a button never jumps when one is swapped in */
.icon { display: inline-block; vertical-align: -0.16em; flex-shrink: 0; }
button .icon + * { margin-left: 4px; }

/* phone: label over control, 16px inputs (below that iOS zooms the page on focus) */
@media (max-width: 640px) {
   .main { --main-pad-y: 22px; padding: 10px 10px 12px; }
   /* labels stay BESIDE their control on a phone too: stacking them doubled the height of
      every row and read as a wall. The column is the width you dragged. A row that needs the
      whole width (loras) opts out with .wide */
   .var-row { gap: 6px; }
   .var-row.wide { grid-template-columns: 1fr; gap: 3px; }
   .var-label { padding-top: 3px; font-size: 12px; }
   input[type='text'], input[type='number'], textarea, select { font-size: 16px; }
   input[type='number'] { width: 96px; }
   /* repeated at row specificity: the base 12px rule outranks the bare selector above,
      and a sub-16px input makes iOS zoom the page on focus */
   .lora-active-row input[type='number'] { font-size: 16px; }
   .modal-overlay { padding: 0; }
   .modal { max-height: 100%; height: 100%; width: 100%; border-radius: 0; }
   .lora-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
   .runbar { flex-wrap: wrap; }
   /* the two tab lists become two dropdowns above the job */
   .enh-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
   .enh-side { flex-direction: row; gap: 10px; border-right: 0; border-bottom: 1px solid var(--border); padding: 8px 10px; }
   .enh-side .enh-tabs { flex: 1; min-width: 0; }
   .enh-tab-list { display: none; }
   .enh-tab-select { display: block; }
   .enh-grid { grid-template-columns: minmax(0, 1fr); }
   .enh-grid > label { text-align: left; }
}
`
