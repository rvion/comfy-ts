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
html, body { margin: 0; height: 100%; }
body {
   background: var(--bg);
   color: var(--text);
   font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
#root { height: 100%; }
.app { display: flex; flex-direction: column; height: 100%; }
.topbar {
   display: flex; align-items: baseline; gap: 12px;
   padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--panel);
}
.topbar h1 { font-size: 15px; margin: 0; font-weight: 600; }
.topbar .dim { color: var(--dim); font-size: 12px; }
.burger { font-size: 16px; padding: 3px 10px; align-self: center; }
.cols { display: flex; flex: 1; min-height: 0; position: relative; }
.backdrop { display: none; }

.sidebar {
   width: 240px; flex-shrink: 0; overflow-y: auto;
   border-right: 1px solid var(--border); background: var(--panel); padding: 8px 0;
}
.side-module { padding: 6px 12px 2px; }
.side-module .name { font-weight: 600; }
.side-module .host { color: var(--dim); font-size: 11px; margin-left: 6px; }
.side-draft {
   display: block; width: 100%; text-align: left; border: 0; background: none; color: var(--text);
   padding: 4px 12px 4px 26px; cursor: pointer; font: inherit; border-radius: 4px;
}
.side-draft:hover { background: var(--panel-2); }
.side-draft.sel { background: var(--accent-dim); color: #fff; }
.side-errors { margin: 12px; padding: 8px; border: 1px solid var(--red); border-radius: 6px; font-size: 12px; }
.side-errors .file { color: var(--dim); word-break: break-all; }
.side-errors .msg { color: var(--red); }

.main { flex: 1; overflow-y: auto; padding: 16px 20px 60px; }
.main h2 { font-size: 14px; margin: 0; color: var(--dim); font-weight: 500; }
.main h2 b { color: var(--text); }
.form-head { display: flex; gap: 12px; align-items: baseline; margin-bottom: 12px; flex-wrap: wrap; }

/* the TUI header on the web: one labelled box per thing you are editing, actions below */
.head-boxes { display: flex; gap: 10px; flex-wrap: wrap; margin: 6px 0 0; }
.head-box {
   position: relative; border: 1px solid var(--border); border-radius: 8px;
   padding: 7px 12px; background: var(--panel); min-width: 0;
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
.head-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0 14px; }
.head-actions button { padding: 4px 12px; font-size: 12px; }
button.danger { color: var(--dim); }
button.danger:hover { color: var(--red); border-color: var(--red); }

/* the sidebar is a tree: folder → workflows → drafts, the branch line makes the nesting readable */
.side-group { margin-bottom: 10px; }
.side-folder { padding: 4px 12px 2px; color: var(--dim); font-size: 11px; overflow-wrap: anywhere; }
.side-branch { margin-left: 10px; border-left: 1px solid var(--border); }

.var-row {
   display: grid; grid-template-columns: 170px 1fr; gap: 10px; align-items: start;
   padding: 8px 0; border-bottom: 1px solid var(--border);
}
.var-label { padding-top: 5px; overflow-wrap: break-word; }
.var-label .kind { color: var(--dim); font-size: 11px; display: block; }
.var-label .dirty-dot { color: var(--amber); margin-left: 4px; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; }
.var-label .dirty-dot:hover { color: var(--red); }
.var-control { min-width: 0; }
.hint { color: var(--dim); font-size: 11px; margin-top: 3px; }

input[type='text'], input[type='number'], textarea, select {
   background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
   border-radius: 6px; padding: 6px 8px; font: inherit; max-width: 100%;
}
input[type='text'] { width: 100%; }
input[type='number'] { width: 110px; }
textarea { width: 100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); }
input[type='range'] { width: 100%; accent-color: var(--accent); }
input[type='checkbox'] { accent-color: var(--accent); width: 16px; height: 16px; }
.row-inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

