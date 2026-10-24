import { applyPrefsToDocument, loadPrefs, savePrefs, type Prefs } from './prefs';
import { createStore, useStore } from './store';

export const prefsStore = createStore<{ prefs: Prefs }>({ prefs: loadPrefs() });

export function getPrefs(): Prefs {
  return prefsStore.get().prefs;
}

export function setPrefs(patch: Partial<Prefs>): void {
  const prefs = { ...getPrefs(), ...patch };
  prefsStore.set({ prefs });
  savePrefs(prefs);
  applyPrefsToDocument(prefs);
}

export function usePrefs(): Prefs {
  return useStore(prefsStore, (s) => s.prefs);
}
