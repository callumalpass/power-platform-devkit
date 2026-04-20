import { createRoot } from 'react-dom/client';
import { SetupApp } from './SetupApp.js';

const root = createRoot(document.getElementById('app-root')!);
root.render(<SetupApp />);
