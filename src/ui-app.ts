export function renderHtml(options: { scriptSrc?: string } = {}): string {
  const scriptSrc = options.scriptSrc ?? '/assets/ui/app.js';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiByb2xlPSJpbWciIGFyaWEtbGFiZWxsZWRieT0idGl0bGUgZGVzYyI+CiAgPHRpdGxlIGlkPSJ0aXRsZSI+cHAgaWNvbjwvdGl0bGU+CiAgPGRlc2MgaWQ9ImRlc2MiPlBvd2VyIFBsYXRmb3JtIENMSSBtb25vZ3JhbS48L2Rlc2M+CgogIDwhLS0gdGVhbCBsYXllciByZXZlYWxlZCB0aHJvdWdoIGN1dG91dHMgLS0+CiAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIHJ4PSI1MiIgZmlsbD0iIzNlZDRhYSIvPgoKICA8IS0tIG1hc2s6IHdoaXRlID0gZGFyayB2aXNpYmxlLCBibGFjayA9IHRlYWwgc2hvd3MgdGhyb3VnaCAtLT4KICA8bWFzayBpZD0icHAiPgogICAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIGZpbGw9IndoaXRlIi8+CgogICAgPCEtLSBmaXJzdCBwOiBzdGVtICsgYm93bCArIGNvdW50ZXIgLS0+CiAgICA8cmVjdCB4PSI2NCIgeT0iNTIiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxNTYiIHJ4PSI5IiBmaWxsPSJibGFjayIvPgogICAgPGNpcmNsZSBjeD0iMTAwIiBjeT0iODgiIHI9IjM2IiBmaWxsPSJibGFjayIvPgogICAgPGNpcmNsZSBjeD0iMTAwIiBjeT0iODgiIHI9IjE4IiBmaWxsPSJ3aGl0ZSIvPgoKICAgIDwhLS0gc2Vjb25kIHA6IHNhbWUgc2hhcGUsIG9mZnNldCA2NHB4IHJpZ2h0IC0tPgogICAgPHJlY3QgeD0iMTI4IiB5PSI1MiIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE1NiIgcng9IjkiIGZpbGw9ImJsYWNrIi8+CiAgICA8Y2lyY2xlIGN4PSIxNjQiIGN5PSI4OCIgcj0iMzYiIGZpbGw9ImJsYWNrIi8+CiAgICA8Y2lyY2xlIGN4PSIxNjQiIGN5PSI4OCIgcj0iMTgiIGZpbGw9IndoaXRlIi8+CiAgPC9tYXNrPgoKICA8IS0tIGRhcmsgbGF5ZXIgd2l0aCBwcCBwdW5jaGVkIHRocm91Z2ggLS0+CiAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIHJ4PSI1MiIgZmlsbD0iIzE4MjgzMCIgbWFzaz0idXJsKCNwcCkiLz4KPC9zdmc+Cg==">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Geist:wght@100..900&display=swap" rel="stylesheet">
  <title>pp</title>
  <style>
    :root {
      --bg: #f6f6f5;
      --surface: #ffffff;
      --ink: #1a1a19;
      --muted: #6c6c69;
      --muted-2: #acaca8;
      --border: #ececea;
      --border-soft: #f3f3f1;
      --accent: #3e6b5a;
      --accent-hover: #2d5246;
      --accent-soft: #e7f0eb;
      --danger: #c0392b;
      --danger-soft: #f7e4df;
      --ok: #4a7c3e;
      --ok-soft: #eaf0e3;
      --warn: #b07410;
      --warn-soft: #f4eadb;
      --highlight: #3e6b5a;
      --radius: 5px;
      --radius-sm: 3px;
      --mono: "SF Mono", "JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, Consolas, monospace;
      --sans: "Geist", "Inter Tight", "Helvetica Neue", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --display: "Fraunces", "Times New Roman", ui-serif, Georgia, serif;
      /* sticky chrome + outer main padding: header 64 + tabs 51 + main pad 28 + borders */
      --chrome-h: 145px;
    }
    html.dark {
      --bg: #121212;
      --surface: #1a1a1a;
      --ink: #ededeb;
      --muted: #a3a3a0;
      --muted-2: #6b6b68;
      --border: #2a2a28;
      --border-soft: #1e1e1c;
      --accent: #7fb89b;
      --accent-hover: #9ccab0;
      --accent-soft: rgba(127,184,155,0.14);
      --danger: #ef6b55;
      --danger-soft: rgba(239,107,85,0.12);
      --ok: #9cc078;
      --ok-soft: rgba(156,192,120,0.12);
      --warn: #d9a54c;
      --warn-soft: rgba(217,165,76,0.12);
      --highlight: #7fb89b;
    }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: var(--sans); color: var(--ink); background: var(--bg); min-height: 100vh; -webkit-font-smoothing: antialiased; font-feature-settings: "tnum", "ss01"; letter-spacing: -0.005em; }
    button, input, select, textarea { font: inherit; }
    ::selection { background: var(--ink); color: var(--surface); }

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
    .toast { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 10px 10px 16px; font-size: 0.8125rem; box-shadow: 0 4px 12px rgba(0,0,0,0.1); pointer-events: auto; animation: toast-in 200ms ease; display: flex; align-items: flex-start; gap: 10px; max-width: min(420px, calc(100vw - 32px)); }
    .toast-message { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .toast-dismiss { flex: 0 0 auto; border: 0; background: transparent; color: inherit; opacity: 0.65; cursor: pointer; border-radius: 4px; font-size: 0.875rem; line-height: 1; padding: 2px 5px; margin: -2px -2px -2px 0; }
    .toast-dismiss:hover { opacity: 1; background: color-mix(in srgb, var(--ink) 8%, transparent); }
    .toast-dismiss:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .toast.error { border-left: 3px solid var(--danger); color: var(--danger); }
    .toast.ok { border-left: 3px solid var(--ok); }
    .toast.fade-out { animation: toast-out 200ms ease forwards; }
    @keyframes toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; } }
    @keyframes toast-out { to { opacity: 0; transform: translateX(20px); } }

    /* Header — editorial Swiss strip */
    .header { background: var(--surface); border-bottom: none; padding: 0 28px; position: sticky; top: 0; z-index: 10; }
    .header-inner { max-width: none; margin: 0; display: flex; align-items: center; height: 64px; gap: 32px; }
    .logo { display: inline-flex; align-items: center; flex-shrink: 0; font-family: var(--display); line-height: 1; }
    .logo-mark { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.04em; color: var(--ink); text-transform: lowercase; line-height: 1; font-optical-sizing: auto; font-variation-settings: "opsz" 144, "SOFT" 60, "WONK" 1; font-feature-settings: "liga", "dlig", "ss01"; }
    .header-env { display: flex; flex-direction: column; justify-content: center; gap: 3px; min-width: 0; flex-shrink: 0; }
    .header-env label { font-size: 0.75rem; font-weight: 500; color: var(--muted); flex-shrink: 0; letter-spacing: 0.02em; text-transform: uppercase; line-height: 1; cursor: pointer; }
    .header-env label::before { content: none; }
    .header-env select { max-width: 280px; }
    .header-flex-spacer { flex: 1; min-width: 0; }

    .header-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: auto; }
    .header-action-group { position: relative; display: flex; }
    .header-icon-btn { position: relative; background: none; border: 1px solid transparent; border-radius: 0; padding: 5px 8px; cursor: pointer; font-size: 0.875rem; line-height: 1; color: var(--muted); transition: color 120ms, border-color 120ms; }
    .header-icon-btn:hover { background: none; color: var(--ink); border-color: var(--ink); }
    .header-icon-btn.has-error { color: var(--danger); }
    .header-icon-badge { position: absolute; top: 0; right: 0; transform: translate(35%, -25%); min-width: 14px; height: 14px; padding: 0 3px; font-size: 0.5625rem; font-weight: 700; line-height: 14px; text-align: center; color: var(--surface); background: var(--accent); border-radius: 7px; pointer-events: none; }
    .header-icon-btn.has-error .header-icon-badge { background: var(--danger); }
    .header-popover { position: absolute; top: calc(100% + 6px); right: 0; min-width: 240px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: 0 8px 24px rgba(0,0,0,0.18); z-index: 60; overflow: hidden; animation: fadeIn 120ms ease; }
    .header-popover-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .header-popover-action { background: none; border: none; padding: 0; font: inherit; color: var(--accent); cursor: pointer; text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 0.6875rem; }
    .header-popover-action:hover { text-decoration: underline; }
    .toast-tray { width: 320px; }
    .toast-tray-list { max-height: 360px; overflow: auto; }
    .toast-tray-empty { padding: 20px 12px; text-align: center; color: var(--muted); font-size: 0.75rem; }
    .toast-tray-item { display: grid; grid-template-columns: 8px 1fr auto; gap: 8px; align-items: start; padding: 8px 12px; border-bottom: 1px solid var(--border); }
    .toast-tray-item:last-child { border-bottom: none; }
    .toast-tray-dot { width: 6px; height: 6px; margin-top: 6px; border-radius: 50%; background: var(--ok); }
    .toast-tray-item.error .toast-tray-dot { background: var(--danger); }
    .toast-tray-message { font-size: 0.75rem; color: var(--ink); line-height: 1.4; word-break: break-word; }
    .toast-tray-time { font-size: 0.625rem; color: var(--muted); font-family: var(--mono); white-space: nowrap; }
    .header-menu { min-width: 220px; padding: 4px; }
    .header-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: none; background: none; color: var(--ink); font: inherit; text-align: left; border-radius: 4px; cursor: pointer; }
    .header-menu-item:hover { background: var(--bg); }
    .header-menu-item.danger { color: var(--danger); }
    .header-menu-item.danger:hover { background: var(--warn-soft); }

    .env-trigger { display: inline-flex; align-items: baseline; gap: 8px; max-width: 460px; min-width: 140px; padding: 0; font-family: var(--sans); font-size: 0.9375rem; color: var(--ink); background: transparent; border: none; border-radius: 0; cursor: pointer; text-align: left; line-height: 1; letter-spacing: -0.02em; }
    .env-trigger::before { content: none; }
    .env-trigger:hover .env-trigger-alias { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
    .env-trigger:focus-visible { outline: none; }
    .env-trigger:focus-visible .env-trigger-alias { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
    .env-trigger-text { display: inline-flex; align-items: baseline; gap: 6px; flex: 1; min-width: 0; overflow: hidden; }
    .env-trigger-alias { font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.025em; }
    .env-trigger-account { font-size: 0.75rem; color: var(--muted); font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0; }
    .env-trigger-account::before { content: "/"; margin-right: 4px; color: var(--muted-2); font-weight: 300; }
    .env-trigger-placeholder { color: var(--muted-2); font-weight: 400; font-style: normal; }
    .env-trigger-chevron { font-size: 0.5625rem; color: var(--muted-2); flex-shrink: 0; align-self: center; margin-left: 2px; }

    .env-picker-backdrop { align-items: flex-start; padding-top: 88px; }
    .rt-modal.env-picker-modal { width: 560px; max-width: 92vw; max-height: 70vh; padding: 0; }
    .env-picker-search { display: flex; align-items: center; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
    .env-picker-search-icon { color: var(--muted-2); font-size: 0.9375rem; display: inline-flex; }
    .env-picker-search input { flex: 1; border: none; outline: none; background: transparent; font-size: 1rem; font-family: var(--sans); letter-spacing: -0.015em; color: var(--ink); padding: 0; }
    .env-picker-search input::placeholder { color: var(--muted-2); font-weight: 400; }
    .env-picker-count { font-size: 0.625rem; color: var(--muted-2); font-family: var(--sans); font-variant-numeric: tabular-nums; letter-spacing: 0.1em; flex-shrink: 0; }
    .env-picker-list { overflow: auto; padding: 6px 0; flex: 1; min-height: 0; }
    .env-picker-empty { padding: 28px 20px; text-align: center; color: var(--muted-2); font-size: 0.875rem; }
    .env-picker-item { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 4px 16px; width: 100%; padding: 10px 20px; border: none; background: transparent; color: var(--ink); cursor: pointer; text-align: left; transition: background 80ms; position: relative; }
    .env-picker-item.active { background: var(--accent-soft); }
    .env-picker-item-main { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; grid-column: 1 / 2; }
    .env-picker-alias { font-size: 0.9375rem; font-weight: 600; color: var(--ink); letter-spacing: -0.02em; display: inline-flex; align-items: baseline; gap: 8px; }
    .env-picker-item.current .env-picker-alias::after { content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--ok); transform: translateY(-2px); }
    .env-picker-display { font-size: 0.75rem; color: var(--muted-2); font-weight: 400; }
    .env-picker-badge { font-size: 0.5625rem; text-transform: uppercase; letter-spacing: 0.14em; padding: 0; border: none; background: transparent; color: var(--muted-2); font-weight: 500; align-self: baseline; }
    .env-picker-badge.readonly { color: var(--muted-2); }
    .env-picker-item-meta { display: flex; gap: 12px; font-size: 0.6875rem; color: var(--muted-2); font-family: var(--sans); grid-column: 1 / -1; min-width: 0; }
    .env-picker-host { font-family: var(--mono); font-size: 0.625rem; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .env-picker-account { font-family: var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .env-picker-footer { display: flex; gap: 16px; padding: 10px 20px; border-top: 1px solid var(--border); font-size: 0.625rem; color: var(--muted-2); font-family: var(--sans); letter-spacing: 0.08em; text-transform: uppercase; }
    .env-picker-footer kbd { font-family: var(--mono); font-size: 0.625rem; padding: 1px 5px; margin-right: 4px; border: 1px solid var(--border); border-radius: 0; background: transparent; color: var(--muted); letter-spacing: 0; text-transform: none; }

    /* Tabs — numbered Swiss entries */
    .tabs { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 28px; overflow-x: auto; scrollbar-width: none; }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs-inner { max-width: none; min-width: max-content; margin: 0; display: flex; gap: 0; font-family: var(--sans); }
    .tab { padding: 14px 20px 14px 0; margin-right: 12px; font-size: 0.9375rem; font-weight: 500; font-family: var(--sans); color: var(--muted-2); cursor: pointer; border: none; background: none; transition: color 120ms; white-space: nowrap; flex: 0 0 auto; display: inline-flex; align-items: baseline; gap: 10px; letter-spacing: -0.01em; position: relative; line-height: 1; }
    .tab:last-child { margin-right: 0; padding-right: 0; }
    .tab:hover { color: var(--muted); }
    .tab:hover .tab-num { color: var(--highlight); }
    .tab.active { color: var(--ink); font-weight: 700; }
    .tab.active::after { content: ""; position: absolute; left: 0; right: 12px; bottom: -1px; height: 3px; background: var(--accent); }
    .tab:last-child.active::after { right: 0; }
    .tab.active .tab-num { color: var(--highlight); }
    .tab-num { font-family: var(--display); font-style: italic; font-feature-settings: "tnum"; font-size: 0.9375rem; font-weight: 400; color: var(--muted-2); letter-spacing: 0; transform: translateY(-2px); transition: color 120ms; font-optical-sizing: auto; font-variation-settings: "opsz" 60, "SOFT" 100, "WONK" 1; }
    .tab-label { display: inline-block; }
    .tab-sep { width: 0; background: transparent; margin: 0 10px 0 -4px; flex-shrink: 0; align-self: center; height: 14px; border-left: 1px solid var(--border); }

    /* Layout */
    .app-main { max-width: none; margin: 0; padding: 28px; }
    .tab-panel { display: none; }
    .tab-panel.active { display: flex; gap: 20px; }
    .tab-panel.active.stack { flex-direction: column; }

    /* Panels */
    .panel { background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 22px 24px; }
    html.dark .panel { border-color: var(--border); }
    .panel h2 { font-family: var(--sans); font-size: 1.25rem; font-weight: 600; margin-bottom: 8px; letter-spacing: -0.015em; line-height: 1.15; color: var(--ink); }
    .panel .desc { font-family: var(--sans); font-size: 0.875rem; color: var(--muted); margin-bottom: 20px; line-height: 1.5; font-weight: 400; max-width: 62ch; letter-spacing: 0; }

    /* Entity sidebar */
    .entity-sidebar { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; }
    .entity-sidebar .panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .entity-filter { margin-bottom: 8px; }
    .entity-count { font-size: 0.6875rem; color: var(--muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; }
    .entity-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; max-height: calc(100dvh - var(--chrome-h) - 140px); }
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

    /* Buttons — Swiss sharp, weight-contrasted */
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-family: var(--sans); font-size: 0.8125rem; font-weight: 500; border: 1px solid var(--border); border-radius: 0; cursor: pointer; transition: background 120ms, color 120ms, border-color 120ms; white-space: nowrap; background: var(--surface); color: var(--ink); letter-spacing: -0.005em; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { background: var(--ink); color: var(--surface); border-color: var(--ink); font-weight: 600; }
    .btn-primary:hover:not(:disabled) { background: var(--surface); color: var(--ink); border-color: var(--ink); }
    .btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--ink); font-weight: 500; }
    .btn-secondary:hover:not(:disabled) { background: var(--ink); color: var(--surface); }
    .btn-danger { background: none; color: var(--danger); font-size: 0.75rem; padding: 4px 10px; border-color: transparent; font-weight: 500; }
    .btn-danger:hover:not(:disabled) { background: var(--warn-soft); border-color: var(--danger); }
    .btn-ghost { background: none; color: var(--muted); border-color: transparent; font-weight: 400; }
    .btn-ghost:hover:not(:disabled) { background: none; color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
    .btn-sm { font-size: 0.75rem; padding: 4px 10px; }
    .btn-group { display: flex; gap: 8px; flex-wrap: wrap; }
    .spinner { width: 14px; height: 14px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 600ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Selected columns bar */
    .selected-cols { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; padding: 8px 0; min-height: 36px; }
    .selected-cols-label { font-size: 0.6875rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; margin-right: 4px; }
    .col-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent-soft); color: var(--accent); border-radius: 4px; padding: 2px 8px; font-size: 0.6875rem; font-family: var(--mono); font-weight: 500; cursor: pointer; }
    .col-chip:hover { background: var(--accent); color: var(--surface); }
    .col-chip .x { font-weight: 700; }

    /* Entity context bar (for Query/FetchXML tabs) */
    .entity-context { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 16px; }
    .entity-context-name { font-weight: 600; font-size: 0.875rem; }
    .entity-context-set { font-family: var(--mono); font-size: 0.75rem; color: var(--accent); }
    .entity-context-empty { color: var(--muted); font-size: 0.8125rem; font-style: italic; }

    /* Forms */
    form, .form-grid { display: grid; gap: 14px; }
    .form-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .form-row.three { grid-template-columns: repeat(3, 1fr); }
    .field { display: grid; gap: 6px; }
    .field-label { font-size: 0.625rem; font-weight: 500; color: var(--muted-2); text-transform: uppercase; letter-spacing: 0.14em; }
    input, select, textarea { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 0.8125rem; background: var(--surface); color: var(--ink); transition: border-color 150ms, background-color 150ms; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

    /* Custom Select component — drop-in replacement for native <select>.
       Closed trigger inherits input shape; open listbox uses app chrome. */
    .pp-select { position: relative; display: inline-flex; width: 100%; }
    .pp-select-trigger {
      display: inline-flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; padding: 8px 10px; padding-right: 28px;
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--ink);
      font: inherit; font-size: 0.8125rem; text-align: left; cursor: pointer;
      transition: border-color 150ms, background-color 150ms;
    }
    .pp-select-trigger:hover:not(:disabled) { border-color: var(--muted); }
    .pp-select-trigger:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .pp-select-trigger:disabled { opacity: 0.55; cursor: not-allowed; }
    .pp-select.open .pp-select-trigger { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .pp-select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .pp-select-placeholder { color: var(--muted-2); }
    .pp-select-chevron { display: inline-flex; align-items: center; justify-content: center; color: var(--muted); position: absolute; right: 10px; top: 50%; transform: translateY(-50%); transition: transform 120ms, color 120ms; pointer-events: none; }
    .pp-select.open .pp-select-chevron { transform: translateY(-50%) rotate(180deg); color: var(--ink); }

    /* Combobox variant: trigger is an <input>, behaves like Select visually. */
    .pp-combobox-input { width: 100%; font: inherit; font-size: 0.8125rem; text-align: left; cursor: text; }
    .pp-combobox-input:focus { outline: none; }
    .pp-select.pp-combobox .pp-select-chevron { pointer-events: none; }

    .pp-select-menu {
      position: absolute; left: 0; right: 0; z-index: 70;
      margin: 4px 0 0; padding: 4px; list-style: none;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
      box-shadow: 0 10px 28px rgba(0,0,0,0.16);
      max-height: 320px; overflow-y: auto;
      animation: pp-select-in 100ms ease;
    }
    @keyframes pp-select-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
    .pp-select.placement-up .pp-select-menu { top: auto; bottom: 100%; margin: 0 0 4px; }
    .pp-select-option {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 10px; border-radius: 3px; cursor: pointer;
      font-size: 0.8125rem; color: var(--ink); line-height: 1.3;
      transition: background 80ms;
    }
    .pp-select-option.active { background: var(--bg); }
    .pp-select-option.selected { color: var(--ink); }
    .pp-select-option.selected.active { background: var(--accent-soft); }
    .pp-select-option.disabled { color: var(--muted-2); cursor: not-allowed; }
    .pp-select-option-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .pp-select-option-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pp-select-option-description { font-size: 0.6875rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pp-select-option-check { color: var(--accent); display: inline-flex; flex-shrink: 0; }

    /* Console bar variant: flat segment, no radius, dividers */
    .console-bar .pp-select { width: auto; }
    .console-bar .pp-select-trigger { border: none; border-right: 1px solid var(--border); border-radius: 0; background-color: var(--bg); padding: 10px 30px 10px 14px; font-weight: 600; }
    .console-bar .pp-select-trigger:hover:not(:disabled) { border-color: transparent; background-color: color-mix(in srgb, var(--ink) 5%, var(--bg)); }
    .console-bar .pp-select-trigger:focus-visible, .console-bar .pp-select.open .pp-select-trigger { box-shadow: none; background-color: color-mix(in srgb, var(--accent) 6%, var(--bg)); }

    /* Select polish: custom chevron, consistent padding, hover state.
       --chevron: inlined SVG tinted via currentColor replacement in light/dark. */
    select {
      appearance: none; -webkit-appearance: none; -moz-appearance: none;
      padding-right: 28px;
      cursor: pointer;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 7' fill='none' stroke='%236c6c69' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M1 1l5 5 5-5'/></svg>");
      background-repeat: no-repeat;
      background-position: right 10px center;
      background-size: 10px 6px;
    }
    html.dark select {
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 7' fill='none' stroke='%23a3a3a0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M1 1l5 5 5-5'/></svg>");
    }
    select:hover:not(:disabled) { border-color: var(--muted); }
    select:disabled { opacity: 0.55; cursor: not-allowed; }
    /* Tighter chevron for compact/select variants */
    select.console-preset-select,
    .btn-sm select,
    .run-toolbar select,
    .action-toolbar select { background-position: right 8px center; padding-right: 24px; }

    textarea { font-family: var(--mono); font-size: 0.8125rem; line-height: 1.5; resize: vertical; }
    textarea.xml-editor { min-height: 320px; }
    .fetchxml-editor-shell { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--surface); }
    .fetchxml-editor-toolbar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 8px 12px; font-size: 0.6875rem; color: var(--muted); border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 78%, var(--bg)); }
    .fetchxml-editor-toolbar-left,
    .fetchxml-editor-toolbar-right { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
    .monaco-vim-toggle { display: inline-flex; align-items: center; justify-content: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--muted); font-family: var(--mono); font-size: 0.6875rem; cursor: pointer; }
    .monaco-vim-toggle:hover { color: var(--ink); border-color: var(--accent); }
    .monaco-vim-toggle.active { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
    .monaco-vim-toggle.active.insert { color: var(--ok); border-color: var(--ok); background: rgba(34,197,94,0.08); }
    .monaco-vim-toggle.active.visual { color: var(--warn); border-color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, transparent); }
    .monaco-vim-toggle.active.replace { color: var(--danger); border-color: var(--danger); background: var(--danger-soft); }
    .monaco-vim-status-line { display: none; align-items: center; min-height: 24px; padding: 3px 10px; border-bottom: 1px solid var(--border); background: var(--bg); color: var(--muted); font-family: var(--mono); font-size: 0.6875rem; }
    .monaco-vim-status-line.active { display: flex; }
    .monaco-vim-status-node { display: inline-flex; align-items: center; gap: 8px; min-height: 18px; color: var(--muted); font-family: var(--mono); font-size: 0.6875rem; }
    .monaco-vim-status-node input { width: auto; min-width: 160px; padding: 2px 6px; font-family: var(--mono); font-size: 0.6875rem; }
    .fetchxml-editor-mount { min-height: 420px; }
    .fetchxml-editor-mount .monaco-editor,
    .fetchxml-editor-mount .monaco-editor-background,
    .fetchxml-editor-mount .monaco-editor .inputarea.ime-input { background: var(--surface); }
    .fetchxml-editor-mount .monaco-editor { min-height: 420px; }
    .fetchxml-editor-mount .monaco-editor .margin { background: var(--bg); }

    /* Monaco suggestion widget — all CSS overrides removed for debugging. Relying on
       Monaco's own compiled theme from monaco-support.tsx. */
    .suggest-details,
    .suggest-details *,
    .suggest-details .body,
    .suggest-details .header,
    .suggest-details .monaco-tokenized-source,
    .suggest-details .docs { color: var(--ink) !important; background-color: var(--surface); }
    .suggest-details .type { color: var(--muted) !important; }
    .monaco-hover,
    .monaco-hover *,
    .monaco-hover .hover-contents,
    .monaco-hover .markdown-hover { color: var(--ink) !important; background-color: var(--surface); }
    .flow-editor-layout { display: grid; grid-template-columns: minmax(0, var(--outline-width, 320px)) minmax(0, 1fr); align-items: stretch; height: min(720px, calc(100dvh - var(--chrome-h) - 220px)); min-height: 420px; }
    .flow-editor-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .flow-editor-main .fetchxml-editor-mount { flex: 1; height: 100%; min-height: 420px; }
    .flow-editor-main .fetchxml-editor-mount .monaco-editor { height: 100%; min-height: 420px; }
    .flow-outline-rail { position: relative; border-right: 1px solid var(--border); background: var(--bg); min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .flow-outline-resize-handle { position: absolute; right: -6px; top: 0; bottom: 0; width: 12px; cursor: col-resize; z-index: 2; }
    .flow-outline-resize-handle::before { content: ''; position: absolute; left: 5px; top: 50%; transform: translateY(-50%); width: 2px; height: 36px; background: var(--border); border-radius: 1px; transition: background 120ms, height 120ms; }
    .flow-outline-resize-handle:hover::before, .flow-outline-resize-handle:active::before { background: var(--accent); height: 64px; }
    .flow-rail-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 0.6875rem; }
    .flow-rail-header h3 { margin: 0; color: var(--ink); font-size: 0.75rem; }
    .flow-outline-rail .empty { margin: 10px; }
    .flow-outline-scroll { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); max-height: 500px; }
    .flow-outline-rail .flow-outline-scroll { border: 0; border-radius: 0; flex: 1; max-height: none; padding: 4px 0; }
    .flow-outline-filter { padding: 6px 8px; border-bottom: 1px solid var(--border); }
    .flow-outline-filter input { width: 100%; padding: 4px 8px; font-size: 0.75rem; }
    .flow-outline-row { display: flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px; background: transparent; border-radius: 4px; margin: 0 4px; cursor: default; font-size: 12px; line-height: 20px; transition: background 0.1s; }
    .flow-outline-row.selectable,
    .flow-outline-row.has-children { cursor: pointer; }
    .flow-outline-row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
    .flow-outline-row.active { background: var(--accent-soft); }
    .flow-outline-row.not-selectable:not(.has-children):hover { background: transparent; }
    .flow-outline-row.selectable:hover .flow-outline-title { color: var(--accent); }
    .flow-outline-row.not-selectable .flow-outline-dot { opacity: 0.45; }
    .flow-outline-row.not-selectable:not(.has-children) { opacity: 0.78; }
    .flow-outline-row.not-run .flow-outline-title { color: var(--muted); font-weight: 400; }
    .flow-outline-row.dragging { opacity: 0.4; }
    .flow-outline-row.draggable { cursor: grab; }
    .flow-outline-toggle { width: 14px; font-size: 10px; color: var(--muted); flex-shrink: 0; font-family: monospace; user-select: none; text-align: center; cursor: pointer; }
    .flow-outline-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .flow-outline-title { font-weight: 500; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .flow-outline-title.editable { color: var(--accent); text-decoration: none; }
    .flow-outline-type-hint { font-size: 10px; color: var(--muted); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100px; }
    .flow-outline-status-badge { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; min-width: 54px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); font-size: 9px; line-height: 14px; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); background: var(--surface); }
    .flow-outline-status-badge.succeeded { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); background: color-mix(in srgb, var(--ok) 10%, transparent); }
    .flow-outline-status-badge.failed { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); background: color-mix(in srgb, var(--danger) 10%, transparent); }
    .flow-outline-status-badge.skipped { color: var(--muted); border-color: color-mix(in srgb, var(--muted) 35%, var(--border)); background: color-mix(in srgb, var(--muted) 8%, transparent); }
    .flow-outline-status-badge.running { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: color-mix(in srgb, var(--accent) 10%, transparent); }
    .flow-outline-status-badge.not-run { color: var(--muted-2); border-color: var(--border); background: transparent; }
    .flow-outline-problem-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .flow-outline-add-btn { padding: 0 4px; font-size: 11px; line-height: 18px; border: none; background: transparent; color: var(--muted); cursor: pointer; border-radius: 3px; font-weight: 600; flex-shrink: 0; }
    .flow-outline-add-btn:hover { color: var(--accent); background: var(--accent-soft); }
    /* Overflow menu inline with an outline row — smaller trigger, faded until hovered/open. The
       trigger stays in the DOM even when the row isn't hovered so moving the mouse from the
       trigger into the popover can't unmount the menu mid-interaction. */
    .flow-outline-menu { display: inline-flex; flex-shrink: 0; margin-left: auto; }
    .flow-outline-menu .setup-overflow-trigger { width: 22px; height: 20px; font-size: 0.875rem; line-height: 1; opacity: 0; transition: opacity 100ms; }
    .flow-outline-row:hover .flow-outline-menu .setup-overflow-trigger,
    .flow-outline-row:focus-within .flow-outline-menu .setup-overflow-trigger,
    .flow-outline-menu .setup-overflow-trigger[aria-expanded="true"] { opacity: 1; }
    .flow-outline-menu .setup-overflow-menu { min-width: 200px; }
    .flow-outline-drop-line { height: 2px; background: var(--accent); margin: 0 8px; border-radius: 1px; pointer-events: none; }
    .flow-callback-url { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
    .flow-callback-url-copy { min-width: 0; display: grid; gap: 3px; }
    .flow-callback-url-label { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 700; }
    .flow-callback-url-warning { color: var(--muted); font-size: 0.75rem; line-height: 1.4; }
    .flow-callback-url-error { color: var(--danger); font-size: 0.75rem; line-height: 1.4; overflow-wrap: anywhere; }
    .flow-callback-url-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; flex-wrap: wrap; }
    .flow-callback-url-secret { max-width: min(620px, 56vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px 8px; }
    .flow-connections-panel { display: grid; gap: 16px; }
    .flow-connections-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .flow-connections-metrics { margin-bottom: 0; }
    .flow-connections-grid { display: grid; grid-template-columns: minmax(360px, 1.2fr) minmax(320px, 0.8fr); gap: 16px; align-items: start; }
    .flow-connections-section { display: grid; gap: 10px; min-width: 0; }
    .flow-connections-section-title { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .flow-connection-add-card,
    .flow-connection-card,
    .flow-environment-connection-row,
    .flow-action-connection-card { border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); padding: 12px 14px; }
    .flow-connection-add-card { display: grid; grid-template-columns: minmax(180px, 0.7fr) minmax(320px, 1.3fr); gap: 12px; align-items: end; }
    .flow-connection-add-controls,
    .flow-connection-bind-row,
    .flow-connection-repair-row { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(110px, auto) minmax(88px, auto); gap: 8px; align-items: center; }
    .flow-connection-repair-row { grid-template-columns: minmax(140px, 1fr) auto; margin-top: 8px; }
    .flow-connection-card { display: grid; gap: 10px; border-left: 3px solid var(--border); }
    .flow-connection-card.status-ok { border-left-color: var(--ok); }
    .flow-connection-card.status-error { border-left-color: var(--danger); }
    .flow-connection-card.status-warning { border-left-color: var(--warn); }
    .flow-connection-card-main,
    .flow-environment-connection-row { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; min-width: 0; }
    .flow-connection-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
    .flow-connection-title { font-weight: 600; font-size: 0.8125rem; color: var(--ink); min-width: 0; overflow-wrap: anywhere; }
    .flow-connection-status { font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 2px 6px; color: var(--muted); }
    .flow-connection-status.ok { color: var(--ok); border-color: var(--ok); }
    .flow-connection-status.error { color: var(--danger); border-color: var(--danger); }
    .flow-connection-status.warning { color: var(--warn); border-color: var(--warn); }
    .flow-connection-meta,
    .flow-connection-muted,
    .flow-action-connection-note { color: var(--muted); font-size: 0.75rem; line-height: 1.45; overflow-wrap: anywhere; }
    .flow-connection-meta code { font-family: var(--mono); font-size: 0.6875rem; }
    .flow-connection-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .flow-connection-usages { display: flex; flex-wrap: wrap; gap: 6px; }
    .flow-connection-usage { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 2px 6px; background: var(--surface); }
    .flow-connection-issues { display: grid; gap: 8px; }
    .flow-connection-issues.compact { gap: 4px; }
    .flow-connection-issue { font-size: 0.75rem; line-height: 1.45; padding: 8px 10px; border: 1px solid var(--border); border-left-width: 3px; border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); overflow-wrap: anywhere; }
    .flow-connection-issue.error { border-left-color: var(--danger); }
    .flow-connection-issue.warning { border-left-color: var(--warn); }
    .flow-connection-issue.info { border-left-color: var(--muted); color: var(--muted); }
    .flow-connection-issue-code { font-family: var(--mono); color: var(--muted); font-size: 0.625rem; margin-bottom: 3px; }
    .flow-action-connection-card { display: grid; gap: 8px; margin-bottom: 12px; }
    .flow-action-connection-card-title { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .flow-editor-shell-fullscreen { position: fixed; inset: 12px; z-index: 70; display: flex; flex-direction: column; box-shadow: 0 20px 80px rgba(0,0,0,0.35); }
    .flow-editor-shell-fullscreen .flow-editor-layout { flex: 1; height: auto; min-height: 0; }
    .flow-editor-shell-fullscreen .fetchxml-editor-mount,
    .flow-editor-shell-fullscreen .fetchxml-editor-mount .monaco-editor { min-height: 0; height: 100%; }
    .rt-modal.flow-diff-modal { height: min(820px, 88vh); }
    .flow-diff-editor { flex: 1; min-height: 0; }
    .rt-modal.add-action-modal { height: min(760px, 92vh); padding: 0; }
    .add-action-header { padding: 14px 20px; border-bottom: 1px solid var(--border); align-items: center; gap: 16px; }
    .add-action-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .add-action-title h2 { margin: 0; font-size: 0.9375rem; font-weight: 600; }
    .add-action-subtitle { font-size: 0.6875rem; color: var(--muted); }
    .rt-modal-body.add-action-body { padding: 0; display: grid; grid-template-columns: minmax(340px, 440px) minmax(0, 1fr); flex: 1; min-height: 0; overflow: hidden; }
    .add-action-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
    .add-action-picker { border-right: 1px solid var(--border); background: var(--bg); }
    .add-action-picker-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); padding: 0 14px; flex-shrink: 0; background: var(--bg); }
    .add-action-picker-tab { flex: 0 0 auto; background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); font-size: 0.8125rem; font-weight: 500; padding: 10px 14px; cursor: pointer; transition: color 0.15s, border-color 0.15s; }
    .add-action-picker-tab:hover { color: var(--ink); }
    .add-action-picker-tab.active { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
    .add-action-picker-body { display: flex; flex-direction: column; min-height: 0; flex: 1; overflow: hidden; }
    .add-action-picker-body.add-action-picker-builtins { overflow-y: auto; padding: 12px 14px 14px; gap: 12px; }
    .add-action-picker-body.add-action-picker-connectors { overflow: hidden; }
    .add-action-config { background: var(--surface); overflow: auto; padding: 18px 20px; gap: 16px; }
    .add-action-picker-section { padding: 12px 14px 8px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
    .add-action-picker-search-section { padding: 12px 14px 8px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; border-bottom: 1px solid var(--border); }
    .add-action-section-label { font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .add-action-section-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .add-action-section-desc { font-size: 0.6875rem; color: var(--muted); line-height: 1.45; margin-bottom: 2px; }
    .add-action-subgroup { display: flex; flex-direction: column; gap: 5px; padding-top: 2px; }
    .add-action-subgroup-label { display: flex; align-items: baseline; gap: 8px; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink); padding-top: 6px; }
    .add-action-subgroup:first-of-type .add-action-subgroup-label { padding-top: 0; }
    .add-action-subgroup-hint { font-size: 0.625rem; color: var(--muted); font-weight: 400; text-transform: none; letter-spacing: 0; }
    .add-action-template-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .add-action-template { display: flex; flex-direction: column; gap: 2px; text-align: left; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); padding: 8px 10px; cursor: pointer; transition: border-color 0.12s, background 0.12s; }
    .add-action-template:hover { border-color: var(--accent); background: var(--accent-soft); }
    .add-action-template.active { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
    .add-action-template-label { font-weight: 600; font-size: 0.8125rem; }
    .add-action-template-desc { color: var(--muted); font-size: 0.6875rem; line-height: 1.35; }
    .add-action-search { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); transition: border-color 0.12s; }
    .add-action-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
    .add-action-search-icon { color: var(--muted); font-size: 0.875rem; flex-shrink: 0; }
    .add-action-search input { flex: 1; min-width: 0; border: none; background: transparent; padding: 4px 0; font-size: 0.8125rem; color: var(--ink); outline: none; }
    .add-action-searching { color: var(--accent); font-size: 0.625rem; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; text-transform: none; letter-spacing: 0; }
    .add-action-searching::before { content: ''; display: inline-block; width: 10px; height: 10px; border: 1.5px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 600ms linear infinite; }
    .add-action-results { display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0; overflow: auto; padding: 4px 8px 12px; }
    .add-action-results-empty { padding: 24px 12px; text-align: center; color: var(--muted); font-size: 0.75rem; }
    .add-action-operation { display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: start; width: 100%; text-align: left; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--ink); padding: 8px 10px; cursor: pointer; transition: border-color 0.12s, background 0.12s; }
    .add-action-operation:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
    .add-action-operation.active { border-color: var(--accent); background: var(--accent-soft); }
    .add-action-operation-icon { width: 28px; height: 28px; border-radius: 5px; object-fit: contain; flex-shrink: 0; }
    .add-action-operation-icon-placeholder { display: block; background: var(--border); border-radius: 5px; }
    .add-action-operation-text { display: grid; gap: 2px; min-width: 0; }
    .add-action-operation-title { font-weight: 600; font-size: 0.8125rem; line-height: 1.2; display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .add-action-builtin-badge { display: inline-flex; align-items: center; font-size: 0.5625rem; font-weight: 700; padding: 1px 6px; border-radius: 0; background: transparent; color: var(--muted); border: 1px solid var(--border); letter-spacing: 0.1em; text-transform: uppercase; line-height: 1.4; }
    .add-action-operation.active .add-action-builtin-badge { color: var(--accent); border-color: var(--accent); }
    .add-action-operation-meta { color: var(--muted); font-family: var(--mono); font-size: 0.625rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .add-action-operation-desc { color: var(--muted); font-size: 0.6875rem; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .add-action-config-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; flex: 1; padding: 32px 24px; text-align: center; color: var(--muted); }
    .add-action-config-empty-icon { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: var(--muted); border: 1px dashed var(--border); border-radius: 50%; margin-bottom: 6px; }
    .add-action-config-empty-title { font-size: 0.875rem; font-weight: 600; color: var(--ink); }
    .add-action-config-empty-desc { font-size: 0.75rem; line-height: 1.5; max-width: 340px; }
    .add-action-config-header { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .add-action-config-icon { width: 32px; height: 32px; border-radius: 6px; object-fit: contain; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 0.875rem; }
    .add-action-config-icon-placeholder { background: var(--accent-soft); }
    .add-action-config-header-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .add-action-config-title { font-size: 0.875rem; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .add-action-config-meta { color: var(--muted); font-family: var(--mono); font-size: 0.6875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .add-action-config-form { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr); gap: 12px; }
    .add-action-config-form label { display: grid; gap: 4px; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    .add-action-config-form label input,
    .add-action-config-form label select { background: var(--surface); }
    .add-action-config-params { display: grid; gap: 8px; }
    .add-action-note { color: var(--muted); font-size: 0.75rem; line-height: 1.5; padding: 8px 12px; border-left: 2px solid var(--accent-soft); background: color-mix(in srgb, var(--accent) 4%, transparent); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
    .add-action-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--border); background: var(--surface); }
    .add-action-footer-hint { font-size: 0.75rem; color: var(--muted); flex: 1; min-width: 0; }
    .rt-modal.flow-action-edit-modal { height: min(760px, 92vh); padding: 0; }
    .flow-action-edit-header { padding: 14px 20px; border-bottom: 1px solid var(--border); align-items: center; gap: 16px; }
    .rt-modal-body.flow-action-edit-body { display: flex; flex-direction: column; gap: 20px; }
    .flow-action-edit-section { display: grid; gap: 10px; }
    .flow-action-edit-section h3 { margin: 0; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .flow-action-edit-header-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
    .flow-action-edit-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
    .flow-action-edit-title-row h2 { margin: 0; font-size: 0.9375rem; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .flow-action-edit-badge { display: inline-flex; align-items: center; font-size: 0.625rem; font-weight: 500; padding: 2px 8px; border-radius: 0; background: transparent; color: var(--muted); border: 1px solid var(--border); line-height: 1.4; text-transform: uppercase; letter-spacing: 0.12em; }
    .flow-action-edit-badge.mono { font-family: var(--mono); text-transform: none; letter-spacing: 0; font-weight: 500; }
    .flow-action-edit-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); align-items: center; }
    .flow-action-edit-tab { flex: 0 0 auto; background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); font-size: 0.8125rem; font-weight: 500; padding: 8px 14px; cursor: pointer; transition: color 0.15s, border-color 0.15s; }
    .flow-action-edit-tab:hover { color: var(--ink); }
    .flow-action-edit-tab.active { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
    .flow-action-edit-schema-label { margin-left: auto; color: var(--muted); font-size: 0.6875rem; padding: 0 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-family: var(--mono); }
    .flow-action-edit-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--border); background: var(--surface); }
    .flow-action-edit-footer-text { font-size: 0.75rem; color: var(--muted); flex: 1; min-width: 0; }
    /* Name/Type row — plain two-column form, no bordered container. */
    .flow-action-edit-grid { grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr); gap: 12px; }
    .flow-action-edit-grid label,
    .flow-action-value-editor { display: grid; gap: 4px; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    .flow-action-field-list { display: grid; gap: 6px; }
    .flow-action-field-group { display: grid; gap: 6px; }
    .flow-action-field-group-title { color: var(--muted); font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 6px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
    .flow-action-field-divider { border-top: 1px solid var(--border); margin: 6px 0; }
    .flow-action-schema-field { display: grid; grid-template-columns: minmax(200px, 280px) minmax(280px, 1fr); gap: 16px; align-items: start; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; background: var(--bg); transition: border-color 0.15s; }
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
      .flow-outline-rail { border-right: 0; border-bottom: 1px solid var(--border); max-height: 320px; }
      .flow-outline-resize-handle { display: none; }
      .flow-connections-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 900px) {
      .add-action-body { grid-template-columns: 1fr; grid-template-rows: minmax(220px, 40%) 1fr; }
      .add-action-picker { border-right: none; border-bottom: 1px solid var(--border); }
      .flow-connection-add-card { grid-template-columns: 1fr; }
    }
    @media (max-width: 720px) {
      .add-action-config-form { grid-template-columns: 1fr; }
      .add-action-template-row { grid-template-columns: 1fr; }
      .flow-action-edit-grid,
      .flow-action-schema-field { grid-template-columns: 1fr; }
      .flow-connection-add-controls,
      .flow-connection-bind-row { grid-template-columns: 1fr; }
    }
    .fetchxml-diagnostics { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .fetchxml-diagnostic { border: 1px solid var(--border); border-left-width: 3px; border-radius: 8px; padding: 8px 10px; background: var(--bg); }
    .fetchxml-diagnostic.warning { border-left-color: var(--warn); }
    .fetchxml-diagnostic.error { border-left-color: var(--danger); }
    .fetchxml-diagnostic.info { border-left-color: var(--accent); }
    .fetchxml-diagnostic-code { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); }
    .fetchxml-diagnostic-message { font-size: 0.75rem; line-height: 1.4; margin-top: 2px; }
    .fetchxml-status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--ok); vertical-align: middle; margin-right: 6px; }
    .fetchxml-status-dot.warn { background: var(--warn); }
    .fetchxml-status-dot.error { background: var(--danger); }
    .flow-outline { display: flex; flex-direction: column; gap: 6px; }
    .flow-outline-item { border: 1px solid var(--border); border-radius: 8px; background: var(--bg); padding: 8px 10px; }
    .flow-outline-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .flow-outline-kind { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; }
    .flow-outline-name { font-family: var(--mono); font-size: 0.75rem; font-weight: 600; }
    .flow-outline-detail { font-size: 0.6875rem; color: var(--muted); margin-top: 2px; }
    .flow-outline-children { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding-left: 12px; border-left: 1px solid var(--border); }
    .flow-canvas-container { position: relative; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); overflow: hidden; }
    .flow-outline-canvas { width: 100%; height: calc(100dvh - var(--chrome-h) - 180px); min-height: 400px; cursor: grab; display: block; }
    .flow-outline-canvas:active { cursor: grabbing; }
    .flow-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .check-row { display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--muted); }

    /* Custom checkbox appearance — replaces OS-native control across the app. */
    input[type="checkbox"] {
      appearance: none; -webkit-appearance: none;
      flex-shrink: 0; width: 16px; height: 16px; min-width: 16px;
      margin: 0; padding: 0;
      border: 1px solid var(--border); border-radius: 3px;
      background: var(--surface); cursor: pointer;
      position: relative; vertical-align: middle;
      transition: background-color 100ms, border-color 100ms;
    }
    input[type="checkbox"]:hover:not(:disabled) { border-color: var(--muted); }
    input[type="checkbox"]:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    input[type="checkbox"]:disabled { opacity: 0.5; cursor: not-allowed; }
    input[type="checkbox"]::after {
      content: '';
      position: absolute; left: 4px; top: 1px;
      width: 5px; height: 9px;
      border-right: 2px solid var(--surface);
      border-bottom: 2px solid var(--surface);
      transform: rotate(45deg) scale(0);
      transform-origin: center;
      transition: transform 110ms ease;
    }
    input[type="checkbox"]:checked {
      background-color: var(--accent);
      border-color: var(--accent);
    }
    input[type="checkbox"]:checked::after { transform: rotate(45deg) scale(1); }
    input[type="checkbox"]:indeterminate {
      background-color: var(--accent);
      border-color: var(--accent);
    }
    input[type="checkbox"]:indeterminate::after {
      left: 3px; top: 6px; width: 8px; height: 0;
      border-right: none; border-bottom: 2px solid var(--surface);
      transform: none;
    }
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
    .badge { font-size: 0.625rem; font-weight: 500; padding: 2px 8px; border-radius: 0; background: transparent; color: var(--muted); border: 1px solid var(--border); text-transform: uppercase; letter-spacing: 0.1em; }
    .setup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    /* Attribute picker */
    .attr-picker { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); min-height: 40px; max-height: 160px; overflow-y: auto; }
    .attr-chip { display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px; border-radius: 4px; font-size: 0.6875rem; font-family: var(--mono); cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--ink); transition: background 80ms; user-select: none; }
    .attr-chip:hover { border-color: var(--accent); }
    .attr-chip.selected { background: var(--accent); color: var(--surface); border-color: var(--accent); }

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
    .health-item-btn { border: 1px solid var(--border); background: transparent; border-radius: 0; padding: 4px 10px; cursor: pointer; color: var(--ink); font-size: 0.6875rem; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; transition: all 120ms; }
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
    .login-target.active { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
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
    .api-scope-check { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 0; font-size: 0.75rem; font-weight: 500; cursor: pointer; transition: all 120ms; user-select: none; }
    .api-scope-check:hover { border-color: var(--accent); }
    .api-scope-check:has(input:checked) { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
    .api-scope-check input { margin: 0; }
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
    .login-progress-step.active { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
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

    /* Setup status strip (replaces Status sub-tab) */
    .setup-status-strip { display: flex; align-items: center; gap: 12px; padding: 8px 14px; margin-bottom: 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface); font-size: 0.8125rem; flex-wrap: wrap; }
    .setup-status-strip-item { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); }
    .setup-status-strip-item strong { color: var(--ink); font-weight: 600; }
    button.setup-status-strip-item { background: none; border: none; font: inherit; padding: 0; cursor: pointer; color: var(--muted); }
    button.setup-status-strip-item:hover { color: var(--ink); }
    button.setup-status-strip-item.issues { color: var(--muted); }
    button.setup-status-strip-item.issues:hover { color: var(--ink); }
    button.setup-status-strip-item.issues[aria-expanded="true"] { color: var(--ink); }
    .setup-status-strip-spacer { flex: 1; }
    .setup-status-strip-actions { display: flex; gap: 6px; }
    .setup-status-issues { margin: -8px 0 14px; border-radius: var(--radius-sm); background: var(--warn-soft); padding: 10px 14px; display: grid; gap: 6px; animation: slideDown 150ms ease; }

    /* Persistent login drawer */
    .login-drawer { margin-bottom: 14px; }

    /* Setup tools left rail */
    .setup-tools { display: grid; grid-template-columns: 200px 1fr; gap: 16px; }
    .setup-tools-rail { display: flex; flex-direction: column; gap: 2px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); align-self: start; }
    .setup-tools-rail-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 0.8125rem; font-weight: 500; color: var(--muted); border: none; background: none; cursor: pointer; border-radius: var(--radius-sm); text-align: left; transition: background 80ms; }
    .setup-tools-rail-item:hover { background: var(--bg); color: var(--ink); }
    .setup-tools-rail-item.active { background: var(--accent-soft); color: var(--accent); }
    @media (max-width: 700px) {
      .setup-tools { grid-template-columns: 1fr; }
      .setup-tools-rail { flex-direction: row; flex-wrap: wrap; }
    }

    /* Segmented control (Basic / Advanced) */
    .segmented { display: inline-flex; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); margin-bottom: 12px; }
    .segmented-item { padding: 5px 14px; font-size: 0.75rem; font-weight: 500; color: var(--muted); border: none; background: none; cursor: pointer; border-radius: 5px; transition: all 100ms; }
    .segmented-item:hover { color: var(--ink); }
    .segmented-item.active { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,0.06); }

    /* Account card chevron + action zone refinements */
    .account-card-chevron { color: var(--muted); font-size: 0.75rem; transition: transform 150ms; padding: 4px; flex-shrink: 0; }
    .account-card.expanded .account-card-chevron { transform: rotate(90deg); }
    .account-card-toggle { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; padding: 12px 14px; cursor: pointer; background: none; border: none; text-align: left; color: inherit; font: inherit; }
    .account-card-toggle:hover { background: var(--bg); }
    .account-card-head-new { display: flex; align-items: center; gap: 8px; padding-right: 12px; }
    .account-card-head-new .account-card-actions { padding-right: 4px; }

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
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 36px 24px; text-align: center; color: var(--muted); }
    .empty-state-compact { padding: 16px 12px; gap: 4px; }
    .empty-state-icon { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; color: var(--muted); border: 1px dashed var(--border); border-radius: 50%; margin-bottom: 6px; }
    .empty-state-compact .empty-state-icon { width: 28px; height: 28px; font-size: 0.9375rem; margin-bottom: 2px; }
    .empty-state-title { font-family: var(--display); font-style: italic; font-size: 1rem; font-weight: 500; color: var(--ink); letter-spacing: -0.005em; font-optical-sizing: auto; font-variation-settings: "opsz" 48, "SOFT" 60, "WONK" 1; }
    .empty-state-desc { font-size: 0.75rem; line-height: 1.5; max-width: 360px; color: var(--muted); }
    .empty-state-action { margin-top: 8px; }
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
    .btn-danger-text { color: var(--danger); }
    .toolbar-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; }
    .toolbar-row.tight { margin-bottom: 8px; }
    .no-mb { margin-bottom: 0 !important; }

    .inventory-panel { display: flex; flex-direction: column; gap: 8px; }
    .inventory-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .inventory-header h2 { margin: 0; }

    .console-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 320px); gap: 16px; width: 100%; min-height: 0; align-items: start; }
    .console-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .console-rail { position: sticky; top: 64px; min-width: 0; }
    .console-rail-panel { padding: 0; overflow: hidden; }
    .console-rail-tabs { display: flex; border-bottom: 1px solid var(--border); }
    .console-rail-tab { flex: 1; background: none; border: none; padding: 10px 12px; font-size: 0.8125rem; font-weight: 500; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .console-rail-tab:hover { color: var(--ink); }
    .console-rail-tab.active { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
    .console-rail-tab-count { font-size: 0.625rem; padding: 1px 6px; border-radius: 999px; background: var(--bg); color: var(--muted); font-weight: 700; }
    .console-rail-list { display: flex; flex-direction: column; gap: 6px; padding: 10px; max-height: calc(100dvh - var(--chrome-h) - 80px); overflow: auto; }
    .console-toolbar-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .console-toolbar-row h2 { margin: 0; }
    .console-preset-select { max-width: 260px; font-size: 0.8125rem; }
    .console-request-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); }
    .console-request-tab { background: none; border: none; padding: 8px 14px; font-size: 0.8125rem; font-weight: 500; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; display: inline-flex; align-items: center; gap: 6px; }
    .console-request-tab:hover:not(:disabled) { color: var(--ink); }
    .console-request-tab.active { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
    .console-request-tab:disabled { color: color-mix(in srgb, var(--muted) 60%, transparent); cursor: not-allowed; }
    .console-request-tab-count { font-size: 0.625rem; padding: 1px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-weight: 700; }
    .console-request-tab-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
    .console-request-panel { padding: 12px 0 0; min-height: 120px; }
    .console-request-panel textarea { width: 100%; font-family: var(--mono); font-size: 0.8125rem; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); resize: vertical; }
    .console-request-panel .kv-list { gap: 6px; }
    .console-response-panel { display: flex; flex-direction: column; gap: 12px; }
    .console-response-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .console-response-header h2 { margin: 0; display: inline-flex; align-items: center; gap: 8px; }
    .console-response-meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .console-response-headers { border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .console-response-headers-toggle { width: 100%; background: none; border: none; padding: 8px 12px; text-align: left; font-size: 0.75rem; color: var(--muted); cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .console-response-headers-toggle:hover { color: var(--ink); }
    .console-response-headers-body { padding: 0 12px 10px; }
    .console-response-headers-toolbar { display: flex; justify-content: flex-end; margin-bottom: 6px; }
    .console-response-warning { padding: 8px 10px; border: 1px solid var(--warn); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--warn) 8%, var(--surface)); color: var(--warn); font-size: 0.75rem; line-height: 1.4; }
    .console-response-viewer { min-height: 360px; height: 60vh; max-height: 70vh; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--surface); display: flex; flex-direction: column; }
    .console-response-viewer .empty-state { flex: 1; }
    .json-viewer-shell { display: flex; flex-direction: column; min-height: 0; }
    .json-viewer-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 78%, var(--bg)); }
    .json-viewer-mount { flex: 1; min-height: 0; }
    @media (max-width: 1100px) {
      .console-layout { grid-template-columns: 1fr; }
      .console-rail { position: static; }
      .console-rail-list { max-height: 320px; }
    }

    .console-bar { display: flex; gap: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 16px; transition: border-color 200ms; font-family: var(--mono); }
    .console-bar:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .console-bar select { border: none; border-right: 1px solid var(--border); border-radius: 0; padding: 10px 30px 10px 14px; font-weight: 600; font-size: 0.8125rem; background-color: var(--bg); min-width: 0; background-position: right 10px center; }
    .console-bar select:hover:not(:disabled) { background-color: color-mix(in srgb, var(--ink) 5%, var(--bg)); border-color: transparent; }
    .console-bar select:focus { outline: none; box-shadow: none; background-color: color-mix(in srgb, var(--accent) 6%, var(--bg)); }
    .console-bar input { border: none; border-radius: 0; flex: 1; padding: 10px 14px; font-family: var(--mono); font-size: 0.8125rem; min-width: 0; }
    .console-bar input:focus { outline: none; box-shadow: none; }
    .console-bar .btn { border-radius: 0; border: none; border-left: 1px solid var(--border); padding: 10px 20px; font-weight: 600; }
    #console-api { width: 155px; }
    #console-method { width: 90px; font-family: var(--mono); }

    .console-scope-hint { font-size: 0.6875rem; color: var(--muted); margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
    .console-scope-badge { font-size: 0.625rem; font-weight: 500; padding: 2px 8px; border-radius: 0; text-transform: uppercase; letter-spacing: 0.14em; border: 1px solid currentColor; }
    .console-scope-badge.env { background: var(--ink); color: var(--surface); border-color: var(--ink); }
    .console-scope-badge.account { background: transparent; color: var(--ink); border-color: var(--ink); }

    .console-sections { display: grid; gap: 10px; margin-bottom: 16px; }
    .console-sections details { border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .console-sections summary { padding: 10px 14px; cursor: pointer; font-size: 0.8125rem; font-weight: 500; color: var(--muted); user-select: none; }
    .console-sections summary:hover { color: var(--ink); }
    .console-sections .section-body { padding: 0 14px 14px; }

    .kv-list { display: grid; gap: 6px; }
    .kv-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; }
    .kv-row input { padding: 6px 8px; font-size: 0.8125rem; }

    .console-status-badge { display: inline-flex; align-items: center; justify-content: center; padding: 2px 10px; border-radius: 0; font-family: var(--sans); font-variant-numeric: tabular-nums; font-size: 0.75rem; font-weight: 600; background: transparent; color: var(--muted); border: 1px solid var(--border); }
    .console-status-badge.success { background: var(--ok); color: var(--surface); border-color: var(--ok); }
    .console-status-badge.error { background: var(--danger); color: var(--surface); border-color: var(--danger); }
    .console-status-badge.small { font-size: 0.625rem; padding: 1px 6px; }

    /* History */
    .history-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; transition: background 80ms; }
    .history-item:hover { background: var(--bg); }
    .history-item-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .history-item-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .history-method { font-family: var(--mono); font-size: 0.6875rem; font-weight: 700; min-width: 42px; }
    .history-method.get { color: var(--ok); }
    .history-method.post { color: var(--accent); }
    .history-method.put, .history-method.patch { color: var(--warn); }
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
    .flow-state-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 0; font-size: 0.625rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.12em; }
    .flow-state-badge.started { background: var(--ok); color: var(--surface); }
    .flow-state-badge.stopped { background: var(--danger); color: var(--surface); }
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
    .run-item.active { background: var(--accent-soft); border-color: var(--border); }
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
    .run-expanded { border: 1px solid var(--border); border-top: none; border-radius: 0 0 var(--radius-sm) var(--radius-sm); padding: 14px; background: var(--surface); }
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
    .rel-toolbar-check input { margin: 0; }
    .rel-canvas-container { position: relative; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); overflow: hidden; }
    .rel-svg { width: 100%; height: calc(100dvh - var(--chrome-h) - 120px); min-height: 500px; cursor: grab; touch-action: none; }
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

    /* Confirm dialog */
    .confirm-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 90; display: flex; align-items: center; justify-content: center; animation: fadeIn 120ms ease; padding: 20px; }
    .confirm-dialog { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); width: 460px; max-width: 100%; padding: 20px 22px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); animation: slideDown 150ms ease; }
    .confirm-title { font-size: 0.9375rem; font-weight: 600; margin-bottom: 6px; }
    .confirm-body { font-size: 0.8125rem; color: var(--muted); line-height: 1.5; margin-bottom: 16px; }
    .confirm-body strong { color: var(--ink); font-weight: 600; }
    .confirm-typed-prompt { font-size: 0.75rem; color: var(--muted); margin-bottom: 6px; }
    .confirm-typed-prompt code { font-family: var(--mono); color: var(--ink); background: var(--bg); padding: 1px 6px; border-radius: 3px; }
    .confirm-typed-input { width: 100%; padding: 8px 10px; font-family: var(--mono); font-size: 0.8125rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--ink); margin-bottom: 14px; }
    .confirm-typed-input:focus { outline: none; border-color: var(--danger); box-shadow: 0 0 0 2px rgba(220,38,38,0.18); }
    .confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .btn-destructive { background: var(--danger); color: white; border-color: var(--danger); }
    .btn-destructive:hover:not(:disabled) { background: #b91c1c; }

    /* Record detail modal */
    .rt-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 80; display: flex; align-items: center; justify-content: center; animation: fadeIn 120ms ease; }
    /* Base shell — only the properties every modal shares. Sizing is picked by a size-* modifier
       (see below); specific layout overrides should always use the .rt-modal.foo-modal compound
       selector so source order can't silently override them. */
    .rt-modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.2); animation: slideDown 150ms ease; }
    .rt-modal.size-md  { width: 640px;               max-width: 92vw; max-height: 82vh; }
    .rt-modal.size-lg  { width: min(980px, 94vw);   max-width: 94vw; max-height: 88vh; }
    .rt-modal.size-xl  { width: min(1200px, 94vw);  max-width: 94vw; max-height: 92vh; }
    .rt-modal.size-xxl { width: min(1320px, 96vw);  max-width: 96vw; max-height: 92vh; }
    .rt-modal-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 20px; border-bottom: 1px solid var(--border); gap: 12px; }
    .rt-modal-title { font-size: 0.9375rem; font-weight: 600; margin: 0; }
    .rt-modal-id { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); word-break: break-all; }
    .rt-modal-actions { display: flex; gap: 6px; flex-shrink: 0; }
    /* Modal body default: padded for forms. Modals with edge-to-edge layouts (tables, split panes,
       large editors) opt out via the .body-flush modifier, or by defining their own padding in a
       compound .rt-modal-body.foo-body selector. */
    .rt-modal-body { overflow: auto; padding: 18px 20px; flex: 1; min-height: 0; }
    .rt-modal-body.body-flush { padding: 0; }
    .rt-modal-loading { padding: 32px 20px; text-align: center; color: var(--muted); font-size: 0.8125rem; }
    .rt-modal-error { padding: 16px 20px; color: var(--danger); font-size: 0.8125rem; }
    .rt-modal.api-preview-modal { height: min(720px, 90vh); padding: 0; }
    .rt-modal.api-preview-modal .rt-modal-body.body-flush { display: flex; flex-direction: column; }
    .api-preview-req { display: flex; gap: 6px; align-items: center; margin-top: 4px; font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); word-break: break-all; }
    .api-preview-method { font-weight: 700; color: var(--ink); letter-spacing: 0.04em; }
    .api-preview-path { color: var(--muted); }
    .api-preview-tabs { display: flex; gap: 4px; padding: 0 20px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .api-preview-tab { font-size: 0.75rem; padding: 8px 12px; border: none; background: transparent; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .api-preview-tab.active { color: var(--ink); border-bottom-color: var(--accent); }
    .api-preview-tab:hover:not(.active) { color: var(--ink); }
    .api-preview-json { flex: 1; min-height: 0; display: flex; }
    .api-preview-json > * { flex: 1; min-height: 0; }
    .rt-detail-table { width: 100%; border-collapse: collapse; }
    .rt-detail-key { padding: 6px 12px; font-size: 0.6875rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; vertical-align: top; width: 1%; border-bottom: 1px solid var(--border); }
    .rt-detail-value { padding: 6px 12px; font-family: var(--mono); font-size: 0.75rem; word-break: break-all; border-bottom: 1px solid var(--border); }
    .rt-detail-table tr:hover td { background: var(--bg); }
    .rt-detail-edited td { background: var(--accent-soft); }
    .rt-edit-input { width: 100%; font-family: var(--mono); font-size: 0.75rem; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--ink); }
    .rt-edit-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
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
    .empty-cta p { color: var(--muted); font-size: 0.9375rem; margin-bottom: 12px; line-height: 1.5; }

    /* Token expiry */
    .token-expiry { font-size: 0.625rem; color: var(--muted); font-family: var(--mono); margin-left: 4px; }
    .token-expiry.expiring-soon { color: var(--warn); }
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

    /* =========================================================
       Setup: dense table + drawer (accounts, environments)
       ========================================================= */

    .setup-table-panel { padding-top: 18px; }
    .setup-table-toolbar { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
    .setup-table-toolbar h2 { margin: 0; }
    .setup-table-toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .setup-table-filter { padding: 6px 10px; font-size: 0.8125rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); min-width: 240px; }
    .setup-table-filter:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }

    .setup-table-empty { padding: 40px 16px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 12px; border: 1px dashed var(--border); border-radius: var(--radius-sm); }
    .setup-table-empty p { margin: 0; }

    .setup-table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); }
    table.setup-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; table-layout: auto; }
    table.setup-table thead th { position: sticky; top: 0; background: var(--surface); font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border-bottom: 1px solid var(--border); padding: 10px 12px; text-align: left; white-space: nowrap; z-index: 1; }
    table.setup-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
    html.dark table.setup-table tbody td { border-bottom-color: var(--border); }
    table.setup-table tbody tr:last-child td { border-bottom: none; }
    table.setup-table .setup-table-sortable { padding: 0; }
    table.setup-table .setup-table-sortable button { width: 100%; background: none; border: none; padding: 10px 12px; font: inherit; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); text-align: left; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    table.setup-table .setup-table-sortable button:hover { color: var(--ink); }
    table.setup-table .setup-table-sort-arrow { font-size: 0.75rem; color: var(--ink); }
    table.setup-table .setup-table-count { text-align: right; font-variant-numeric: tabular-nums; width: 1%; white-space: nowrap; }
    table.setup-table .setup-table-actions-col { width: 1%; white-space: nowrap; text-align: right; }

    .setup-table-row { cursor: pointer; transition: background 80ms, box-shadow 80ms; }
    .setup-table-row:hover { background: var(--bg); }
    .setup-table-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; background: var(--bg); }
    .setup-table-row.selected { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
    .setup-table-row.selected:hover { background: var(--accent-soft); }
    .setup-row-primary { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
    .setup-row-name { font-weight: 600; color: var(--ink); }
    .setup-row-sub { font-size: 0.6875rem; color: var(--muted); margin-top: 2px; margin-left: 18px; max-width: 40ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .setup-row-muted { color: var(--muted); }
    .setup-row-mono { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }

    .setup-row-actions { display: inline-flex; align-items: center; gap: 4px; justify-content: flex-end; }
    .setup-row-actions .btn { flex-shrink: 0; }

    .setup-row-health-dots { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .setup-health-dot { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); font-family: var(--mono); font-size: 0.625rem; color: var(--muted); cursor: pointer; font-weight: 500; transition: border-color 120ms, color 120ms; }
    .setup-health-dot:hover { color: var(--ink); border-color: var(--ink); }
    .setup-health-dot::before { content: ''; width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .setup-health-dot.ok::before { background: var(--ok); }
    .setup-health-dot.error::before { background: var(--danger); }
    .setup-health-dot.pending::before { background: var(--muted-2); animation: pulse 1.5s ease-in-out infinite; }
    .setup-health-dot.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
    .setup-health-dot.error { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }

    .setup-count-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; padding: 1px 6px; border-radius: 999px; background: var(--bg); color: var(--muted); font-size: 0.6875rem; font-weight: 600; font-variant-numeric: tabular-nums; }

    .badge-readonly { border-color: var(--warn); color: var(--warn); }

    /* Overflow menu */
    .setup-overflow { position: relative; display: inline-flex; }
    .setup-overflow-trigger { background: none; border: 1px solid transparent; border-radius: var(--radius-sm); width: 26px; height: 26px; cursor: pointer; color: var(--muted); font-size: 1rem; line-height: 1; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .setup-overflow-trigger:hover { color: var(--ink); border-color: var(--border); background: var(--bg); }
    .setup-overflow-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .setup-overflow-menu { position: absolute; right: 0; top: calc(100% + 4px); min-width: 180px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 60; padding: 4px; display: flex; flex-direction: column; }
    .setup-overflow-item { background: none; border: none; text-align: left; padding: 8px 12px; font: inherit; font-size: 0.8125rem; color: var(--ink); border-radius: 3px; cursor: pointer; }
    .setup-overflow-item:hover { background: var(--bg); }
    .setup-overflow-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .setup-overflow-item.destructive { color: var(--danger); }
    .setup-overflow-item.destructive:hover { background: var(--danger-soft); }
    .setup-overflow-item:disabled { color: var(--muted-2); cursor: not-allowed; }

    /* Side-by-side split (full table + detail) */
    .setup-table-area { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    .setup-table-area.with-detail { grid-template-columns: minmax(0, 1fr) minmax(0, var(--detail-width, 440px)); gap: 20px; }
    .setup-split-detail { position: relative; min-width: 0; }
    .setup-detail-resize-handle { position: absolute; left: -14px; top: 0; bottom: 0; width: 12px; cursor: col-resize; z-index: 2; }
    .setup-detail-resize-handle::before { content: ''; position: absolute; left: 5px; top: 50%; transform: translateY(-50%); width: 2px; height: 36px; background: var(--border); border-radius: 1px; transition: background 120ms, height 120ms; }
    .setup-detail-resize-handle:hover::before, .setup-detail-resize-handle:active::before { background: var(--accent); height: 64px; }

    @media (max-width: 900px) {
      .setup-table-area.with-detail { grid-template-columns: minmax(0, 1fr); }
      .setup-detail-resize-handle { display: none; }
    }

    /* Detail panel (inline, renders in the right column of setup-split) */
    .setup-detail-panel { border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); display: flex; flex-direction: column; animation: detail-panel-in 140ms ease; }
    @keyframes detail-panel-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .setup-detail-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 20px 12px; border-bottom: 1px solid var(--border); }
    .setup-detail-panel-titles { min-width: 0; flex: 1; }
    .setup-detail-panel-titles h2 { margin: 0 0 2px; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.015em; line-height: 1.15; overflow-wrap: anywhere; }
    .setup-detail-panel-subtitle { font-size: 0.8125rem; color: var(--muted); font-family: var(--sans); overflow-wrap: anywhere; }
    .setup-detail-panel-close { background: none; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 10px; font: inherit; font-size: 0.75rem; color: var(--muted); cursor: pointer; letter-spacing: 0; }
    .setup-detail-panel-close:hover { color: var(--ink); border-color: var(--ink); background: var(--bg); }
    .setup-detail-panel-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .setup-detail-panel-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 22px; }
    .setup-detail-panel-footer { border-top: 1px solid var(--border); padding: 12px 20px; display: flex; justify-content: flex-end; gap: 8px; }

    .drawer-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .drawer-meta-item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .drawer-meta-wide { grid-column: 1 / -1; }
    .drawer-meta-label { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: var(--muted); }
    .drawer-meta-value { font-size: 0.8125rem; color: var(--ink); display: inline-flex; align-items: center; gap: 6px; word-break: break-word; }
    .drawer-meta-mono { font-family: var(--mono); font-size: 0.75rem; }

    .drawer-form { display: flex; flex-direction: column; gap: 12px; }
    .drawer-form .btn-group { margin-top: 6px; }

    .drawer-section { display: flex; flex-direction: column; gap: 10px; padding-top: 16px; border-top: 1px solid var(--border); }
    .drawer-section-tight { padding-top: 0; border-top: none; }
    .drawer-section h3 { margin: 0; font-size: 0.9375rem; font-weight: 600; }
    .drawer-section .desc { margin: 0; font-family: var(--sans); font-size: 0.75rem; color: var(--muted); font-style: normal; }
    .drawer-section-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .drawer-bottom-actions { display: flex; justify-content: flex-end; padding-top: 12px; border-top: 1px solid var(--border); }

    .drawer-definitions { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 0.8125rem; }
    .drawer-definitions > div { display: contents; }
    .drawer-definitions dt { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 700; padding-top: 2px; }
    .drawer-definitions dd { margin: 0; color: var(--ink); word-break: break-word; }

    .drawer-health-list { display: flex; flex-direction: column; gap: 6px; }
    .drawer-health-item { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; background: var(--surface); }
    .drawer-health-item.error { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); background: color-mix(in srgb, var(--danger) 4%, var(--surface)); }
    .drawer-health-head { display: flex; align-items: center; gap: 10px; }
    .drawer-health-label { font-family: var(--mono); font-size: 0.75rem; font-weight: 600; color: var(--ink); min-width: 64px; }
    .drawer-health-summary { flex: 1; font-size: 0.75rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .drawer-health-hint { font-size: 0.75rem; color: var(--ink); background: var(--bg); border-radius: var(--radius-sm); padding: 6px 10px; line-height: 1.4; }

    .drawer-discovery-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
    .drawer-discovery-item { display: flex; flex-direction: column; gap: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; text-align: left; cursor: pointer; font: inherit; color: inherit; }
    .drawer-discovery-item:hover { border-color: var(--accent); background: var(--bg); }
    .drawer-discovery-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
    .drawer-discovery-title { font-size: 0.8125rem; font-weight: 600; color: var(--ink); }
    .drawer-discovery-sub { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Required-field asterisk on drawer forms */
    .field-required { color: var(--danger); margin-left: 2px; font-weight: 700; font-size: 0.75rem; font-family: var(--sans); text-transform: none; letter-spacing: 0; }

    @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }

    .hidden { display: none !important; }

    /* Accessibility helper */
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

    /* Reset semantic buttons used as list items */
    button.entity-item { text-align: left; width: 100%; background: var(--surface); color: var(--ink); font: inherit; cursor: pointer; }
    button.entity-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    button.record-link { background: none; border: none; padding: 0; font: inherit; color: var(--accent); cursor: pointer; text-align: inherit; }
    button.record-link:hover { text-decoration: underline; }
    button.record-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

    /* App loading bar */
    .app-loading-bar { position: fixed; top: 0; left: 0; right: 0; height: 2px; background: transparent; z-index: 200; overflow: hidden; pointer-events: none; }
    .app-loading-bar span { display: block; height: 100%; width: 40%; background: linear-gradient(90deg, transparent, var(--accent), transparent); animation: app-loading-slide 1.1s ease-in-out infinite; }
    @keyframes app-loading-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }

    /* Tooltip helper — use data-tooltip on the element */
    [data-tooltip] { position: relative; }
    [data-tooltip]:hover::after,
    [data-tooltip]:focus-visible::after {
      content: attr(data-tooltip);
      position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
      background: var(--ink); color: var(--surface);
      font-family: var(--sans); font-size: 0.6875rem; font-weight: 400; letter-spacing: 0;
      padding: 5px 9px; border-radius: 3px; max-width: 260px; width: max-content;
      white-space: normal; line-height: 1.4; z-index: 120;
      pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.18);
    }
    [data-tooltip-inline] { display: inline-flex; align-items: center; gap: 4px; }
    .field-tooltip { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: transparent; border: 1px solid var(--muted-2); color: var(--muted); font-size: 9px; font-weight: 700; cursor: help; font-family: var(--sans); font-style: normal; text-transform: none; letter-spacing: 0; margin-left: 6px; }
    .field-tooltip:hover { color: var(--ink); border-color: var(--ink); }

    /* Console — scope banner */
    .console-scope-banner { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .console-scope-banner.account { border-left: 3px solid var(--warn); }
    .console-scope-banner.environment { border-left: 3px solid var(--ok); }
    .console-scope-description { font-size: 0.75rem; color: var(--muted); line-height: 1.45; flex: 1; min-width: 0; }
    .console-scope-description strong { color: var(--ink); font-weight: 600; }

    /* Console — hint line below the request bar */
    .console-bar-hint { font-size: 0.6875rem; color: var(--muted); margin: 6px 0 14px; display: flex; flex-wrap: wrap; gap: 0 4px; align-items: baseline; }
    .console-bar-hint kbd { font-family: var(--mono); font-size: 0.625rem; padding: 1px 5px; border: 1px solid var(--border); border-radius: 3px; color: var(--ink); background: var(--surface); }

    /* Console — duplicate-key / body parse warnings */
    .console-field-warning { font-size: 0.75rem; color: var(--warn); background: color-mix(in srgb, var(--warn) 8%, var(--surface)); border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border)); border-radius: var(--radius-sm); padding: 6px 10px; margin-bottom: 8px; line-height: 1.45; }
    .console-field-warning code { font-family: var(--mono); background: transparent; padding: 0 2px; }
    .console-field-error { font-size: 0.75rem; color: var(--danger); background: var(--danger-soft); border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border)); border-radius: var(--radius-sm); padding: 6px 10px; margin-top: 6px; line-height: 1.45; }
    .kv-row-dupe input:first-of-type { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 6%, var(--surface)); }
    .console-request-tab.has-warning { color: var(--warn); }
    .console-request-tab-warn { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: var(--warn); color: var(--surface); font-size: 0.5625rem; font-weight: 700; margin-left: 2px; }

    /* Console — body editor wrapper (so error sits under textarea) */
    .console-body-editor { display: flex; flex-direction: column; }

    /* Console response — filter row & warning with action */
    .console-response-filter { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .console-response-filter input { flex: 1; padding: 6px 10px; font-family: var(--mono); font-size: 0.75rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); }
    .console-response-filter input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
    .console-response-filter-count { font-size: 0.6875rem; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .console-response-warning { display: flex; align-items: center; gap: 12px; }
    .console-response-warning-text { flex: 1; }
    .console-response-warning .btn { flex-shrink: 0; }

    /* Console — history / saved rail with trigger + action buttons */
    .history-item, .saved-item { display: flex; align-items: stretch; gap: 6px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; transition: background 80ms; }
    .history-item:hover, .saved-item:hover { background: var(--bg); }
    .history-item-trigger { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: none; border: none; padding: 8px 10px; cursor: pointer; text-align: left; font: inherit; color: inherit; }
    .history-item-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .history-item-actions { display: flex; align-items: center; gap: 2px; padding: 4px 6px; flex-shrink: 0; }
    .saved-item-path-hint { font-family: var(--mono); font-size: 0.625rem; color: var(--muted); margin-left: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .saved-item-rename { display: flex; align-items: center; gap: 8px; padding: 6px 10px; flex: 1; }
    .saved-item-rename-input { flex: 1; padding: 3px 6px; font: inherit; font-size: 0.8125rem; border: 1px solid var(--accent); border-radius: 3px; background: var(--surface); color: var(--ink); min-width: 0; }
    .pin-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 3px; }

    /* Error banner (persistent, with actions) */
    .error-banner { border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border)); border-left: 3px solid var(--danger); background: var(--danger-soft); color: var(--ink); border-radius: var(--radius-sm); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .error-banner-header { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--danger); font-size: 0.8125rem; }
    .error-banner-body { font-family: var(--mono); font-size: 0.75rem; line-height: 1.45; color: var(--ink); overflow-wrap: anywhere; }
    .error-banner-actions { display: flex; gap: 8px; align-items: center; }

    /* Shortcut help modal */
    .shortcut-help-backdrop { align-items: flex-start; padding-top: 88px; }
    .rt-modal.shortcut-help-modal { width: 620px; max-width: 92vw; max-height: 82vh; padding: 0; }
    .shortcut-help-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
    .shortcut-help-header h2 { margin: 0; font-size: 1.25rem; }
    .shortcut-help-body { padding: 16px 20px; display: grid; gap: 18px; max-height: 60vh; overflow: auto; }
    .shortcut-help-group h3 { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 6px; }
    .shortcut-help-group dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
    .shortcut-help-row { display: contents; }
    .shortcut-help-row dt { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
    .shortcut-help-row dd { margin: 0; font-size: 0.8125rem; color: var(--ink); line-height: 1.4; }
    .shortcut-help-row kbd { font-family: var(--mono); font-size: 0.6875rem; padding: 2px 6px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 3px; background: var(--surface); color: var(--ink); }
    .shortcut-help-sep { color: var(--muted-2); font-size: 0.6875rem; }

    /* Env picker — recency badge, item layout, copy button */
    .env-picker-item { position: relative; }
    .env-picker-item-select { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 4px 16px; width: 100%; padding: 10px 20px; border: none; background: transparent; color: var(--ink); cursor: pointer; text-align: left; font: inherit; }
    .env-picker-item-select:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .env-picker-item.active .env-picker-item-select { background: var(--accent-soft); }
    .env-picker-item-copy { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); opacity: 0; transition: opacity 100ms; }
    .env-picker-item:hover .env-picker-item-copy, .env-picker-item.active .env-picker-item-copy, .env-picker-item-copy:focus-visible { opacity: 1; }
    .env-picker-badge.recent { color: var(--highlight); border-color: var(--highlight); }

    /* Header menu new items */
    .header-menu-item-icon { display: inline-flex; align-items: center; justify-content: center; width: 14px; }
    .header-menu-item-icon kbd { font-family: var(--mono); font-size: 0.625rem; padding: 0 4px; border: 1px solid var(--border); border-radius: 3px; background: var(--surface); color: var(--ink); }

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
  <div class="app-main">

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
                      <span id="fetch-vim-mode" class="monaco-vim-toggle">Vim Off</span>
                    </div>
                    <div class="fetchxml-editor-toolbar-right">
                      <span>Autocomplete for FetchXML structure, entities, attributes, operators, and join fields.</span>
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
              <p class="desc" style="margin-bottom:0">Inspect the selected flow definition with shared validation, graph diagnostics, and expression-aware completions.</p>
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

  <script type="module" src="${scriptSrc}"></script>
</body>
</html>`;
}
