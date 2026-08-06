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
.cols { display: flex; flex: 1; min-height: 0; position: relative; }
.backdrop { display: none; }

.sidebar {
   width: 240px; flex-shrink: 0; overflow-y: auto;
   border-right: 1px solid var(--border); background: var(--panel); padding: 6px 0;
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

.main { flex: 1; overflow-y: auto; padding: 12px 14px 48px; }
.main h2 { font-size: 14px; margin: 0; color: var(--dim); font-weight: 500; }
.main h2 b { color: var(--text); }

/* the TUI header on the web: one labelled box per thing you are editing, actions below */
.head-boxes { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 0; }
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
button.danger:hover { color: var(--red); border-color: var(--red); }

/* the sidebar is a tree: folder → workflows → drafts, the branch line makes the nesting readable */
.side-group { margin-bottom: 7px; }
.side-folder { padding: 4px 12px 2px; color: var(--dim); font-size: 11px; overflow-wrap: anywhere; }
.side-branch { margin-left: 10px; border-left: 1px solid var(--border); }

/* the label column is fit-content CAPPED, not a fixed slab: with short labels the controls
   start right after them. Rows are subgrids of .vars so the column still lines up across
   rows — a per-row grid would give every row its own width. The 150px track is the
   pre-subgrid fallback, kept first so an old engine still gets aligned columns */
.vars { display: grid; grid-template-columns: fit-content(150px) 1fr; }
.var-row {
   display: grid; grid-template-columns: 150px 1fr; grid-column: 1 / -1;
   grid-template-columns: subgrid; gap: 8px; align-items: start;
   padding: 5px 0; border-bottom: 1px solid var(--border);
}
.var-label { padding-top: 4px; overflow-wrap: break-word; }
/* the grip appears on hover: a permanent one on every row is noise */
.drag-handle {
   display: inline-flex; vertical-align: -0.15em; margin-right: 4px; cursor: grab;
   color: var(--dim); opacity: 0; transition: opacity 0.12s;
}
.var-row:hover .drag-handle, .drag-handle:focus-visible { opacity: 1; }
.drag-handle:active { cursor: grabbing; }
.lora-chip[draggable='true'] { cursor: grab; }
/* the card drags from anywhere, so its own controls must keep their cursor */
.lora-chip input, .lora-chip label, .lora-chip button { cursor: pointer; }
.lora-chip input[type='number'] { cursor: text; }
.var-label .dirty-dot { color: var(--amber); margin-left: 4px; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; }
.var-label .dirty-dot:hover { color: var(--red); }
.var-control { min-width: 0; }
.hint { color: var(--dim); font-size: 11px; margin-top: 2px; }

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
.gallery-head { display: flex; gap: 12px; align-items: baseline; color: var(--dim); font-size: 12px; }
.run-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.run-card .meta { color: var(--dim); font-size: 12px; margin-bottom: 8px; display: flex; justify-content: space-between; gap: 8px; }
.run-card .imgs { display: flex; flex-wrap: wrap; gap: 10px; }
.run-card img { max-width: min(320px, 100%); max-height: 320px; border-radius: 6px; display: block; }
.run-card .noimg { color: var(--dim); font-style: italic; }
.run-card.running { border-color: var(--accent-dim); }
.progress-track { height: 6px; background: var(--panel-2); border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
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
.chip-media .chip-remove, .lora-active-row .chip-remove {
   position: absolute; top: 4px; right: 4px; z-index: 1; width: auto; height: auto;
   display: inline-flex; align-items: center; justify-content: center;
   border: 0; border-radius: 6px; padding: 4px; line-height: 0; color: #fff; cursor: pointer;
   background: rgba(16, 18, 23, 0.72); opacity: 0.85; transition: opacity 0.12s, color 0.12s;
}
.chip-media .chip-remove:hover, .lora-active-row .chip-remove:hover { opacity: 1; color: var(--red); }

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

.lora-active-row { position: relative; display: flex; gap: 10px; align-items: center; padding: 4px 22px 4px 0; border-bottom: 1px solid var(--border); }
.lora-active-text { flex: 1; min-width: 0; }
.lora-active-row input[type='number'] { width: 64px; padding: 2px 6px; font-size: 12px; }
.lora-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }

.lora-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.lora-card {
   display: flex; flex-direction: column; gap: 6px; padding: 6px; text-align: left;
   background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; min-width: 0;
}
.lora-card:hover { border-color: var(--accent); }
/* CONTAIN, never cover: a cropped preview hides exactly what the lora looks like */
.lora-thumb { width: 100%; height: 110px; object-fit: contain; border-radius: 6px; display: block; background: var(--bg); }
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
   /* inside the query on purpose: below 1100px auto stacks the results UNDER the form, and
      capping the height there would trap the gallery in a 100vh box instead of letting the
      page scroll. Same rule as layout-side, see the note there */
   .work.layout-auto .results-col {
      position: sticky; top: 0; align-self: flex-start;
      max-height: calc(100vh - 24px); overflow-y: auto; overscroll-behavior: contain;
   }
}
/* chosen placements */
.work.layout-side { display: flex; gap: 18px; align-items: flex-start; }
.work.layout-side .form-col { flex: 1; min-width: 0; }
.work.layout-side .results-col { width: min(380px, 45vw); flex-shrink: 0; }
.work.layout-side .results-col .gallery { margin-top: 0; }
/* A COLUMN OF RESULTS IS NEVER TALLER THAN THE PAGE. Left to itself it grows with the run
   history and drags the document down, so reading a var meant scrolling past a stack of
   images. It sticks to the top of .main (the scroll container) and scrolls INSIDE itself,
   so the form column stays where it is however many runs pile up */
.work.layout-side .results-col {
   position: sticky; top: 0; align-self: flex-start;
   max-height: calc(100vh - 24px); overflow-y: auto; overscroll-behavior: contain;
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
.host-note {
   margin: 8px 0; padding: 6px 10px; font-size: 12px; color: var(--text);
   background: var(--panel); border: 1px solid var(--accent-dim); border-radius: 6px;
}
/* the keywords the active loras prepend to the prompt: shown, not guessed */
.kw-prefix { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.kw-chip {
   font-size: 11px; padding: 2px 8px; border-radius: 10px;
   background: var(--accent-dim); color: #fff;
}
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
.detail-thumb { width: 220px; max-width: 100%; border-radius: 8px; }
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
   .main { padding: 10px 10px 48px; }
   /* the row stops being a subgrid here: label OVER control, one column across both
      parent tracks (it still spans them via grid-column) */
   .var-row { grid-template-columns: 1fr; gap: 4px; }
   .var-label { padding-top: 0; }
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
