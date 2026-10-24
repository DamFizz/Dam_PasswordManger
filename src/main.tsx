import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';
import { InsecureContext, isSecureEnough } from './ui/screens/InsecureContext';
import { applyPrefsToDocument } from './state/prefs';
import { getPrefs } from './state/prefs-store';
import { boot } from './state/app';
import './state/sync-controller';

applyPrefsToDocument(getPrefs());
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyPrefsToDocument(getPrefs()));

const secure = isSecureEnough();
if (secure) void boot();

createRoot(document.getElementById('root')!).render(<StrictMode>{secure ? <App /> : <InsecureContext />}</StrictMode>);