button {
   background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
   border-radius: 6px; padding: 5px 10px; font: inherit; cursor: pointer;
}
button:hover { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #0d1117; font-weight: 600; padding: 8px 22px; }
button.link { border: 0; background: none; color: var(--accent); padding: 0; }
button.link.danger { color: var(--dim); }
button.link.danger:hover { color: var(--red); }
button.mode { padding: 4px 8px; font-size: 12px; }
button.mode.sel { background: var(--accent-dim); border-color: var(--accent); color: #fff; }

.runbar {
   position: sticky; bottom: 0; display: flex; gap: 14px; align-items: center;
   background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
   padding: 10px 14px; margin-top: 14px;
}
.runbar .status { color: var(--dim); font-size: 12px; }
.runbar .error { color: var(--red); font-size: 12px; white-space: pre-wrap; }
.pulse { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.45; } }

.gallery { margin-top: 18px; display: flex; flex-direction: column; gap: 14px; }
.gallery-head { display: flex; gap: 12px; align-items: baseline; color: var(--dim); font-size: 12px; }
.run-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.run-card .meta { color: var(--dim); font-size: 12px; margin-bottom: 8px; display: flex; justify-content: space-between; gap: 8px; }
.run-card .imgs { display: flex; flex-wrap: wrap; gap: 10px; }
.run-card img { max-width: min(320px, 100%); max-height: 320px; border-radius: 6px; display: block; }
.run-card .noimg { color: var(--dim); font-style: italic; }
.run-card.running { border-color: var(--accent-dim); }
.progress-track { height: 6px; background: var(--panel-2); border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.4s ease; }
.img-cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.img-actions { display: flex; gap: 10px; align-items: baseline; font-size: 12px; }
.img-actions a { color: var(--accent); text-decoration: none; }
.img-actions button { padding: 2px 8px; font-size: 12px; }

.lora-chip {
   display: inline-flex; gap: 6px; align-items: center; max-width: 100%;
   background: var(--accent-dim); border-radius: 12px; padding: 3px 10px; font-size: 12px;
}
.lora-chip button { border: 0; background: none; color: inherit; padding: 0; font-size: 11px; }
.lora-chip button:hover { color: var(--red); }
/* image mode: the row chip becomes the same preview card as the popup */
.lora-chip.card {
   flex-direction: column; align-items: stretch; border-radius: 8px; padding: 6px;
   background: var(--panel-2); border: 1px solid var(--border); width: 132px;
   /* anything that still outgrows the card is clipped IN PLACE, never painted over its
      neighbour. CLIP on x only: hidden on both axes would trap the tooltips too */
   overflow-x: clip; overflow-y: visible;
}
.lora-chip.card .lora-thumb { height: 110px; }
.lora-chip.card .chip-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-title { min-width: 0; }
/* the whole card is the pause/resume target — the palette gesture */
.lora-toggle {
   display: flex; flex-direction: column; gap: 4px; align-items: stretch; min-width: 0;
   border: 0; background: none; color: inherit; font: inherit; padding: 0; cursor: pointer; text-align: left;
}
.lora-chip:not(.card) .lora-toggle { flex-direction: row; align-items: center; gap: 6px; }
.lora-toggle:hover .chip-title { color: var(--accent); }
.chip-state { font-size: 10px; color: var(--green); letter-spacing: 0.04em; }
.lora-chip.off .chip-state { color: var(--amber); }
.chip-controls { display: flex; gap: 4px; align-items: center; }
/* the card is a FIXED width: its controls must divide that width, never overflow it.
   Two 52px inputs plus the ✕ were wider than the card, so the ✕ spilled under the next
   card and only the last one of a row stayed clickable */
.lora-chip.card .chip-controls { width: 100%; min-width: 0; }
.lora-chip.card .chip-controls input[type='number'] { flex: 1 1 0; width: auto; min-width: 0; }
.lora-chip.card .chip-controls button { flex: 0 0 auto; }
.chip-controls input[type='number'] { width: 52px; padding: 1px 4px; font-size: 11px; }
.chip-controls button { border: 0; background: none; color: inherit; padding: 0 2px; font-size: 11px; }
.chip-controls button:hover { color: var(--red); }
/* PAUSED: still in the palette, visibly not contributing to the graph */
.lora-chip.off, .lora-active-row.off { opacity: 0.55; }
.lora-chip.off { border-style: dashed; }
.lora-chip.off .lora-thumb, .lora-active-row.off .lora-thumb { filter: grayscale(1); }

.queue { margin-top: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
.queue-head {
   display: flex; gap: 12px; align-items: baseline; justify-content: space-between;
   padding: 6px 10px; border-bottom: 1px solid var(--border); color: var(--dim); font-size: 12px;
}
.queue-row { display: flex; gap: 10px; align-items: center; padding: 4px 10px; font-size: 12px; }
.queue-ix { color: var(--dim); width: 16px; }
.queue-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-row button { padding: 1px 8px; font-size: 11px; }

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
.modal-body { overflow-y: auto; padding: 10px; }
.section-title { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin: 8px 0 6px; }

.lora-active-row { display: flex; gap: 10px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--border); }
.lora-active-text { flex: 1; min-width: 0; }
.lora-active-row input[type='number'] { width: 64px; padding: 2px 6px; font-size: 12px; }
.lora-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }

