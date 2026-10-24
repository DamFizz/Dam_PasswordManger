import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';
import { applyPrefsToDocument } from './state/prefs';
import { getPrefs } from './state/prefs-store';
import { boot } from './state/app';
import './state/sync-controller';

applyPrefsToDocument(getPrefs());
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyPrefsToDocument(getPrefs()));

void boot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
