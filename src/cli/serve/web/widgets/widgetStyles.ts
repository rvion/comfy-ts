// the output widgets' rules, one string: the panel's stylesheet embeds it, and a page outside the
// panel (examples/depth-explorer) injects it beside its own. Reads the panel's colour tokens
export const WIDGET_STYLES = /* css */ `
.output-widgets { display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
.relight { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: #0b0c10; }
.relight-stage { display: flex; justify-content: center; background: #07080b; }
.relight-canvas { display: block; width: 100%; max-height: 70vh; max-width: calc(70vh * 4); object-fit: contain; cursor: crosshair; touch-action: none; }
.relight-bar { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; background: var(--panel-2); border-top: 1px solid var(--hairline); }
.relight-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.relight-title { font-weight: 600; margin-right: 6px; }
.relight-segs { display: flex; flex-wrap: wrap; gap: 4px; }
.relight .seg { font: inherit; font-size: 12px; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; cursor: pointer; }
.relight .seg.on { background: var(--sel-bg); border-color: var(--sel-border); color: var(--sel-text); }
.relight-slider { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dim); }
.relight-slider input { width: 92px; accent-color: var(--accent); }
.relight-color input { width: 28px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: 4px; background: none; cursor: pointer; }
.relight-hint { color: var(--dim); font-size: 12px; margin-left: auto; }
.relight-missing { color: var(--amber); font-size: 12px; padding: 6px 0; }
`