.lora-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.lora-card {
   display: flex; flex-direction: column; gap: 6px; padding: 6px; text-align: left;
   background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; min-width: 0;
}
.lora-card:hover { border-color: var(--accent); }
.lora-thumb { width: 100%; height: 110px; object-fit: cover; border-radius: 6px; display: block; }
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
.lightbox-bar {
   display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap;
   background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px;
}
.lightbox-bar a { color: var(--accent); text-decoration: none; }
.loras-more { color: var(--dim); font-size: 12px; padding: 4px 10px; }

/* prompt enhancer modal */
.modal-foot {
   display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
   padding: 10px; border-top: 1px solid var(--border);
}
.enh-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.enh-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.enh-cols textarea { width: 100%; }
.enh-cols textarea[readonly] { color: var(--dim); }
.enh-think {
   max-height: 160px; overflow-y: auto; white-space: pre-wrap; font-size: 12px;
   color: var(--dim); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px;
}

.img-preview { margin-top: 8px; }
.img-preview img { max-width: 220px; max-height: 220px; border-radius: 6px; border: 1px solid var(--border); }

.center { display: flex; height: 100%; align-items: center; justify-content: center; color: var(--dim); }
.center .error { color: var(--red); max-width: 640px; white-space: pre-wrap; }

/* results right of the form on wide screens ("bottom or right": right ≥1100px, bottom below).
   AUTO only: an explicit layout button wins at every width */
