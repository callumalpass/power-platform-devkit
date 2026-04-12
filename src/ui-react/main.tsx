import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

let container = document.getElementById('app-root');
if (!container) {
  document.body.replaceChildren();
  container = document.createElement('div');
  container.id = 'app-root';
  document.body.appendChild(container);
} else {
  document.getElementById('legacy-shell')?.remove();
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
