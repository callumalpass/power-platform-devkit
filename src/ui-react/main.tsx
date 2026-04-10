import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

let container = document.getElementById('app-root');
if (!container) {
  container = document.createElement('div');
  container.id = 'app-root';
  document.body.appendChild(container);
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