@media (min-width: 1100px) {
   .work.layout-auto { display: flex; gap: 18px; align-items: flex-start; }
   .work.layout-auto .form-col { flex: 1; min-width: 0; }
   .work.layout-auto .results-col { width: 380px; flex-shrink: 0; }
   .work.layout-auto .results-col .gallery { margin-top: 0; }
}
/* chosen placements */
.work.layout-side { display: flex; gap: 18px; align-items: flex-start; }
.work.layout-side .form-col { flex: 1; min-width: 0; }
.work.layout-side .results-col { width: min(380px, 45vw); flex-shrink: 0; }
.work.layout-side .results-col .gallery { margin-top: 0; }
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
.results-run { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.work.layout-pinned .results-run { margin-bottom: 6px; justify-content: flex-end; }
/* segmented control: ONE group, no gaps, only the outer corners rounded */
.btn-group { display: inline-flex; }
.btn-group button {
   padding: 2px 6px; font-size: 13px; line-height: 1.3; border-radius: 0; margin: 0;
   border-right-width: 0; background: var(--panel-2);
}
.btn-group button:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
.btn-group button:last-child { border-right-width: 1px; border-top-right-radius: 6px; border-bottom-right-radius: 6px; }
.btn-group button.sel { background: var(--accent-dim); border-color: var(--accent); color: #fff; }
/* the selected segment owns the divider on both sides, else its highlight looks clipped */
.btn-group button.sel + button { border-left-color: var(--accent); }
.btn-group button:hover { background: var(--panel); }
/* a group living inside a header box sits beside the value, not under it */
.head-group { margin-left: 8px; vertical-align: middle; }
.head-group button { padding: 2px 5px; }
/* rows that mix buttons and inputs: one height for both, so nothing steps over the line.
   32px is what an input with 6px padding and a 1px border measures at this font size */
.field-height, .field-height button { height: 32px; }
.field-height button { display: inline-flex; align-items: center; }
.head-input { padding: 2px 6px; font-size: 13px; font-weight: 600; color: var(--accent); max-width: 180px; }
.head-label .save-state { color: var(--dim); font-weight: 400; margin-left: 4px; }
.head-label .save-state.error { color: var(--red); }
/* every head box is two lines: what you are on, then what you can do to it */
.head-box { display: flex; flex-direction: column; gap: 5px; }
.head-line { display: flex; gap: 8px; align-items: center; min-height: 24px; }
.head-line .head-group { margin-left: 0; }

/* the lora controls sit above the palette, left aligned */
.lora-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.lora-actions button { font-size: 12px; }
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

/* INSTANT tooltips: the native title attribute waits about a second and cannot be styled, so
   every affordance carries data-tip instead. No js, no library, and no delay, which is the point */
[data-tip] { position: relative; }
[data-tip]:hover::after, [data-tip]:focus-visible::after {
   content: attr(data-tip);
   /* anchored to the button's bottom LEFT, never centred: a centred tip on the leftmost
      button hangs off the screen, and one below never covers the row you are reading */
   position: absolute; top: calc(100% + 5px); left: 0;
   z-index: 60; pointer-events: none; white-space: normal; max-width: 220px; width: max-content;
   opacity: 0.8;
   background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
   border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 400; line-height: 1.3;
   box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
}
/* the pointer never crosses a tooltip, so hover cannot flicker between the two */
@media (hover: none) { [data-tip]:hover::after { display: none; } }

/* icons inherit the text they sit in, so a button never jumps when one is swapped in */
.icon { display: inline-block; vertical-align: -0.16em; flex-shrink: 0; }
button .icon + * { margin-left: 4px; }

/* the sidebar becomes a fixed drawer over a backdrop */
@media (max-width: 800px) {
   .sidebar {
      position: fixed; top: 0; left: 0; bottom: 0; width: 264px; z-index: 30;
      box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5); padding-top: 12px;
   }
   .backdrop { display: block; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 25; }
   .side-draft { padding: 9px 12px 9px 26px; }
}

/* phone: label over control, 16px inputs (below that iOS zooms the page on focus) */
@media (max-width: 640px) {
   .main { padding: 12px 12px 60px; }
   .var-row { grid-template-columns: 1fr; gap: 4px; }
   .var-label { padding-top: 0; }
   .var-label .kind { display: inline; margin-left: 6px; }
   input[type='text'], input[type='number'], textarea, select { font-size: 16px; }
   input[type='number'] { width: 96px; }
   /* repeated at row specificity: the base 12px rule outranks the bare selector above,
      and a sub-16px input makes iOS zoom the page on focus */
   .lora-active-row input[type='number'] { font-size: 16px; }
   .modal-overlay { padding: 0; }
   .modal { max-height: 100%; height: 100%; width: 100%; border-radius: 0; }
   .lora-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
   .runbar { flex-wrap: wrap; }
   /* side by side prompts do not fit a phone: stack yours over the rewrite */
   .enh-cols { grid-template-columns: 1fr; }
}
`
