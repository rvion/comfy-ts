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
.main h2 { font-size: 14px; margin: 0 0 12px; color: var(--dim); font-weight: 500; }
.main h2 b { color: var(--text); }

.var-row {
   display: grid; grid-template-columns: 170px 1fr; gap: 10px; align-items: start;
   padding: 8px 0; border-bottom: 1px solid var(--border);
}
.var-label { padding-top: 5px; overflow-wrap: break-word; }
.var-label .kind { color: var(--dim); font-size: 11px; display: block; }
.var-label .dirty-dot { color: var(--amber); margin-left: 4px; }
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
.run-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.run-card .meta { color: var(--dim); font-size: 12px; margin-bottom: 8px; }
.run-card .imgs { display: flex; flex-wrap: wrap; gap: 10px; }
.run-card img { max-width: min(320px, 100%); max-height: 320px; border-radius: 6px; display: block; }
.run-card .noimg { color: var(--dim); font-style: italic; }

.loras-box { border: 1px solid var(--border); border-radius: 6px; background: var(--panel); }
.loras-box .search { padding: 6px; border-bottom: 1px solid var(--border); }
.loras-box .search input { width: 100%; }
.loras-body { display: flex; align-items: stretch; }
.loras-list { flex: 1; min-width: 0; max-height: 260px; overflow-y: auto; padding: 4px 0; }
.lora-row { display: flex; gap: 8px; align-items: center; padding: 3px 10px; }
.lora-row .name {
   flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
   background: none; border: 0; color: inherit; font: inherit; text-align: left; padding: 0; cursor: pointer;
}
.lora-row .name:hover { color: var(--accent); }
.lora-pane {
   width: 210px; flex-shrink: 0; border-left: 1px solid var(--border);
   padding: 8px; overflow-y: auto; max-height: 260px;
}
.lora-pane img { max-width: 100%; max-height: 170px; border-radius: 6px; display: block; }
.lora-pane-name { font-size: 12px; margin-top: 6px; overflow-wrap: break-word; }
.lora-row.active .name { color: var(--green); }
.lora-row input[type='number'] { width: 64px; padding: 2px 6px; font-size: 12px; }
.lora-row .st-label { color: var(--dim); font-size: 11px; }
.loras-more { color: var(--dim); font-size: 12px; padding: 4px 10px; }

.img-preview { margin-top: 8px; }
.img-preview img { max-width: 220px; max-height: 220px; border-radius: 6px; border: 1px solid var(--border); }

.center { display: flex; height: 100%; align-items: center; justify-content: center; color: var(--dim); }
.center .error { color: var(--red); max-width: 640px; white-space: pre-wrap; }

/* results right of the form on wide screens ("bottom or right": right ≥1100px, bottom below) */
@media (min-width: 1100px) {
   .work { display: flex; gap: 18px; align-items: flex-start; }
   .form-col { flex: 1; min-width: 0; }
   .results-col { width: 380px; flex-shrink: 0; }
   .results-col .gallery { margin-top: 0; }
}

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
   .runbar { flex-wrap: wrap; }
   .loras-body { flex-direction: column; }
   .lora-pane { width: auto; border-left: 0; border-top: 1px solid var(--border); max-height: 240px; }
}
`
