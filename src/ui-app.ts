export function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiByb2xlPSJpbWciIGFyaWEtbGFiZWxsZWRieT0idGl0bGUgZGVzYyI+CiAgPHRpdGxlIGlkPSJ0aXRsZSI+cHAgaWNvbjwvdGl0bGU+CiAgPGRlc2MgaWQ9ImRlc2MiPlBvd2VyIFBsYXRmb3JtIENMSSBtb25vZ3JhbS48L2Rlc2M+CgogIDwhLS0gdGVhbCBsYXllciByZXZlYWxlZCB0aHJvdWdoIGN1dG91dHMgLS0+CiAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIHJ4PSI1MiIgZmlsbD0iIzNlZDRhYSIvPgoKICA8IS0tIG1hc2s6IHdoaXRlID0gZGFyayB2aXNpYmxlLCBibGFjayA9IHRlYWwgc2hvd3MgdGhyb3VnaCAtLT4KICA8bWFzayBpZD0icHAiPgogICAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIGZpbGw9IndoaXRlIi8+CgogICAgPCEtLSBmaXJzdCBwOiBzdGVtICsgYm93bCArIGNvdW50ZXIgLS0+CiAgICA8cmVjdCB4PSI2NCIgeT0iNTIiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxNTYiIHJ4PSI5IiBmaWxsPSJibGFjayIvPgogICAgPGNpcmNsZSBjeD0iMTAwIiBjeT0iODgiIHI9IjM2IiBmaWxsPSJibGFjayIvPgogICAgPGNpcmNsZSBjeD0iMTAwIiBjeT0iODgiIHI9IjE4IiBmaWxsPSJ3aGl0ZSIvPgoKICAgIDwhLS0gc2Vjb25kIHA6IHNhbWUgc2hhcGUsIG9mZnNldCA2NHB4IHJpZ2h0IC0tPgogICAgPHJlY3QgeD0iMTI4IiB5PSI1MiIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE1NiIgcng9IjkiIGZpbGw9ImJsYWNrIi8+CiAgICA8Y2lyY2xlIGN4PSIxNjQiIGN5PSI4OCIgcj0iMzYiIGZpbGw9ImJsYWNrIi8+CiAgICA8Y2lyY2xlIGN4PSIxNjQiIGN5PSI4OCIgcj0iMTgiIGZpbGw9IndoaXRlIi8+CiAgPC9tYXNrPgoKICA8IS0tIGRhcmsgbGF5ZXIgd2l0aCBwcCBwdW5jaGVkIHRocm91Z2ggLS0+CiAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIHJ4PSI1MiIgZmlsbD0iIzE4MjgzMCIgbWFzaz0idXJsKCNwcCkiLz4KPC9zdmc+Cg==">
  <title>pp</title>
  <style>
    :root {
      --bg: #f9fafb;
      --surface: #ffffff;
      --ink: #111111;
      --muted: #6b7280;
      --border: #e5e7eb;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --accent-soft: #eff6ff;
      --danger: #dc2626;
      --ok: #16a34a;
      --ok-soft: #f0fdf4;
      --warn-soft: #fef2f2;
      --radius: 12px;
      --radius-sm: 8px;
      --mono: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
    }
    html.dark {
      --bg: #0a0a0b;
      --surface: #141416;
      --ink: #e4e4e7;
      --muted: #71717a;
      --border: #27272a;
      --accent: #3b82f6;
      --accent-hover: #60a5fa;
      --accent-soft: rgba(59,130,246,0.12);
      --danger: #ef4444;
      --ok: #22c55e;
      --ok-soft: rgba(34,197,94,0.1);
      --warn-soft: rgba(239,68,68,0.1);
    }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ink); background: var(--bg); min-height: 100vh; -webkit-font-smoothing: antialiased; }
    button, input, select, textarea { font: inherit; }

    /* Scrollbars */
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
    }
    *::-webkit-scrollbar { width: 6px; height: 6px; }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    *::-webkit-scrollbar-thumb:hover { background: var(--muted); }

    /* Toast */
    .toast-container { position: fixed; top: 16px; right: 16px; z-index: 100; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
    .toast { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 16px; font-size: 0.8125rem; box-shadow: 0 4px 12px rgba(0,0,0,0.1); pointer-events: auto; animation: toast-in 200ms ease; }
    .toast.error { border-left: 3px solid var(--danger); color: var(--danger); }
    .toast.ok { border-left: 3px solid var(--ok); }
    .toast.fade-out { animation: toast-out 200ms ease forwards; }
    @keyframes toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; } }
    @keyframes toast-out { to { opacity: 0; transform: translateX(20px); } }

    /* Header */
    .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 20px; position: sticky; top: 0; z-index: 10; }
    .header-inner { max-width: 1400px; margin: 0 auto; display: flex; align-items: center; height: 48px; gap: 16px; }
    .logo { font-size: 1rem; font-weight: 700; letter-spacing: -0.02em; flex-shrink: 0; }
    .header-env { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
    .header-env label { font-size: 0.6875rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
    .header-env select { max-width: 280px; }
    .header-meta { display: flex; gap: 12px; align-items: center; font-size: 0.75rem; color: var(--muted); flex-shrink: 0; }

    .env-trigger { display: flex; align-items: center; gap: 8px; max-width: 360px; min-width: 200px; padding: 5px 10px; font-family: inherit; font-size: 0.8125rem; color: var(--ink); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; text-align: left; transition: border-color 120ms, background 120ms; }
    .env-trigger:hover { border-color: var(--accent); background: var(--surface); }
    .env-trigger:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(37,99,235,0.18); }
    .env-trigger-text { display: flex; align-items: baseline; gap: 8px; flex: 1; min-width: 0; overflow: hidden; }
    .env-trigger-alias { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .env-trigger-account { font-size: 0.6875rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .env-trigger-placeholder { color: var(--muted); }
    .env-trigger-chevron { font-size: 0.625rem; color: var(--muted); flex-shrink: 0; }

    .env-picker-backdrop { align-items: flex-start; padding-top: 80px; }
    .env-picker-modal { width: 560px; max-width: 90vw; max-height: 70vh; padding: 0; }
    .env-picker-search { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
    .env-picker-search-icon { color: var(--muted); font-size: 0.9375rem; }
    .env-picker-search input { flex: 1; border: none; outline: none; background: transparent; font-size: 0.9375rem; color: var(--ink); padding: 2px 0; }
    .env-picker-count { font-size: 0.6875rem; color: var(--muted); font-family: var(--mono); flex-shrink: 0; }
    .env-picker-list { overflow: auto; padding: 4px 0; flex: 1; min-height: 0; }
    .env-picker-empty { padding: 24px 16px; text-align: center; color: var(--muted); font-size: 0.8125rem; }
    .env-picker-item { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 8px 14px; border: none; border-left: 2px solid transparent; background: transparent; color: var(--ink); cursor: pointer; text-align: left; transition: background 80ms; }
    .env-picker-item.active { background: var(--accent-soft); border-left-color: var(--accent); }
    .env-picker-item.current .env-picker-alias { color: var(--accent); }
    .env-picker-item-main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .env-picker-alias { font-size: 0.875rem; font-weight: 600; }
    .env-picker-display { font-size: 0.75rem; color: var(--muted); }
    .env-picker-badge { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 3px; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .env-picker-badge.readonly { background: var(--warn-soft, var(--bg)); color: var(--muted); }
    .env-picker-item-meta { display: flex; gap: 12px; font-size: 0.6875rem; color: var(--muted); font-family: var(--mono); }
    .env-picker-host { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .env-picker-account { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .env-picker-footer { display: flex; gap: 14px; padding: 8px 14px; border-top: 1px solid var(--border); font-size: 0.6875rem; color: var(--muted); }
    .env-picker-footer kbd { font-family: var(--mono); font-size: 0.625rem; padding: 1px 5px; margin-right: 3px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg); color: var(--ink); }

    /* Tabs */
    .tabs { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 20px; overflow-x: auto; }
    .tabs-inner { max-width: 1400px; min-width: max-content; margin: 0 auto; display: flex; gap: 0; }
    .tab { padding: 10px 18px; font-size: 0.8125rem; font-weight: 500; color: var(--muted); cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; transition: color 150ms; white-space: nowrap; flex: 0 0 auto; }
    .tab:hover { color: var(--ink); }
    .tab.active { color: var(--ink); border-bottom-color: var(--accent); }
    .tab-sep { width: 1px; background: var(--border); margin: 8px 2px; flex-shrink: 0; }

    /* Layout */
    .main { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .tab-panel { display: none; }
    .tab-panel.active { display: flex; gap: 20px; }
    .tab-panel.active.stack { flex-direction: column; }

    /* Panels */
    .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
    .panel h2 { font-size: 0.9375rem; font-weight: 600; margin-bottom: 4px; }
    .panel .desc { font-size: 0.8125rem; color: var(--muted); margin-bottom: 16px; line-height: 1.5; }

    /* Entity sidebar */
    .entity-sidebar { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; }
    .entity-sidebar .panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .entity-filter { margin-bottom: 8px; }
    .entity-count { font-size: 0.6875rem; color: var(--muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; }
    .entity-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; max-height: calc(100vh - 200px); }
    .entity-item { padding: 8px 10px; border-radius: 6px; cursor: pointer; transition: background 80ms; border: 1px solid transparent; }
    .entity-item:hover { background: var(--bg); }
    .entity-item.active { background: var(--accent-soft); border-color: var(--accent); }
    .entity-item-name { font-size: 0.8125rem; font-weight: 600; line-height: 1.3; display: flex; align-items: center; }
    .entity-item-logical { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); }
    .entity-item-badges { display: flex; gap: 4px; margin-top: 2px; }
    .entity-item-set { font-family: var(--mono); font-size: 0.625rem; color: var(--accent); background: var(--accent-soft); padding: 1px 6px; border-radius: 4px; }
    .entity-item-flag { font-size: 0.625rem; color: var(--muted); background: var(--bg); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); }
    .entity-loading { text-align: center; padding: 40px 16px; color: var(--muted); font-size: 0.8125rem; }

    /* Inventory sidebar (shared by automate/apps/platform) */
    .inventory-sidebar { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; }
    .inventory-sidebar .panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }

    /* Detail area */
    .detail-area { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 20px; }

    /* Dataverse workspace sub-tabs */
    .dv-sub-nav { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
    .dv-subpanel { display: none; }
    .dv-subpanel.active { display: flex; flex-direction: column; gap: 20px; }

    /* Sub-tabs within a panel */
    .sub-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin: -20px -20px 16px; padding: 0 20px; }
    .sub-tab { padding: 10px 16px; font-size: 0.8125rem; font-weight: 500; color: var(--muted); cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; }
    .sub-tab:hover { color: var(--ink); }
    .sub-tab.active { color: var(--ink); border-bottom-color: var(--accent); }
    .sub-panel { display: none; }
    .sub-panel.active { display: block; }

    /* Metrics */
    .metrics { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
    .metric { border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; background: var(--bg); min-width: 120px; }
    .metric-label { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; margin-bottom: 2px; }
    .metric-value { font-family: var(--mono); font-size: 0.8125rem; word-break: break-all; }

    /* Table */
    .table-wrap { overflow: auto; max-height: 500px; }
    .attr-filter { margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
    th { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--surface); z-index: 1; }
    td code { font-family: var(--mono); font-size: 0.75rem; }
    tr.attr-row { cursor: pointer; }
    tr.attr-row:hover { background: var(--bg); }
    tr.attr-row.selected { background: var(--accent-soft); }

    /* Buttons */
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 0.8125rem; font-weight: 500; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; transition: background 120ms; white-space: nowrap; background: var(--surface); color: var(--ink); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--border); }
    .btn-secondary:hover:not(:disabled) { background: var(--bg); }
    .btn-danger { background: none; color: var(--danger); font-size: 0.75rem; padding: 4px 10px; }
    .btn-danger:hover:not(:disabled) { background: var(--warn-soft); }
    .btn-ghost { background: none; color: var(--accent); }
    .btn-ghost:hover:not(:disabled) { background: var(--accent-soft); }
    .btn-group { display: flex; gap: 8px; flex-wrap: wrap; }
    .spinner { width: 14px; height: 14px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 600ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Selected columns bar */
    .selected-cols { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; padding: 8px 0; min-height: 36px; }
    .selected-cols-label { font-size: 0.6875rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; margin-right: 4px; }
    .col-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent-soft); color: var(--accent); border-radius: 4px; padding: 2px 8px; font-size: 0.6875rem; font-family: var(--mono); font-weight: 500; cursor: pointer; }
    .col-chip:hover { background: var(--accent); color: white; }
    .col-chip .x { font-weight: 700; }

    /* Entity context bar (for Query/FetchXML tabs) */
    .entity-context { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 16px; }
    .entity-context-name { font-weight: 600; font-size: 0.875rem; }
    .entity-context-set { font-family: var(--mono); font-size: 0.75rem; color: var(--accent); }
    .entity-context-empty { color: var(--muted); font-size: 0.8125rem; font-style: italic; }

    /* Forms */
    form { display: grid; gap: 14px; }
    .form-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .form-row.three { grid-template-columns: repeat(3, 1fr); }
    .field { display: grid; gap: 4px; }
    .field-label { font-size: 0.6875rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    input, select, textarea { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 0.8125rem; background: var(--surface); color: var(--ink); transition: border-color 150ms; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    textarea { font-family: var(--mono); font-size: 0.8125rem; line-height: 1.5; resize: vertical; }
    textarea.xml-editor { min-height: 320px; }
    .fetchxml-editor-shell { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--surface); }
    .fetchxml-editor-toolbar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 8px 12px; font-size: 0.6875rem; color: var(--muted); border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 78%, var(--bg)); }
    .fetchxml-editor-toolbar-left,
    .fetchxml-editor-toolbar-right { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
    .fetchxml-vim-mode { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); color: var(--ink); font-family: var(--mono); font-size: 0.6875rem; }
    .fetchxml-vim-mode.insert { border-color: var(--ok); color: var(--ok); }
    .fetchxml-vim-mode.normal { border-color: var(--accent); color: var(--accent); }
    .fetchxml-vim-mode.visual { border-color: #d97706; color: #d97706; }
    .fetchxml-vim-mode.replace { border-color: var(--danger); color: var(--danger); }
    .fetchxml-editor-mount .cm-editor { min-height: 320px; font-family: var(--mono); font-size: 0.8125rem; }
    .fetchxml-editor-mount .cm-scroller { overflow: auto; }
    .fetchxml-editor-mount .cm-content { padding: 12px; }
    .fetchxml-editor-mount .cm-focused { outline: none; }
    .fetchxml-editor-mount .cm-panels { background: var(--surface); color: var(--ink); border-color: var(--border); }
    .fetchxml-editor-mount .cm-panel { background: var(--surface); color: var(--ink); }
    .fetchxml-editor-mount .cm-tooltip { background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 30px rgba(0,0,0,0.16); }
    .fetchxml-editor-mount .cm-tooltip .cm-tooltip-arrow:before { border-top-color: var(--border); border-bottom-color: var(--border); }
    .fetchxml-editor-mount .cm-tooltip .cm-tooltip-arrow:after { border-top-color: var(--surface); border-bottom-color: var(--surface); }
    .fetchxml-editor-mount .cm-tooltip-autocomplete { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    .fetchxml-editor-mount .cm-tooltip-autocomplete > ul { background: var(--surface); color: var(--ink); }
    .fetchxml-editor-mount .cm-tooltip-autocomplete > ul > li { color: var(--ink); border-top: 1px solid transparent; border-bottom: 1px solid transparent; }
    .fetchxml-editor-mount .cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] { background: var(--accent-soft); color: var(--ink); }
    .fetchxml-editor-mount .cm-completionIcon { color: var(--muted); opacity: 0.9; }
    .fetchxml-editor-mount .cm-completionLabel { color: inherit; }
    .fetchxml-editor-mount .cm-completionDetail,
    .fetchxml-editor-mount .cm-completionInfo,
    .fetchxml-editor-mount .cm-completionMatchedText { color: inherit; }
    .fetchxml-editor-mount .cm-completionMatchedText { text-decoration-color: var(--accent); }
    .fetchxml-editor-mount .cm-tooltip-lint ul { background: var(--surface); color: var(--ink); }
    .fetchxml-editor-mount .cm-diagnostic { border-left: 3px solid var(--border); background: var(--surface); color: var(--ink); }
    .fetchxml-editor-mount .cm-diagnostic-error { border-left-color: var(--danger); }
    .fetchxml-editor-mount .cm-diagnostic-warning { border-left-color: #d97706; }
    .fetchxml-editor-mount .cm-diagnostic-info { border-left-color: var(--accent); }
    .fetchxml-editor-mount .cm-lintPoint-warning { border-bottom-color: #d97706; }
    .fetchxml-editor-mount .cm-lintPoint-error { border-bottom-color: var(--danger); }
    .fetchxml-editor-mount { min-height: 420px; }
    .fetchxml-editor-mount .monaco-editor,
    .fetchxml-editor-mount .monaco-editor-background,
    .fetchxml-editor-mount .monaco-editor .inputarea.ime-input { background: var(--surface); }
    .fetchxml-editor-mount .monaco-editor { min-height: 420px; }
    .fetchxml-editor-mount .monaco-editor .margin { background: var(--bg); }
    .flow-editor-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 30%); align-items: stretch; min-height: 420px; }
    .flow-editor-main { min-width: 0; min-height: 0; display: flex; }
    .flow-editor-main .fetchxml-editor-mount { flex: 1; height: 100%; min-height: 420px; }
    .flow-editor-main .fetchxml-editor-mount .monaco-editor { height: 100%; min-height: 420px; }
    .flow-outline-rail { border-left: 1px solid var(--border); background: var(--bg); min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .flow-rail-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 0.6875rem; }
    .flow-rail-header h3 { margin: 0; color: var(--ink); font-size: 0.75rem; }
    .flow-outline-rail .empty { margin: 10px; }
    .flow-outline-scroll { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); max-height: 500px; }
    .flow-outline-rail .flow-outline-scroll { border: 0; border-radius: 0; flex: 1; max-height: none; }
    .flow-outline-row { background: transparent; border-radius: 4px; margin: 0 4px; }
    .flow-outline-row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
    .flow-outline-row.active { background: var(--accent-soft); }
    .flow-editor-shell-fullscreen { position: fixed; inset: 12px; z-index: 70; display: flex; flex-direction: column; box-shadow: 0 20px 80px rgba(0,0,0,0.35); }
    .flow-editor-shell-fullscreen .flow-editor-layout { flex: 1; min-height: 0; }
    .flow-editor-shell-fullscreen .fetchxml-editor-mount,
    .flow-editor-shell-fullscreen .fetchxml-editor-mount .monaco-editor { min-height: 0; height: 100%; }
    .flow-diff-modal { width: min(1180px, 94vw); height: min(820px, 88vh); max-height: 88vh; }
    .flow-diff-editor { flex: 1; min-height: 0; }
    .add-action-modal { width: min(920px, 94vw); max-height: 88vh; }
    .add-action-body { padding: 20px; display: grid; gap: 20px; }
    .add-action-section { display: grid; gap: 10px; }
    .add-action-section h3 { margin: 0; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .add-action-template-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
    .add-action-template { display: flex; flex-direction: column; gap: 4px; text-align: left; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--ink); padding: 12px 14px; cursor: pointer; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s; }
    .add-action-template:hover { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 1px var(--accent); }
    .add-action-template.active { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 1px var(--accent); }
    .add-action-template-label { font-weight: 600; font-size: 0.8125rem; }
    .add-action-template-desc { color: var(--muted); font-size: 0.6875rem; line-height: 1.4; }
    .add-action-search { display: flex; gap: 8px; align-items: center; }
    .add-action-search input { flex: 1; min-width: 0; }
    .add-action-searching { color: var(--accent); font-size: 0.6875rem; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
    .add-action-searching::before { content: ''; display: inline-block; width: 12px; height: 12px; border: 1.5px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 600ms linear infinite; }
    .add-action-results { display: grid; gap: 4px; max-height: 280px; overflow: auto; padding: 2px; }
    .add-action-operation { display: grid; grid-template-columns: 32px 1fr; gap: 10px; align-items: start; width: 100%; text-align: left; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--ink); padding: 10px 12px; cursor: pointer; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s; }
    .add-action-operation:hover { border-color: var(--accent); background: var(--accent-soft); }
    .add-action-operation.active { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 1px var(--accent); }
    .add-action-operation-icon { width: 32px; height: 32px; border-radius: 6px; object-fit: contain; flex-shrink: 0; }
    .add-action-operation-icon-placeholder { display: block; background: var(--border); border-radius: 6px; }
    .add-action-operation-text { display: grid; gap: 2px; min-width: 0; }
    .add-action-operation-title { font-weight: 600; font-size: 0.8125rem; }
    .add-action-operation-meta { color: var(--muted); font-family: var(--mono); font-size: 0.6875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .add-action-operation-desc { color: var(--muted); font-size: 0.75rem; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .add-action-form { grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr); align-items: end; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .add-action-form label { display: grid; gap: 4px; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }
    .add-action-form label input,
    .add-action-form label select { background: var(--surface); }
    .add-action-note { grid-column: 1 / -1; color: var(--muted); font-size: 0.75rem; line-height: 1.4; }
    .add-action-footer { align-items: center; border-top: 1px solid var(--border); }
    .add-action-footer-summary { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .add-action-footer-icon { width: 22px; height: 22px; border-radius: 4px; object-fit: contain; flex-shrink: 0; }
    .flow-action-edit-modal { width: min(980px, 94vw); max-height: 90vh; }
    .flow-action-edit-body { padding: 20px; display: grid; gap: 18px; overflow: auto; }
    .flow-action-edit-section { display: grid; gap: 10px; }
    .flow-action-edit-section h3 { margin: 0; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .flow-action-edit-header-info { display: flex; flex-direction: column; gap: 6px; }
    .flow-action-edit-badges { display: flex; gap: 6px; flex-wrap: wrap; }
    .flow-action-edit-badge { display: inline-block; font-family: var(--mono); font-size: 0.625rem; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); line-height: 1.4; }
    .flow-action-edit-tabs { display: flex; gap: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; align-items: center; background: var(--bg); }
    .flow-action-edit-tab { flex: 0 0 auto; background: none; border: none; border-right: 1px solid var(--border); color: var(--muted); font-size: 0.8125rem; font-weight: 500; padding: 8px 18px; cursor: pointer; transition: color 0.15s, background 0.15s; }
    .flow-action-edit-tab:last-of-type { border-right: none; }
    .flow-action-edit-tab:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 4%, transparent); }
    .flow-action-edit-tab.active { color: var(--ink); background: var(--surface); font-weight: 600; }
    .flow-action-edit-schema-label { margin-left: auto; color: var(--muted); font-size: 0.6875rem; padding: 0 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .flow-action-edit-grid { grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr); padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .flow-action-edit-grid label,
    .flow-action-value-editor { display: grid; gap: 4px; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }
    .flow-action-edit-grid label input,
    .flow-action-edit-grid label select { background: var(--surface); }
    .flow-action-field-list { display: grid; gap: 6px; }
    .flow-action-field-group { display: grid; gap: 6px; }
    .flow-action-field-group-title { color: var(--muted); font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
    .flow-action-field-divider { border-top: 1px solid var(--border); margin: 4px 0; }
    .flow-action-schema-field { display: grid; grid-template-columns: minmax(180px, 0.9fr) minmax(220px, 1.1fr); gap: 12px; align-items: start; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; background: var(--bg); transition: border-color 0.15s; }
    .flow-action-schema-field:focus-within { border-color: var(--accent); }
    .flow-action-field-label { color: var(--ink); font-weight: 600; font-size: 0.8125rem; }
    .flow-action-field-meta { color: var(--muted); font-family: var(--mono); font-size: 0.6875rem; }
    .flow-action-field-desc,
    .flow-action-edit-note { color: var(--muted); font-size: 0.75rem; line-height: 1.4; }
    .flow-action-schema-field textarea,
    .flow-action-value-editor textarea,
    .flow-action-json-editor { min-height: 86px; font-family: var(--mono); font-size: 0.75rem; }
    .flow-action-schema-field textarea,
    .flow-action-value-editor textarea { background: var(--surface); }
    .flow-action-json-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .flow-action-json-toolbar .flow-action-edit-note { flex: 1; min-width: 120px; }
    .flow-action-json-toolbar-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .flow-action-json-toolbar .btn { padding: 4px 10px; font-size: 0.6875rem; border: 1px solid var(--border); }
    .flow-action-json-editor { min-height: 320px; resize: vertical; }
    .flow-action-edit-error { color: var(--danger); font-size: 0.75rem; padding: 8px 12px; background: var(--warn-soft); border-radius: var(--radius-sm); border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent); }
    .flow-action-edit-footer-hint { font-family: var(--mono); font-size: 0.625rem; color: var(--muted); padding: 1px 6px; border-radius: 3px; background: var(--bg); border: 1px solid var(--border); margin-left: 4px; }
    @media (max-width: 1100px) {
      .flow-editor-layout { grid-template-columns: 1fr; }
      .flow-outline-rail { border-left: 0; border-top: 1px solid var(--border); max-height: 320px; }
    }
    @media (max-width: 720px) {
      .add-action-form { grid-template-columns: 1fr; }
      .add-action-search { flex-direction: column; }
      .flow-action-edit-grid,
      .flow-action-schema-field { grid-template-columns: 1fr; }
    }
    .fetchxml-diagnostics { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .fetchxml-diagnostic { border: 1px solid var(--border); border-left-width: 3px; border-radius: 8px; padding: 8px 10px; background: var(--bg); }
    .fetchxml-diagnostic.warning { border-left-color: #d97706; }
    .fetchxml-diagnostic.error { border-left-color: var(--danger); }
    .fetchxml-diagnostic.info { border-left-color: var(--accent); }
    .fetchxml-diagnostic-code { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); }
    .fetchxml-diagnostic-message { font-size: 0.75rem; line-height: 1.4; margin-top: 2px; }
    .fetchxml-status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--ok); vertical-align: middle; margin-right: 6px; }
    .fetchxml-status-dot.warn { background: #d97706; }
    .fetchxml-status-dot.error { background: var(--danger); }
    .flow-outline { display: flex; flex-direction: column; gap: 6px; }
    .flow-outline-item { border: 1px solid var(--border); border-radius: 8px; background: var(--bg); padding: 8px 10px; }
    .flow-outline-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .flow-outline-kind { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; }
    .flow-outline-name { font-family: var(--mono); font-size: 0.75rem; font-weight: 600; }
    .flow-outline-detail { font-size: 0.6875rem; color: var(--muted); margin-top: 2px; }
    .flow-outline-children { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding-left: 12px; border-left: 1px solid var(--border); }
    .flow-canvas-container { position: relative; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); overflow: hidden; }
    .flow-outline-canvas { width: 100%; height: calc(100vh - 280px); min-height: 400px; cursor: grab; display: block; }
    .flow-outline-canvas:active { cursor: grabbing; }
    .flow-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .check-row { display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--muted); }
    .check-row input[type="checkbox"] { width: 16px; height: 16px; min-width: 16px; padding: 0; margin: 0; border-radius: 4px; accent-color: var(--accent); cursor: pointer; }
    .conditional { display: none; }
    .conditional.visible { display: grid; }
    .check-row.conditional.visible { display: flex; }

    /* Viewer */
    pre.viewer { margin: 0; padding: 14px; border-radius: var(--radius-sm); background: #1e1e2e; color: #cdd6f4; font-family: var(--mono); font-size: 0.8125rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; min-height: 100px; overflow: auto; }

    /* Empty state */
    .empty { text-align: center; padding: 32px 16px; color: var(--muted); font-size: 0.8125rem; }

    /* Card list (setup) */
    .card-list { display: grid; gap: 8px; }
    .card-item { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .card-item-info { min-width: 0; }
    .card-item-title { font-size: 0.8125rem; font-weight: 600; }
    .card-item-sub { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); word-break: break-all; }
    .badge { font-size: 0.6875rem; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
    .setup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    /* Attribute picker */
    .attr-picker { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); min-height: 40px; max-height: 160px; overflow-y: auto; }
    .attr-chip { display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px; border-radius: 4px; font-size: 0.6875rem; font-family: var(--mono); cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--ink); transition: background 80ms; user-select: none; }
    .attr-chip:hover { border-color: var(--accent); }
    .attr-chip.selected { background: var(--accent); color: white; border-color: var(--accent); }

    /* Condition rows */
    .condition-list { display: grid; gap: 6px; }
    .condition-row { display: grid; grid-template-columns: 1fr 140px 1fr auto; gap: 8px; align-items: center; }
    .condition-row select, .condition-row input { padding: 6px 8px; font-size: 0.8125rem; }
    .condition-remove { background: none; border: none; color: var(--danger); cursor: pointer; font-size: 1rem; padding: 4px 6px; border-radius: 4px; line-height: 1; }
    .condition-remove:hover { background: var(--warn-soft); }

    /* Link entity cards */
    .link-list { display: grid; gap: 10px; }
    .link-card { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; background: var(--bg); }
    .link-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .link-card-head span { font-size: 0.8125rem; font-weight: 600; }
    .link-card .form-row { margin-bottom: 8px; }
    .link-card .attr-picker { max-height: 100px; }
    .link-card .condition-list { margin-top: 8px; }

    /* Health dots */
    .health-row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .health-item { display: flex; align-items: center; gap: 4px; font-size: 0.6875rem; color: var(--muted); }
    .health-item-btn { border: 1px solid var(--border); background: var(--bg); border-radius: 999px; padding: 4px 10px; cursor: pointer; color: var(--ink); font-size: 0.6875rem; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; transition: all 120ms; }
    .health-item-btn:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .health-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .health-dot.pending { background: var(--border); animation: pulse 1.2s ease-in-out infinite; }
    .health-dot.ok { background: var(--ok); }
    .health-dot.error { background: var(--danger); }
    .health-summary { margin-top: 8px; font-size: 0.6875rem; color: var(--muted); line-height: 1.4; }
    .health-detail { margin-top: 10px; padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); font-size: 0.75rem; color: var(--ink); animation: slideDown 150ms ease; }
    .health-detail-title { font-weight: 600; margin-bottom: 6px; font-size: 0.8125rem; }
    .health-detail-meta { color: var(--muted); margin-top: 6px; font-family: var(--mono); font-size: 0.6875rem; }
    .health-detail-pre { margin-top: 8px; white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); background: var(--surface); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); max-height: 160px; overflow: auto; }
    .health-detail-hint { margin-top: 10px; padding: 8px 10px; background: var(--accent-soft); color: var(--accent); border-radius: 6px; font-size: 0.6875rem; line-height: 1.4; }
    @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
    @keyframes slideDown { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

    /* Login link panel */
    .login-link-panel { margin-top: 14px; padding: 14px; border: 1px solid var(--accent); border-radius: var(--radius); background: var(--accent-soft); animation: slideDown 150ms ease; }
    .login-link-panel .login-link-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
    .login-link-panel .login-link-head .field-label { margin: 0; color: var(--accent); }
    .login-link-status { font-size: 0.75rem; color: var(--muted); margin-bottom: 10px; line-height: 1.5; }
    .login-target { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; background: var(--surface); transition: border-color 150ms; }
    .login-target.active { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37,99,235,0.08); }
    .login-target-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
    .login-target-head-left { display: flex; align-items: center; gap: 8px; }
    .login-target-head-left strong { font-size: 0.8125rem; }
    .login-target-status { font-size: 0.6875rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.03em; }
    .login-target-status.running { color: var(--accent); }
    .login-target-status.completed { color: var(--ok); }
    .login-target-status.pending { color: var(--muted); }
    .login-target-url { font-family: var(--mono); font-size: 0.6875rem; word-break: break-all; color: var(--accent); text-decoration: none; }
    .login-target-url:hover { text-decoration: underline; }

    /* Device code card */
    .device-code-card { border: 2px solid var(--accent); border-radius: var(--radius); padding: 16px; background: var(--surface); margin-bottom: 12px; animation: slideDown 150ms ease; }
    .device-code-instruction { font-size: 0.8125rem; color: var(--muted); margin-bottom: 12px; line-height: 1.5; }
    .device-code-url-row { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
    .device-code-url { font-family: var(--mono); font-size: 0.8125rem; color: var(--accent); text-decoration: none; word-break: break-all; }
    .device-code-url:hover { text-decoration: underline; }
    .device-code-open-btn { font-size: 0.75rem !important; padding: 4px 10px !important; flex-shrink: 0; }
    .device-code-box { display: flex; align-items: center; gap: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 16px; }
    .device-code-label { font-size: 0.6875rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .device-code-value { font-family: var(--mono); font-size: 1.5rem; font-weight: 700; letter-spacing: 0.15em; color: var(--ink); user-select: all; flex: 1; }

    /* API scope checkboxes */
    .api-scope-checks { display: flex; flex-wrap: wrap; gap: 6px; }
    .api-scope-check { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; font-weight: 500; cursor: pointer; transition: all 120ms; user-select: none; }
    .api-scope-check:hover { border-color: var(--accent); }
    .api-scope-check:has(input:checked) { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
    .api-scope-check input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); cursor: pointer; }
    .api-scope-note { font-size: 0.625rem; color: var(--muted); font-weight: 400; font-style: italic; }

    /* Onboarding flow */
    .onboarding { display: flex; justify-content: center; padding-top: 24px; }
    .onboarding-card { max-width: 560px; width: 100%; }
    .onboarding-card h2 { margin-bottom: 4px; }
    .onboarding-steps { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .onboarding-step-indicator { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; font-weight: 500; color: var(--muted); }
    .onboarding-step-indicator.active { color: var(--ink); font-weight: 600; }
    .onboarding-step-indicator.done { color: var(--ok); }
    .onboarding-step-divider { width: 24px; height: 1px; background: var(--border); }
    .health-dot.muted { background: var(--border); }

    /* Login progress (step-through) */
    .login-progress-panel { padding: 14px; border: 1px solid var(--accent); border-radius: var(--radius); background: var(--accent-soft); animation: slideDown 150ms ease; }
    .login-progress-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
    .login-progress-title { font-size: 0.875rem; font-weight: 600; color: var(--accent); }
    .login-progress-actions { display: flex; gap: 6px; }
    .login-progress-steps { display: grid; gap: 8px; }
    .login-progress-step { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; background: var(--surface); transition: border-color 150ms; }
    .login-progress-step.active { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37,99,235,0.08); }
    .login-progress-step-head { display: flex; align-items: center; gap: 8px; }
    .login-progress-step-head strong { font-size: 0.8125rem; flex: 1; }
    .login-progress-step-badge { font-size: 0.6875rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.03em; }
    .login-progress-step-badge.done { color: var(--ok); }
    .login-progress-step-badge.active { color: var(--accent); }
    .login-progress-step-badge.failed { color: var(--danger); }
    .login-progress-step-badge.pending { color: var(--muted); }
    .login-progress-step-link { text-decoration: none; }

    /* Health detail inline */
    .health-item-wrap { display: inline-flex; flex-direction: column; }
    .health-detail { padding: 6px 8px; margin-top: 4px; border-radius: var(--radius-sm); background: var(--warn-soft); border: 1px solid var(--danger); font-size: 0.6875rem; line-height: 1.5; animation: slideDown 150ms ease; }
    .health-detail-summary { display: block; font-weight: 600; color: var(--danger); margin-bottom: 2px; }
    .health-detail-hint { display: block; color: var(--muted); }

    /* Advanced options toggle */
    .setup-advanced-toggle { background: none; border: none; cursor: pointer; font-size: 0.75rem; }
    .setup-advanced-fields { animation: slideDown 150ms ease; }

    /* Setup sub-tab layout */
    .setup-layout { display: flex; flex-direction: column; gap: 0; }

    /* Status panel */
    .status-issues { margin-bottom: 20px; border-radius: var(--radius-sm); background: var(--warn-soft); overflow: hidden; }
    .status-issues-toggle { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; border: none; background: none; font: inherit; font-size: 0.8125rem; font-weight: 600; cursor: pointer; color: inherit; text-align: left; }
    .status-issues-caret { display: inline-block; transition: transform 0.15s ease; font-size: 0.75rem; }
    .status-issues-caret.expanded { transform: rotate(90deg); }
    .status-issues-detail { padding: 0 12px 10px; display: grid; gap: 4px; }
    .status-issue { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 0.8125rem; }
    .status-issue-hint { font-size: 0.75rem; color: var(--muted); margin-left: auto; }
    .status-issue-group { margin-top: 4px; }
    .status-issue-group-title { font-size: 0.75rem; font-weight: 600; color: var(--muted); padding: 2px 0; }
    .status-ok-banner { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: var(--radius-sm); background: var(--ok-soft); font-size: 0.8125rem; font-weight: 500; margin-bottom: 20px; }
    .status-section { margin-top: 16px; }
    .status-section h3 { font-size: 0.8125rem; font-weight: 600; margin-bottom: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .status-summary-list { display: grid; gap: 6px; }
    .status-summary-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 0.8125rem; }
    .status-summary-name { font-weight: 600; }
    .status-summary-detail { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); margin-left: auto; }

    /* Empty states */
    .empty-state { padding: 20px; text-align: center; color: var(--muted); }
    .empty-state p { font-size: 0.875rem; margin-bottom: 4px; }
    .empty-state-hint { font-size: 0.8125rem; color: var(--muted); }

    /* My Access panel */
    .access-team-card { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; }
    .access-team-roles { display: flex; gap: 4px; flex-wrap: wrap; }

    /* Theme toggle */
    .theme-toggle { background: none; border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 0.875rem; line-height: 1; color: var(--muted); }
    .theme-toggle:hover { background: var(--bg); color: var(--ink); }

    /* MCP section */
    .mcp-cmd-wrap { display: flex; align-items: stretch; gap: 0; margin-bottom: 12px; }
    .mcp-cmd { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm) 0 0 var(--radius-sm); padding: 10px 14px; font-family: var(--mono); font-size: 0.8125rem; user-select: all; overflow-x: auto; }
    .mcp-copy { background: var(--bg); border: 1px solid var(--border); border-left: none; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; padding: 0 12px; cursor: pointer; color: var(--muted); font-size: 0.75rem; font-weight: 500; }
    .mcp-copy:hover { background: var(--border); color: var(--ink); }
    .tool-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px; }
    .tool-grid code { font-family: var(--mono); font-size: 0.6875rem; background: var(--bg); padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border); display: block; }

    /* Env card detail */
    .env-card { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; }
    .env-card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
    .env-card-title { font-size: 0.875rem; font-weight: 600; }
    .env-card-url { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); word-break: break-all; }
    .env-card-props { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    .env-card-prop { font-size: 0.6875rem; color: var(--muted); }
    .env-card-prop code { font-family: var(--mono); color: var(--ink); }
    .env-card-account { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 0.75rem; font-weight: 500; color: var(--muted); }

    /* ===== API Console ===== */
    .console-bar { display: flex; gap: 0; border: 2px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 16px; transition: border-color 200ms; }
    .console-bar:focus-within { border-color: var(--accent); }
    .console-bar select { border: none; border-right: 1px solid var(--border); border-radius: 0; padding: 10px 12px; font-weight: 600; font-size: 0.8125rem; background: var(--bg); min-width: 0; }
    .console-bar select:focus { outline: none; box-shadow: none; }
    .console-bar input { border: none; border-radius: 0; flex: 1; padding: 10px 14px; font-family: var(--mono); font-size: 0.8125rem; min-width: 0; }
    .console-bar input:focus { outline: none; box-shadow: none; }
    .console-bar .btn { border-radius: 0; border: none; border-left: 1px solid var(--border); padding: 10px 20px; font-weight: 600; }
    #console-api { width: 155px; }
    #console-method { width: 90px; font-family: var(--mono); }

    .console-scope-hint { font-size: 0.6875rem; color: var(--muted); margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
    .console-scope-badge { font-size: 0.625rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.03em; }
    .console-scope-badge.env { background: var(--accent-soft); color: var(--accent); }
    .console-scope-badge.account { background: var(--ok-soft); color: var(--ok); }

    .console-sections { display: grid; gap: 10px; margin-bottom: 16px; }
    .console-sections details { border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .console-sections summary { padding: 10px 14px; cursor: pointer; font-size: 0.8125rem; font-weight: 500; color: var(--muted); user-select: none; }
    .console-sections summary:hover { color: var(--ink); }
    .console-sections .section-body { padding: 0 14px 14px; }

    .kv-list { display: grid; gap: 6px; }
    .kv-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; }
    .kv-row input { padding: 6px 8px; font-size: 0.8125rem; }

    .console-status-badge { display: inline-flex; align-items: center; justify-content: center; padding: 2px 10px; border-radius: 999px; font-family: var(--mono); font-size: 0.75rem; font-weight: 600; background: var(--bg); color: var(--muted); border: 1px solid var(--border); }
    .console-status-badge.success { background: var(--ok-soft); color: var(--ok); border-color: var(--ok); }
    .console-status-badge.error { background: var(--warn-soft); color: var(--danger); border-color: var(--danger); }
    .console-status-badge.small { font-size: 0.625rem; padding: 1px 6px; }

    /* History */
    .history-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; transition: background 80ms; }
    .history-item:hover { background: var(--bg); }
    .history-item-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .history-item-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .history-method { font-family: var(--mono); font-size: 0.6875rem; font-weight: 700; min-width: 42px; }
    .history-method.get { color: var(--ok); }
    .history-method.post { color: var(--accent); }
    .history-method.put, .history-method.patch { color: #d97706; }
    .history-method.delete { color: var(--danger); }
    .history-path { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .history-time { font-size: 0.6875rem; color: var(--muted); }
    .history-api { font-size: 0.625rem; font-weight: 600; color: var(--muted); text-transform: uppercase; }

    /* Flow detail header */
    .flow-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
    .flow-header-info { flex: 1; min-width: 0; }
    .flow-header-title { font-size: 1.125rem; font-weight: 700; margin-bottom: 2px; }
    .flow-header-sub { font-size: 0.8125rem; color: var(--muted); margin-bottom: 8px; }
    .flow-header-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .flow-state-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 0.6875rem; font-weight: 600; }
    .flow-state-badge.started { background: var(--ok-soft); color: var(--ok); }
    .flow-state-badge.stopped { background: var(--warn-soft); color: var(--danger); }
    .flow-state-badge.unknown { background: var(--bg); color: var(--muted); border: 1px solid var(--border); }

    /* Breadcrumb nav for drill-down */
    .flow-breadcrumb { display: flex; align-items: center; gap: 6px; margin-bottom: 14px; font-size: 0.75rem; }
    .flow-breadcrumb-item { color: var(--accent); cursor: pointer; font-weight: 500; }
    .flow-breadcrumb-item:hover { text-decoration: underline; }
    .flow-breadcrumb-sep { color: var(--muted); }
    .flow-breadcrumb-current { color: var(--ink); font-weight: 600; }

    /* Run items (flow runs) */
    .run-card { border-radius: var(--radius-sm); }
    .run-card.active .run-item { border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
    .run-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 0.8125rem; cursor: pointer; transition: all 100ms; position: relative; overflow: hidden; }
    .run-item::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
    .run-item.status-ok::before { background: var(--ok); }
    .run-item.status-error::before { background: var(--danger); }
    .run-item.status-pending::before { background: var(--border); }
    .run-item:hover { background: var(--bg); border-color: var(--accent); }
    .run-item.active { background: var(--accent-soft); border-color: var(--accent); }
    .run-main { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
    .run-text { min-width: 0; flex: 1; }
    .run-status { font-weight: 600; font-size: 0.8125rem; }
    .run-sub { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; font-size: 0.6875rem; color: var(--muted); }
    .run-time { font-size: 0.6875rem; color: var(--muted); flex-shrink: 0; }
    .run-duration { font-size: 0.6875rem; color: var(--muted); font-family: var(--mono); }
    .run-id-copy { border: 1px solid var(--border); background: var(--surface); color: var(--muted); border-radius: 4px; padding: 1px 6px; font-size: 0.625rem; font-family: var(--mono); cursor: pointer; }
    .run-id-copy:hover { color: var(--ink); border-color: var(--accent); background: var(--bg); }
    .copy-mini { border: 1px solid var(--border); background: var(--surface); color: var(--muted); border-radius: 4px; padding: 1px 6px; font-size: 0.625rem; font-family: var(--mono); cursor: pointer; }
    .copy-mini:hover:not(:disabled) { color: var(--ink); border-color: var(--accent); background: var(--bg); }
    .copy-mini:disabled { opacity: 0.45; cursor: default; }
    .copy-inline { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .copy-inline-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .run-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .run-toolbar input, .run-toolbar select { max-width: 220px; }
    .run-expanded { border: 1px solid var(--accent); border-top: none; border-radius: 0 0 var(--radius-sm) var(--radius-sm); padding: 14px; background: var(--surface); }
    .run-action-detail { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 14px; }
    .run-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; }
    .run-summary-card { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; background: var(--bg); }
    .run-summary-card-label { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; margin-bottom: 3px; }
    .run-summary-card-value { font-size: 0.8125rem; font-family: var(--mono); word-break: break-word; }

    /* Action items — pipeline style */
    .action-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid var(--border); border-top: none; cursor: pointer; transition: all 100ms; position: relative; }
    .action-item:first-child { border-top: 1px solid var(--border); border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
    .action-item:last-child { border-radius: 0 0 var(--radius-sm) var(--radius-sm); }
    .action-item:only-child { border-top: 1px solid var(--border); border-radius: var(--radius-sm); }
    .action-item::before { content: ''; position: absolute; left: 14px; top: -1px; bottom: -1px; width: 2px; background: var(--border); }
    .action-item:first-child::before { top: 50%; }
    .action-item:last-child::before { bottom: 50%; }
    .action-item:only-child::before { display: none; }
    .action-item .health-dot { position: relative; z-index: 1; box-shadow: 0 0 0 3px var(--surface); }
    .action-item:hover { background: var(--bg); }
    .action-item:hover .health-dot { box-shadow: 0 0 0 3px var(--bg); }
    .action-item.active { background: var(--accent-soft); border-color: var(--accent); z-index: 1; }
    .action-item.active .health-dot { box-shadow: 0 0 0 3px var(--accent-soft); }
    .action-item-name { font-size: 0.8125rem; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .action-item-type { font-size: 0.6875rem; color: var(--muted); font-family: var(--mono); }
    .action-item-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .action-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .action-toolbar input, .action-toolbar select { max-width: 240px; }
    .action-io-section { margin-bottom: 16px; }
    .action-io-section h3 { font-size: 0.8125rem; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    .action-io-section pre.viewer { max-height: 400px; }
    .action-io-label { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; padding: 2px 8px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border); }

    /* Relationship graph */
    .rel-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
    .rel-toolbar-group { display: flex; align-items: center; gap: 4px; }
    .rel-toolbar-label { font-size: 0.6875rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .rel-toolbar-check { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--muted); cursor: pointer; user-select: none; }
    .rel-toolbar-check input { width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer; }
    .rel-canvas-container { position: relative; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); overflow: hidden; }
    .rel-svg { width: 100%; height: calc(100vh - 200px); min-height: 500px; cursor: grab; touch-action: none; }
    .rel-svg:active { cursor: grabbing; }
    .rel-hint { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); font-size: 0.6875rem; color: var(--muted); background: var(--surface); padding: 4px 12px; border-radius: 999px; border: 1px solid var(--border); pointer-events: none; white-space: nowrap; }
    .rel-edge line { stroke: var(--border); stroke-width: 1.5; }
    .rel-edge:hover line { stroke: var(--accent); stroke-width: 2; }
    .rel-edge-hit { stroke: transparent; stroke-width: 12; fill: none; pointer-events: stroke; }
    .rel-arrowhead { fill: var(--border); }
    .rel-edge:hover .rel-arrowhead { fill: var(--accent); }
    .rel-edge-label { font-size: 9px; fill: var(--muted); text-anchor: middle; pointer-events: none; opacity: 0; transition: opacity 150ms; }
    .rel-edge:hover .rel-edge-label { fill: var(--accent); opacity: 1; }
    .rel-node rect { fill: var(--surface); stroke: var(--border); stroke-width: 1.5; cursor: pointer; transition: stroke 100ms; }
    .rel-node:hover rect { stroke: var(--accent); stroke-width: 2; }
    .rel-node.selected rect { stroke: var(--accent); stroke-width: 2.5; }
    .rel-node.root rect { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2; }
    .rel-node.custom rect { stroke: var(--ok); }
    .rel-node-label { font-size: 11px; font-weight: 600; fill: var(--ink); text-anchor: middle; pointer-events: none; }
    .rel-node-sub { font-size: 9px; fill: var(--muted); text-anchor: middle; pointer-events: none; font-family: var(--mono); }
    .rel-tooltip { position: absolute; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 14px; font-size: 0.75rem; line-height: 1.5; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 5; max-width: 280px; }

    /* JSON syntax highlighting */
    pre.viewer .json-key { color: #89b4fa; }
    pre.viewer .json-str { color: #a6e3a1; }
    pre.viewer .json-num { color: #fab387; }
    pre.viewer .json-bool { color: #cba6f7; }
    pre.viewer .json-null { color: #6c7086; font-style: italic; }

    /* Result table */
    .result-table-wrap { overflow: auto; max-height: 500px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .result-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
    .result-table th { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--surface); z-index: 1; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
    .result-table td { padding: 6px 10px; border-bottom: 1px solid var(--border); font-family: var(--mono); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result-table tr:hover td { background: var(--bg); }
    .result-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin-bottom: 10px; }
    .result-toggle-btn { padding: 5px 14px; font-size: 0.6875rem; font-weight: 500; cursor: pointer; border: none; background: none; color: var(--muted); transition: all 100ms; }
    .result-toggle-btn:hover { color: var(--ink); }
    .result-toggle-btn.active { background: var(--accent-soft); color: var(--accent); }

    /* Record links */
    .record-link { color: var(--accent); cursor: pointer; }
    .record-link:hover { text-decoration: underline; }

    /* React result table */
    .rt-wrap { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
    .rt-scroll { overflow: auto; max-height: 500px; }
    .rt-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
    .rt-th { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--surface); z-index: 1; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; cursor: pointer; user-select: none; transition: color 100ms; position: relative; overflow: hidden; text-overflow: ellipsis; }
    .rt-th:hover { color: var(--ink); }
    .rt-th-sorted { color: var(--accent); }
    .rt-th-label { pointer-events: none; }
    .rt-resize-handle { position: absolute; right: 0; top: 0; bottom: 0; width: 5px; cursor: col-resize; background: transparent; transition: background 100ms; }
    .rt-resize-handle:hover, .rt-resize-handle:active { background: var(--accent); }
    .rt-cell { padding: 6px 10px; border-bottom: 1px solid var(--border); font-family: var(--mono); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
    .rt-cell-null { color: var(--border); font-style: italic; font-size: 0.6875rem; }
    .rt-cell-guid { font-family: var(--mono); }
    .rt-guid-value { cursor: pointer; color: var(--muted); }
    .rt-guid-value:hover { color: var(--accent); text-decoration: underline; }
    .rt-cell-long { position: relative; cursor: pointer; }
    .rt-cell-long .rt-cell-content { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rt-cell-expanded .rt-cell-content { white-space: pre-wrap; word-break: break-all; overflow: visible; }
    .rt-cell-copy { position: absolute; top: 4px; right: 4px; font-size: 0.5625rem; padding: 1px 5px; border: 1px solid var(--border); border-radius: 3px; background: var(--surface); color: var(--muted); cursor: pointer; opacity: 0; transition: opacity 100ms; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; font-family: inherit; }
    .rt-cell-long:hover .rt-cell-copy { opacity: 1; }
    .rt-cell-copy:hover { color: var(--accent); border-color: var(--accent); }
    .rt-table tr:hover td { background: var(--bg); }
    .rt-row-clickable { cursor: pointer; }
    .rt-row-highlight td { background: var(--accent-soft); }
    .rt-footer { padding: 6px 10px; font-size: 0.6875rem; color: var(--muted); border-top: 1px solid var(--border); background: var(--surface); text-align: right; }

    /* Record detail modal */
    .rt-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 80; display: flex; align-items: center; justify-content: center; animation: fadeIn 120ms ease; }
    .rt-modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); width: 640px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.2); animation: slideDown 150ms ease; }
    .rt-modal-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 20px; border-bottom: 1px solid var(--border); gap: 12px; }
    .rt-modal-title { font-size: 0.9375rem; font-weight: 600; margin: 0; }
    .rt-modal-id { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); word-break: break-all; }
    .rt-modal-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .rt-modal-body { overflow: auto; padding: 0; flex: 1; min-height: 0; }
    .rt-modal-loading { padding: 32px 20px; text-align: center; color: var(--muted); font-size: 0.8125rem; }
    .rt-modal-error { padding: 16px 20px; color: var(--danger); font-size: 0.8125rem; }
    .rt-detail-table { width: 100%; border-collapse: collapse; }
    .rt-detail-key { padding: 6px 12px; font-size: 0.6875rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; vertical-align: top; width: 1%; border-bottom: 1px solid var(--border); }
    .rt-detail-value { padding: 6px 12px; font-family: var(--mono); font-size: 0.75rem; word-break: break-all; border-bottom: 1px solid var(--border); }
    .rt-detail-table tr:hover td { background: var(--bg); }
    .rt-detail-edited td { background: var(--accent-soft); }
    .rt-edit-input { width: 100%; font-family: var(--mono); font-size: 0.75rem; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--ink); }
    .rt-edit-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(37,99,235,0.12); }
    .rt-edit-check { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 0.75rem; cursor: pointer; }
    .create-record-toolbar { display: grid; grid-template-columns: minmax(180px, 1fr) auto auto; gap: 10px; align-items: center; padding: 12px; border-bottom: 1px solid var(--border); background: var(--bg); }
    .create-record-warning { padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 0.75rem; }
    .create-record-metadata-warning { padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--muted); background: var(--warn-soft); font-size: 0.75rem; line-height: 1.4; }
    .create-record-section { padding: 10px 12px 6px; color: var(--muted); font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; background: var(--bg); border-bottom: 1px solid var(--border); }
    .create-record-required { display: inline-block; margin-left: 6px; padding: 1px 4px; border-radius: 4px; background: var(--warn-soft); color: var(--danger); font-size: 0.5625rem; text-transform: uppercase; letter-spacing: 0; }
    .create-record-help { margin-top: 4px; color: var(--muted); font-family: var(--sans); font-size: 0.6875rem; word-break: normal; }
    .create-record-lookup-results { display: grid; gap: 4px; max-height: 160px; overflow: auto; }
    .create-record-lookup-result { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 5px 7px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--ink); cursor: pointer; text-align: left; }
    .create-record-lookup-result:hover { border-color: var(--accent); background: var(--accent-soft); }
    .create-record-json { min-height: 360px; border: 0; border-radius: 0; resize: vertical; }
    @media (max-width: 720px) { .create-record-toolbar { grid-template-columns: 1fr; } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    /* Loading / skeleton */
    .workspace-loading { display: flex; align-items: center; justify-content: center; padding: 48px 20px; color: var(--muted); font-size: 0.8125rem; gap: 10px; }
    .workspace-loading .spinner { width: 18px; height: 18px; }

    /* Empty state with CTA */
    .empty-cta { text-align: center; padding: 40px 20px; }
    .empty-cta-icon { font-size: 1.5rem; margin-bottom: 8px; color: var(--muted); }
    .empty-cta p { color: var(--muted); font-size: 0.8125rem; margin-bottom: 12px; line-height: 1.5; }

    /* Token expiry */
    .token-expiry { font-size: 0.625rem; color: var(--muted); font-family: var(--mono); margin-left: 4px; }
    .token-expiry.expiring-soon { color: #d97706; }
    .token-expiry.expired { color: var(--danger); }

    /* Response toolbar */
    .response-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .response-meta { display: flex; align-items: center; gap: 12px; }
    .response-size { font-size: 0.6875rem; color: var(--muted); font-family: var(--mono); }

    /* Saved requests */
    .saved-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; transition: background 80ms; gap: 10px; }
    .saved-item:hover { background: var(--bg); }
    .saved-item-main { display: flex; align-items: center; gap: 10px; min-width: 0; overflow: hidden; flex: 1; }
    .saved-item-name { font-size: 0.75rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .pin-btn { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 0.875rem; padding: 2px 4px; line-height: 1; }
    .pin-btn:hover { color: var(--accent); }
    .pin-btn.pinned { color: var(--accent); }

    /* Setup add sections */
    .setup-add-section { margin-top: 14px; border: 1px dashed var(--border); border-radius: var(--radius-sm); }
    .setup-add-section[open] { border-style: solid; }
    .setup-add-trigger { padding: 10px 14px; cursor: pointer; font-size: 0.8125rem; font-weight: 500; color: var(--accent); user-select: none; list-style: none; }
    .setup-add-trigger::-webkit-details-marker { display: none; }
    .setup-add-trigger::marker { content: ''; }
    .setup-add-trigger:hover { color: var(--accent-hover); }
    .setup-add-body { padding: 0 14px 14px; }

    /* Account cards */
    .account-card { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; transition: border-color 150ms; }
    .account-card-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; cursor: pointer; gap: 12px; }
    .account-card-head:hover { background: var(--bg); }
    .account-card-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .account-card-name { font-size: 0.8125rem; font-weight: 600; }
    .account-card-email { font-size: 0.75rem; color: var(--muted); font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .account-card-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .account-card-body { border-top: 1px solid var(--border); padding: 14px; background: var(--bg); display: none; animation: slideDown 150ms ease; }
    .account-card.expanded .account-card-body { display: block; }
    .account-card-props { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin-bottom: 12px; }
    .account-card-prop { font-size: 0.6875rem; }
    .account-card-prop-label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; margin-bottom: 2px; }
    .account-card-prop-value { font-family: var(--mono); font-size: 0.75rem; word-break: break-all; }
    .account-edit-form { display: grid; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
    .account-edit-form .form-row { gap: 10px; }
    .account-edit-form input, .account-edit-form textarea { padding: 6px 8px; font-size: 0.75rem; }
    .account-edit-form .field-label { font-size: 0.625rem; }
    .browser-profile-section { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
    .browser-profile-section h3 { font-size: 0.8125rem; font-weight: 600; margin-bottom: 2px; }
    .browser-profile-section .btn { font-size: 0.75rem; padding: 5px 12px; }

    .hidden { display: none !important; }

    @media (max-width: 900px) {
      .tab-panel.active { flex-direction: column; }
      .entity-sidebar, .inventory-sidebar { width: 100%; }
      .entity-list { max-height: 300px; }
      .setup-grid, .form-row, .form-row.three { grid-template-columns: 1fr; }
      .header-meta { display: none; }
      .console-bar { flex-wrap: wrap; }
      #console-api, #console-method { width: auto; flex: 1; }
    }
  </style>
</head>
<body>
  <div id="app-root"></div>
  <div id="legacy-shell" hidden>
  <div class="toast-container" id="toasts"></div>
  <header class="header">
    <div class="header-inner">
      <span class="logo"><svg width="24" height="24" viewBox="46 43 172 174" aria-label="pp"><mask id="pp-m"><rect x="46" y="43" width="172" height="174" fill="white"/><circle cx="100" cy="88" r="18" fill="black"/><circle cx="164" cy="88" r="18" fill="black"/></mask><g fill="currentColor" mask="url(#pp-m)"><rect x="64" y="52" width="18" height="156" rx="9"/><circle cx="100" cy="88" r="36"/><rect x="128" y="52" width="18" height="156" rx="9"/><circle cx="164" cy="88" r="36"/></g></svg></span>
      <div class="header-env">
        <label>ENV</label>
        <select id="global-environment" style="flex:1"></select>
      </div>
      <div class="header-meta" id="meta"></div>
      <button class="theme-toggle" id="theme-toggle" title="Toggle dark/light mode">&#9790;</button>
    </div>
  </header>
  <nav class="tabs">
    <div class="tabs-inner">
      <button class="tab" data-tab="setup">Setup</button>
      <button class="tab" data-tab="console">Console</button>
      <div class="tab-sep"></div>
      <button class="tab active" data-tab="dataverse">Dataverse</button>
      <button class="tab" data-tab="automate">Automate</button>
      <button class="tab" data-tab="apps">Apps</button>
      <button class="tab" data-tab="platform">Platform</button>
    </div>
  </nav>
  <div class="main">

    <!-- ===== Setup ===== -->
    <div class="tab-panel stack" id="panel-setup">
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2>Accounts</h2>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost" id="refresh-state" type="button" style="font-size:0.75rem;padding:4px 10px">Refresh</button>
          </div>
        </div>
        <div class="card-list" id="accounts-list"></div>
        <div id="login-link-panel" class="login-link-panel hidden" style="margin-top:14px">
          <div class="login-link-head">
            <span class="field-label">Authentication Links</span>
            <button type="button" class="btn btn-ghost" id="login-link-copy" style="font-size:0.75rem;padding:4px 10px">Copy URLs</button>
          </div>
          <div id="login-link-status" class="login-link-status">Waiting for the identity provider to return a sign-in link\u2026</div>
          <div id="login-link-targets" style="display:grid;gap:8px"></div>
        </div>
        <details class="setup-add-section" id="add-account-section">
          <summary class="setup-add-trigger">+ Add account</summary>
          <div class="setup-add-body">
            <form id="account-form">
              <div class="form-row">
                <div class="field"><span class="field-label">Name</span><input name="name" required placeholder="my-work-account"></div>
                <div class="field"><span class="field-label">Kind</span>
                  <select name="kind" id="account-kind">
                    <option value="user">user</option>
                    <option value="device-code">device-code</option>
                    <option value="client-secret">client-secret</option>
                    <option value="environment-token">environment-token</option>
                    <option value="static-token">static-token</option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="field"><span class="field-label">Description</span><input name="description" placeholder="Optional"></div>
                <div class="field conditional cond-user cond-device-code"><span class="field-label">Preferred Flow</span><select name="preferredFlow"><option value="interactive">interactive</option><option value="device-code">device-code</option></select></div>
              </div>
              <div class="form-row conditional cond-user cond-device-code cond-client-secret">
                <div class="field"><span class="field-label">Tenant ID <span style="text-transform:none;font-weight:400;letter-spacing:0">(optional)</span></span><input name="tenantId" placeholder="defaults to common"></div>
                <div class="field"><span class="field-label">Client ID <span style="text-transform:none;font-weight:400;letter-spacing:0">(optional)</span></span><input name="clientId" placeholder="defaults to built-in app"></div>
              </div>
              <div class="form-row conditional cond-user cond-device-code">
                <div class="field"><span class="field-label">Login Hint</span><input name="loginHint" placeholder="user@example.com"></div>
                <div class="field"><span class="field-label">Prompt</span><select name="prompt"><option value="">default</option><option value="select_account">select_account</option><option value="login">login</option><option value="consent">consent</option><option value="none">none</option></select></div>
              </div>
              <div class="form-row conditional cond-client-secret"><div class="field"><span class="field-label">Client Secret Env Var</span><input name="clientSecretEnv" placeholder="MY_CLIENT_SECRET"></div><div class="field"></div></div>
              <div class="form-row conditional cond-environment-token"><div class="field"><span class="field-label">Token Env Var</span><input name="environmentVariable" placeholder="MY_TOKEN_VAR"></div><div class="field"></div></div>
              <div class="conditional cond-static-token"><div class="field"><span class="field-label">Static Token</span><textarea name="token" placeholder="Paste token"></textarea></div></div>
              <div class="check-row conditional cond-user cond-device-code"><input type="checkbox" name="forcePrompt" id="forcePrompt"><label for="forcePrompt">Force prompt on next login</label></div>
              <div class="check-row conditional cond-user"><input type="checkbox" name="fallbackToDeviceCode" id="fallbackToDeviceCode"><label for="fallbackToDeviceCode">Allow fallback to device code</label></div>
              <div class="conditional cond-user cond-device-code" id="api-scope-section">
                <div class="field">
                  <span class="field-label">API Scopes to Authenticate</span>
                  <div class="api-scope-checks" id="api-scope-checks">
                    <label class="api-scope-check"><input type="checkbox" value="dv" checked> Dataverse</label>
                    <label class="api-scope-check"><input type="checkbox" value="flow" checked> Flow</label>
                    <label class="api-scope-check"><input type="checkbox" value="powerapps" checked> Power Apps & BAP <span class="api-scope-note">shared token</span></label>
                    <label class="api-scope-check"><input type="checkbox" value="graph"> Graph <span class="api-scope-note">optional</span></label>
                  </div>
                </div>
              </div>
              <div class="btn-group">
                <button type="submit" class="btn btn-primary" id="account-submit">Save & Login</button>
                <button type="button" class="btn btn-danger hidden" id="account-cancel">Cancel Pending Login</button>
              </div>
            </form>
          </div>
        </details>
      </div>

      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2>Environments</h2>
          <button class="btn btn-ghost" id="recheck-health" type="button" style="font-size:0.75rem;padding:4px 10px">Re-check health</button>
        </div>
        <div class="card-list" id="environments-list"></div>
        <details class="setup-add-section">
          <summary class="setup-add-trigger">+ Add environment</summary>
          <div class="setup-add-body">
            <form id="discover-form" style="margin-bottom:16px">
              <div class="form-row">
                <div class="field"><span class="field-label">Account</span><select name="account" id="discover-account"></select></div>
                <div class="field" style="align-self:end"><button type="submit" class="btn btn-secondary" id="discover-submit">Discover</button></div>
              </div>
            </form>
            <div class="card-list" id="discovered-list" style="margin-bottom:16px"></div>
            <form id="environment-form">
              <div class="form-row">
                <div class="field"><span class="field-label">Alias</span><input name="alias" required placeholder="dev, prod"></div>
                <div class="field"><span class="field-label">Account</span><select name="account" id="environment-account"></select></div>
              </div>
              <div class="form-row">
                <div class="field"><span class="field-label">URL</span><input name="url" required placeholder="https://org.crm.dynamics.com"></div>
                <div class="field"><span class="field-label">Display Name</span><input name="displayName" placeholder="Optional"></div>
              </div>
              <div class="field"><span class="field-label">Access</span><select name="accessMode"><option value="">read-write (default)</option><option value="read-write">read-write</option><option value="read-only">read-only</option></select></div>
              <div class="btn-group"><button type="submit" class="btn btn-primary" id="env-submit">Discover & Save</button></div>
            </form>
          </div>
        </details>
      </div>

      <details class="setup-add-section" style="border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);padding:0">
        <summary class="setup-add-trigger" style="padding:16px 20px">MCP Server</summary>
        <div style="padding:0 20px 20px">
          <p class="desc">The MCP server uses stdio transport. Launch it from your MCP client.</p>
          <div id="mcp-content"></div>
        </div>
      </details>
    </div>

    <!-- ===== API Console ===== -->
    <div class="tab-panel stack" id="panel-console">
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2>API Console</h2>
          <select id="console-preset" style="max-width:260px;font-size:0.8125rem"></select>
        </div>
        <div class="console-bar">
          <select id="console-api"></select>
          <select id="console-method"></select>
          <input type="text" id="console-path" placeholder="/WhoAmI">
          <button class="btn btn-primary" id="console-send">Send</button>
        </div>
        <div class="console-scope-hint" id="console-scope-hint"></div>
        <div class="console-sections">
          <details>
            <summary>Query Parameters</summary>
            <div class="section-body">
              <div id="console-query-params" class="kv-list"></div>
              <button class="btn btn-ghost" id="console-add-query-param" type="button" style="margin-top:6px;padding:4px 10px;font-size:0.75rem">+ Add parameter</button>
            </div>
          </details>
          <details>
            <summary>Headers</summary>
            <div class="section-body">
              <div id="console-headers" class="kv-list"></div>
              <button class="btn btn-ghost" id="console-add-header" type="button" style="margin-top:6px;padding:4px 10px;font-size:0.75rem">+ Add header</button>
            </div>
          </details>
          <details id="console-body-section">
            <summary>Request Body</summary>
            <div class="section-body">
              <textarea id="console-body" rows="8" placeholder='{ "key": "value" }'></textarea>
            </div>
          </details>
        </div>
      </div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h2>Response <span id="console-response-status" class="console-status-badge" style="margin-left:8px"></span></h2>
          <span id="console-response-time" style="font-size:0.75rem;color:var(--muted);font-family:var(--mono)"></span>
        </div>
        <details style="margin-bottom:8px;display:none">
          <summary style="cursor:pointer;font-size:0.75rem;color:var(--muted)">Response Headers</summary>
          <pre class="viewer" id="console-response-headers-body" style="min-height:40px;margin-top:6px"></pre>
        </details>
        <div class="response-toolbar">
          <div class="response-meta">
            <span id="console-response-size" class="response-size"></span>
          </div>
          <button class="btn btn-ghost" id="console-copy-response" type="button" style="font-size:0.75rem;padding:4px 10px">Copy</button>
        </div>
        <pre class="viewer" id="console-response-body">Send a request to see the response.</pre>
      </div>
      <div class="panel" id="console-saved-panel" style="display:none">
        <h2 style="margin-bottom:12px">Saved Requests</h2>
        <div id="console-saved" class="card-list"></div>
      </div>
      <div class="panel">
        <h2 style="margin-bottom:12px">History</h2>
        <div id="console-history" class="card-list">
          <div class="empty">No requests yet.</div>
        </div>
      </div>
    </div>

    <!-- ===== Dataverse Workspace ===== -->
    <div class="tab-panel active" id="panel-dataverse">
      <div class="entity-sidebar">
        <div class="panel">
          <h2>Entities</h2>
          <input type="text" id="entity-filter" class="entity-filter" placeholder="Filter entities\u2026">
          <div id="entity-count" class="entity-count"></div>
          <div id="entity-list" class="entity-list">
            <div class="entity-loading">Select an environment to load entities.</div>
          </div>
        </div>
      </div>
      <div class="detail-area" id="dv-workspace-area">
        <div class="dv-sub-nav">
          <button class="sub-tab active" data-dvtab="dv-explorer">Explorer</button>
          <button class="sub-tab" data-dvtab="dv-query">Query</button>
          <button class="sub-tab" data-dvtab="dv-fetchxml">FetchXML</button>
          <button class="sub-tab" data-dvtab="dv-relationships">Relationships</button>
        </div>

        <!-- Explorer sub-panel -->
        <div class="dv-subpanel active" id="dv-subpanel-dv-explorer">
          <div class="panel" id="entity-detail-panel">
            <div id="entity-detail-empty">
              <h2>Entity Detail</h2>
              <p class="desc">Select an entity from the list to inspect its metadata and preview records.</p>
              <div class="empty">No entity selected.</div>
            </div>
            <div id="entity-detail" class="hidden">
              <div class="sub-tabs">
                <button class="sub-tab active" data-subtab="metadata">Metadata</button>
                <button class="sub-tab" data-subtab="records">Records</button>
              </div>

              <!-- Metadata sub-panel -->
              <div class="sub-panel active" id="subpanel-metadata">
                <h2 id="entity-title"></h2>
                <p class="desc" id="entity-subtitle"></p>
                <div id="entity-metrics" class="metrics"></div>
                <div class="btn-group" style="margin-bottom:12px">
                  <button class="btn btn-primary btn-sm" id="entity-to-query" type="button">Use in Query</button>
                  <button class="btn btn-primary btn-sm" id="entity-to-fetchxml" type="button">Use in FetchXML</button>
                </div>
                <div class="selected-cols" id="selected-cols">
                  <span class="selected-cols-label">Selected:</span>
                  <span style="color:var(--muted);font-size:0.75rem">Click attributes below to select columns</span>
                </div>
                <input type="text" id="attr-filter" class="attr-filter" placeholder="Filter attributes\u2026">
                <div class="table-wrap">
                  <table>
                    <thead><tr><th></th><th>Column</th><th>Type</th><th>Flags</th></tr></thead>
                    <tbody id="attribute-table"></tbody>
                  </table>
                </div>
              </div>

              <!-- Records sub-panel -->
              <div class="sub-panel" id="subpanel-records">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                  <h2>Record Preview</h2>
                  <button class="btn btn-secondary" id="entity-refresh-records" type="button">Refresh</button>
                </div>
                <div id="record-preview-path" style="font-family:var(--mono);font-size:0.75rem;color:var(--muted);margin-bottom:8px"></div>
                <div class="result-toggle" id="record-preview-toggle" style="margin-top:8px">
                  <button class="result-toggle-btn active" data-view="table">Table</button>
                  <button class="result-toggle-btn" data-view="json">JSON</button>
                </div>
                <div id="record-preview-table"></div>
                <pre class="viewer" id="record-preview-json" style="display:none">Select an entity to preview records.</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Query sub-panel -->
        <div class="dv-subpanel" id="dv-subpanel-dv-query">
          <div class="panel">
            <h2>Web API Query</h2>
            <div class="entity-context" id="query-entity-context">
              <span class="entity-context-empty">No entity selected \u2014 pick one in Explorer or type an entity set below</span>
            </div>
            <form id="query-form">
              <div class="form-row">
                <div class="field">
                  <span class="field-label">Entity Set</span>
                  <input name="entitySetName" id="query-entity-set" placeholder="accounts">
                </div>
                <div class="field">
                  <span class="field-label">Top</span>
                  <input name="top" type="number" min="1" step="1" value="10">
                </div>
              </div>
              <div class="field">
                <span class="field-label">Select Columns (CSV)</span>
                <input name="selectCsv" id="query-select" placeholder="accountid,name,accountnumber">
              </div>
              <div class="field">
                <span class="field-label">Filter</span>
                <input name="filter" id="query-filter" placeholder="contains(name,'Contoso')">
              </div>
              <div class="form-row">
                <div class="field">
                  <span class="field-label">Order By (CSV)</span>
                  <input name="orderByCsv" id="query-order" placeholder="name asc,createdon desc">
                </div>
                <div class="field">
                  <span class="field-label">Expand (CSV)</span>
                  <input name="expandCsv" id="query-expand" placeholder="primarycontactid($select=fullname)">
                </div>
              </div>
              <div class="field">
                <span class="field-label">Raw Path Override</span>
                <input name="rawPath" id="query-raw-path" placeholder="/api/data/v9.2/accounts?$select=name">
              </div>
              <div class="check-row"><input type="checkbox" name="includeCount" id="query-count"><label for="query-count">Include count</label></div>
              <div class="btn-group">
                <button class="btn btn-secondary" id="query-preview-btn" type="button">Preview Path</button>
                <button class="btn btn-primary" id="query-run-btn" type="button">Run Query</button>
              </div>
            </form>
          </div>
          <div class="panel">
            <h2>Generated Path</h2>
            <pre class="viewer" id="query-preview">Preview a Dataverse path here.</pre>
          </div>
          <div class="panel">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <h2>Query Result</h2>
              <div class="result-toggle" id="query-result-toggle">
                <button class="result-toggle-btn active" data-view="table">Table</button>
                <button class="result-toggle-btn" data-view="json">JSON</button>
              </div>
            </div>
            <div id="query-result-table"></div>
            <pre class="viewer" id="query-result" style="display:none">Run a query to see the response.</pre>
          </div>
        </div>

        <!-- FetchXML sub-panel -->
        <div class="dv-subpanel" id="dv-subpanel-dv-fetchxml">
          <div class="panel">
            <h2>FetchXML</h2>
            <div class="entity-context" id="fetch-entity-context">
              <span class="entity-context-empty">No entity selected \u2014 pick one in Explorer or fill in the fields below</span>
            </div>
            <form id="fetchxml-form">
              <div class="field">
                <span class="field-label">FetchXML</span>
                <div class="fetchxml-editor-shell">
                  <div class="fetchxml-editor-toolbar">
                    <div class="fetchxml-editor-toolbar-left">
                      <span id="fetch-editor-status"><span class="fetchxml-status-dot"></span>IntelliSense ready</span>
                      <span id="fetch-vim-mode" class="fetchxml-vim-mode normal">NORMAL</span>
                    </div>
                    <div class="fetchxml-editor-toolbar-right">
                      <span>Autocomplete for FetchXML structure, entities, attributes, operators, and join fields. Vim mode enabled.</span>
                    </div>
                  </div>
                  <div id="fetch-editor" class="fetchxml-editor-mount"></div>
                </div>
                <textarea name="rawXml" id="fetch-raw" class="xml-editor" hidden placeholder='<fetch top="50">&#10;  <entity name="account">&#10;    <attribute name="name" />&#10;    <filter>&#10;      <condition attribute="statecode" operator="eq" value="0" />&#10;    </filter>&#10;  </entity>&#10;</fetch>'></textarea>
                <div id="fetch-diagnostics" class="fetchxml-diagnostics"></div>
              </div>
              <div class="btn-group">
                <button class="btn btn-primary" id="fetch-run-btn" type="button">Run FetchXML</button>
                <button class="btn btn-secondary" id="fetch-preview-btn" type="button">Build from fields below</button>
              </div>
              <details style="margin-top:4px" id="fetch-builder">
                <summary style="cursor:pointer;font-size:0.8125rem;font-weight:500;color:var(--muted)">Form builder</summary>
                <div style="display:grid;gap:14px;margin-top:14px">
                  <div class="form-row">
                    <div class="field">
                      <span class="field-label">Entity</span>
                      <select name="entity" id="fetch-entity"><option value="">select entity\u2026</option></select>
                    </div>
                    <div class="field">
                      <span class="field-label">Entity Set Name</span>
                      <input name="entitySetName" id="fetch-entity-set" placeholder="accounts" readonly tabindex="-1" style="color:var(--muted)">
                    </div>
                  </div>
                  <div class="field">
                    <span class="field-label">Attributes</span>
                    <div id="fetch-attr-picker" class="attr-picker"></div>
                    <input name="attributesCsv" id="fetch-attrs" type="hidden">
                  </div>
                  <div class="form-row three">
                    <div class="field"><span class="field-label">Top</span><input name="top" type="number" min="1" step="1" value="50"></div>
                    <div class="field"><span class="field-label">Distinct</span><select name="distinct" id="fetch-distinct"><option value="false">false</option><option value="true">true</option></select></div>
                    <div class="field"><span class="field-label">Filter Type</span><select id="fetch-filter-type"><option value="and">and</option><option value="or">or</option></select></div>
                  </div>
                  <div class="field">
                    <span class="field-label">Conditions</span>
                    <div id="fetch-conditions" class="condition-list"></div>
                    <button type="button" class="btn btn-ghost" id="fetch-add-condition" style="margin-top:6px;padding:4px 10px;font-size:0.75rem">+ Add condition</button>
                  </div>
                  <div class="form-row">
                    <div class="field">
                      <span class="field-label">Order By</span>
                      <select id="order-attribute"><option value="">none</option></select>
                    </div>
                    <div class="field">
                      <span class="field-label">Direction</span>
                      <select id="order-desc"><option value="false">ascending</option><option value="true">descending</option></select>
                    </div>
                  </div>
                  <div class="field">
                    <span class="field-label">Link Entities (Joins)</span>
                    <div id="fetch-links" class="link-list"></div>
                    <button type="button" class="btn btn-ghost" id="fetch-add-link" style="margin-top:6px;padding:4px 10px;font-size:0.75rem">+ Add join</button>
                  </div>
                </div>
              </details>
            </form>
          </div>
          <div class="panel">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <h2>FetchXML Result</h2>
              <div class="result-toggle" id="fetch-result-toggle">
                <button class="result-toggle-btn active" data-view="table">Table</button>
                <button class="result-toggle-btn" data-view="json">JSON</button>
              </div>
            </div>
            <div id="fetch-result-table"></div>
            <pre class="viewer" id="fetch-result" style="display:none">Run FetchXML to see the response.</pre>
          </div>
        </div>

        <!-- Relationships sub-panel -->
        <div class="dv-subpanel" id="dv-subpanel-dv-relationships">
          <div class="panel" style="padding:14px">
            <div class="rel-toolbar">
              <select id="rel-entity" style="max-width:240px"></select>
              <div class="rel-toolbar-group">
                <label class="rel-toolbar-label">Depth</label>
                <select id="rel-depth" style="width:60px">
                  <option value="1">1</option>
                  <option value="2" selected>2</option>
                  <option value="3">3</option>
                </select>
              </div>
              <label class="rel-toolbar-check"><input type="checkbox" id="rel-hide-system" checked> Hide system</label>
              <button class="btn btn-primary" id="rel-load" style="padding:5px 14px;font-size:0.75rem">Load Graph</button>
              <span id="rel-status" style="font-size:0.6875rem;color:var(--muted);margin-left:auto"></span>
            </div>
            <div class="rel-canvas-container" id="rel-container">
              <svg id="rel-svg" class="rel-svg" xmlns="http://www.w3.org/2000/svg"></svg>
              <div id="rel-tooltip" class="rel-tooltip hidden"></div>
              <div class="rel-hint">Select an entity and click Load Graph. Click a node to expand or explore. Drag to rearrange. Scroll to zoom.</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Automate Workspace ===== -->
    <div class="tab-panel" id="panel-automate">
      <div class="inventory-sidebar">
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h2>Flows</h2>
            <button class="btn btn-ghost" id="flow-refresh" type="button" style="font-size:0.75rem;padding:4px 10px">Refresh</button>
          </div>
          <input type="text" id="flow-filter" class="entity-filter" placeholder="Filter flows\u2026">
          <div id="flow-count" class="entity-count"></div>
          <div id="flow-list" class="entity-list">
            <div class="entity-loading">Select an environment to load flows.</div>
          </div>
        </div>
      </div>
      <div class="detail-area">
        <div class="panel">
          <div id="flow-detail-empty">
            <h2>Flow Detail</h2>
            <p class="desc">Select a flow from the list to inspect its properties and recent runs.</p>
            <div class="empty">No flow selected.</div>
          </div>
          <div id="flow-detail" class="hidden">
            <div class="flow-header">
              <div class="flow-header-info">
                <div class="flow-header-title" id="flow-title"></div>
                <div class="flow-header-sub" id="flow-subtitle"></div>
                <div id="flow-state-badge-container"></div>
              </div>
              <div class="flow-header-actions">
                <button class="btn btn-ghost" id="flow-open-console" type="button" style="font-size:0.75rem">Open in Console</button>
              </div>
            </div>
            <div id="flow-metrics" class="metrics"></div>
          </div>
        </div>
        <div class="panel" id="flow-language-panel" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
            <div>
              <h2>Definition Lab</h2>
              <p class="desc" style="margin-bottom:0">Inspect the selected flow definition with shared CLI/UI validation, graph diagnostics, and expression-aware completions.</p>
            </div>
            <div class="btn-group">
              <span id="flow-language-status" style="font-size:0.75rem;color:var(--muted)"><span class="fetchxml-status-dot warn"></span>Definition not loaded</span>
              <button class="btn btn-secondary" id="flow-language-load" type="button">Load definition</button>
              <button class="btn btn-primary" id="flow-language-analyze" type="button">Analyze</button>
            </div>
          </div>
          <div class="fetchxml-editor-shell">
            <div class="fetchxml-editor-toolbar">
              <div class="fetchxml-editor-toolbar-left">
                <span>Workflow definition JSON</span>
              </div>
              <div class="fetchxml-editor-toolbar-right">
                <span id="flow-language-summary-text">No analysis yet</span>
              </div>
            </div>
            <div id="flow-language-editor" class="fetchxml-editor-mount"></div>
          </div>
          <div style="margin-top:14px">
            <div id="flow-language-summary" class="flow-summary-grid" style="margin-bottom:12px"></div>
            <div id="flow-language-diagnostics" class="fetchxml-diagnostics"></div>
          </div>
        </div>
        <div class="panel" id="flow-outline-panel" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h2>Flow Outline</h2>
            <div class="btn-group">
              <button class="btn btn-ghost flow-outline-zoom-btn" id="flow-outline-zoom-fit" type="button" style="font-size:0.6875rem;padding:3px 8px">Fit</button>
              <button class="btn btn-ghost flow-outline-zoom-btn" id="flow-outline-zoom-in" type="button" style="font-size:0.6875rem;padding:3px 8px">+</button>
              <button class="btn btn-ghost flow-outline-zoom-btn" id="flow-outline-zoom-out" type="button" style="font-size:0.6875rem;padding:3px 8px">\u2212</button>
            </div>
          </div>
          <div class="flow-canvas-container" id="flow-canvas-container">
            <canvas id="flow-outline-canvas" class="flow-outline-canvas"></canvas>
            <div id="flow-language-outline" class="hidden"></div>
          </div>
        </div>
        <div class="panel" id="flow-runs-panel" style="display:none">
          <h2 style="margin-bottom:12px">Runs</h2>
          <div class="run-toolbar">
            <input type="text" id="flow-run-filter" placeholder="Filter runs by status or trigger…">
            <select id="flow-run-status-filter">
              <option value="">All statuses</option>
              <option value="Failed">Failed</option>
              <option value="Running">Running</option>
              <option value="Succeeded">Succeeded</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
          <div id="flow-runs" class="card-list">
            <div class="empty">Select a flow to see runs.</div>
          </div>
        </div>
        <div class="panel" id="flow-actions-panel" style="display:none">
          <div id="flow-actions-breadcrumb" class="flow-breadcrumb"></div>
          <div id="flow-run-summary" style="margin-bottom:14px"></div>
          <div class="action-toolbar">
            <input type="text" id="flow-action-filter" placeholder="Filter actions by name, type, or code…">
            <select id="flow-action-status-filter">
              <option value="">All statuses</option>
              <option value="Failed">Failed</option>
              <option value="Running">Running</option>
              <option value="Succeeded">Succeeded</option>
              <option value="Skipped">Skipped</option>
            </select>
          </div>
          <div id="flow-actions" class="card-list"></div>
        </div>
        <div class="panel" id="flow-action-detail-panel" style="display:none">
          <div id="flow-action-breadcrumb" class="flow-breadcrumb"></div>
          <h2 id="flow-action-title" style="margin-bottom:12px">Action Detail</h2>
          <div id="flow-action-metrics" class="metrics" style="margin-bottom:12px"></div>
          <div id="flow-action-io"></div>
        </div>
      </div>
    </div>

    <!-- ===== Apps Workspace ===== -->
    <div class="tab-panel" id="panel-apps">
      <div class="inventory-sidebar">
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h2>Apps</h2>
            <button class="btn btn-ghost" id="app-refresh" type="button" style="font-size:0.75rem;padding:4px 10px">Refresh</button>
          </div>
          <input type="text" id="app-filter" class="entity-filter" placeholder="Filter apps\u2026">
          <div id="app-count" class="entity-count"></div>
          <div id="app-list" class="entity-list">
            <div class="entity-loading">Select an environment to load apps.</div>
          </div>
        </div>
      </div>
      <div class="detail-area">
        <div class="panel">
          <div id="app-detail-empty">
            <h2>App Detail</h2>
            <p class="desc">Select an app from the list to inspect its metadata and connections.</p>
            <div class="empty">No app selected.</div>
          </div>
          <div id="app-detail" class="hidden">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div>
                <h2 id="app-title"></h2>
                <p class="desc" id="app-subtitle" style="margin-bottom:0"></p>
              </div>
              <button class="btn btn-ghost" id="app-open-console" type="button" style="font-size:0.75rem">Open in Console</button>
            </div>
            <div id="app-metrics" class="metrics"></div>
            <div id="app-connections"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Platform Workspace ===== -->
    <div class="tab-panel" id="panel-platform">
      <div class="inventory-sidebar">
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h2>Environments</h2>
            <button class="btn btn-ghost" id="plat-env-refresh" type="button" style="font-size:0.75rem;padding:4px 10px">Refresh</button>
          </div>
          <input type="text" id="plat-env-filter" class="entity-filter" placeholder="Filter environments\u2026">
          <div id="plat-env-count" class="entity-count"></div>
          <div id="plat-env-list" class="entity-list">
            <div class="entity-loading">Select an environment to discover platform environments.</div>
          </div>
        </div>
      </div>
      <div class="detail-area">
        <div class="panel">
          <div id="plat-env-detail-empty">
            <h2>Environment Detail</h2>
            <p class="desc">Select an environment from the list to inspect its platform metadata.</p>
            <div class="empty">No environment selected.</div>
          </div>
          <div id="plat-env-detail" class="hidden">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div>
                <h2 id="plat-env-title"></h2>
                <p class="desc" id="plat-env-subtitle" style="margin-bottom:0"></p>
              </div>
              <button class="btn btn-ghost" id="plat-env-open-console" type="button" style="font-size:0.75rem">Open in Console</button>
            </div>
            <div id="plat-env-metrics" class="metrics"></div>
            <div id="plat-env-linked"></div>
          </div>
        </div>
      </div>
    </div>

  </div>
  </div>

  <script type="module" src="/assets/ui/app.js"></script>
</body>
</html>`;
}
