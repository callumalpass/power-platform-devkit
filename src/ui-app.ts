import { UI_CSS } from './ui-style.js';

type AppMode = 'desktop' | 'setup';

export function renderHtml(options: { scriptSrc?: string; appMode?: AppMode; setupToken?: string; title?: string } = {}): string {
  const scriptSrc = options.scriptSrc ?? '/assets/ui/app.js';
  const title = options.title ?? 'pp';
  const boot = {
    mode: options.appMode ?? 'desktop',
    setupToken: options.setupToken
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgMjU2IDI1NiIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsbGVkYnk9InRpdGxlIGRlc2MiPgogIDx0aXRsZSBpZD0idGl0bGUiPnBwIGljb248L3RpdGxlPgogIDxkZXNjIGlkPSJkZXNjIj5Qb3dlciBQbGF0Zm9ybSBDTEkgbW9ub2dyYW0uPC9kZXNjPgogIDxyZWN0IHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiByeD0iNTIiIGZpbGw9IiMxYTFhMTkiLz4KICA8cGF0aAogICAgZmlsbD0iI2Y2ZjZmNSIKICAgIGQ9Im0gMzguMjAwMDY0LDEyNC42IGMgMi45LC0yLjggNS45LC01LjIgOC45LC03LjMgbCAtMjcuOCwxMDAuNyBjIC0xLjMsNC44IC0yLjQsNi40IC04LjcsOC4yIC0yLjk5OTk5OTksMS42IC00LjE5OTk5OTksMyAtNC4xOTk5OTk5LDUgMCwyLjYgMS43LDQuMiA0LjU5OTk5OTksNC4yIGwgNDUuOSwtMC44IGMgMy4zLDAgNS41LC0xLjkgNS41LC00LjkgMCwtMS44IC0xLjEsLTMuMSAtMy44LC0zLjggbCAtNi4yLC0xLjEgYyAtNC4yLC0wLjggLTQuNCwtMy42IC0zLC04LjkgbCA4LjIsLTMwLjYgYyA0LjUsMi42IDEwLjMsNC4yIDE3LjUsNC4yIDI0LjYsMC4xIDQ2LjQ5OTk5NiwtMTkuMyA0OC41OTk5OTYsLTUwLjggMS45LC0yNC44IC0xMS42LC00MS43IC0zNy4yOTk5OTYsLTQxLjkgLTEuOCwwIC0zLjUsMC4xIC01LjIsMC4xIGwgMS4yLC00LjcgYyAyLC03LjcgMC41LC0xMS43IC00LjgsLTExLjcgLTUuOSwwIC0yMyw5IC0yNSwxNi43IGwgLTIsNy40IGMgLTYuMywzLjMgLTExLjcsNy40IC0xNi4yLDEyLjEgLTIuOSwyLjkgLTQsNi41IC0yLjIsOC40IDEuNCwxLjUgMy44LDEuNCA2LC0wLjUgeiBtIDI5LjMsNTQuMiBjIC0yLjksLTAuMSAtNS40LC0wLjggLTcuNiwtMi4zIGwgMTguNiwtNjkuNiBjIDAuNCwwIDAuOCwwIDEuMywwIDkuNiwwLjIgMTYsOSAxMywzMC40IC0zLjEsMjYuMiAtMTMuOCw0MS42IC0yNS4zLDQxLjUgeiBNIDE0MC40LDEyNC42IGMgMi45LC0yLjggNS45LC01LjIgOC45LC03LjMgTCAxMjEuNSwyMTggYyAtMS4zLDQuOCAtMi40LDYuNCAtOC43LDguMiAtMywxLjYgLTQuMiwzIC00LjIsNSAwLDIuNiAxLjcsNC4yIDQuNiw0LjIgbCA0NS45LC0wLjggYyAzLjMsMCA1LjUsLTEuOSA1LjUsLTQuOSAwLC0xLjggLTEuMSwtMy4xIC0zLjgsLTMuOCBsIC02LjIsLTEuMSBjIC00LjIsLTAuOCAtNC40LC0zLjYgLTMsLTguOSBsIDguMiwtMzAuNiBjIDQuNSwyLjYgMTAuMyw0LjIgMTcuNSw0LjIgMjQuNiwwLjEgNDYuNSwtMTkuMyA0OC42LC01MC44IDEuOSwtMjQuOCAtMTEuNiwtNDEuNyAtMzcuMywtNDEuOSAtMS44LDAgLTMuNSwwLjEgLTUuMiwwLjEgbCAxLjIsLTQuNyBjIDIsLTcuNyAwLjUsLTExLjcgLTQuOCwtMTEuNyAtNS45LDAgLTIzLDkgLTI1LDE2LjcgbCAtMiw3LjQgYyAtNi4zLDMuMyAtMTEuNyw3LjQgLTE2LjIsMTIuMSAtMi45LDIuOSAtNCw2LjUgLTIuMiw4LjQgMS40LDEuNSAzLjgsMS40IDYsLTAuNSB6IG0gMjkuMyw1NC4yIGMgLTIuOSwtMC4xIC01LjQsLTAuOCAtNy42LC0yLjMgbCAxOC42LC02OS42IGMgMC40LDAgMC44LDAgMS4zLDAgOS42LDAuMiAxNiw5IDEzLDMwLjQgLTMuMSwyNi4yIC0xMy44LDQxLjYgLTI1LjMsNDEuNSB6IgogIC8+Cjwvc3ZnPgo=">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Geist:wght@100..900&display=swap" rel="stylesheet">
  <title>${escapeHtml(title)}</title>
  <style>${UI_CSS}</style>
</head>
<body>
  <div id="app-root"></div>
  <script>window.ppApp=${JSON.stringify(boot)};</script>
  <script type="module" src="${escapeAttribute(scriptSrc)}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}
