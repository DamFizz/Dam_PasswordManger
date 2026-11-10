import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, KeyRound, LockKeyhole, Menu as MenuIcon, Plus, Search, Settings, ShieldCheck, WandSparkles, X } from 'lucide-react';
import { useT } from '../../i18n';
import { app, HOME, lock, navigate, openEditor, useApp, type Route } from '../../state/app';
import { Modal } from '../components/Modal';
import { cx } from '../cx';
import { ItemEditor } from '../items/ItemEditor';
import { ItemsView } from '../views/ItemsView';
import { GeneratorView } from '../views/GeneratorView';
import { SecurityView } from '../views/SecurityView';
import { SyncView } from '../screens/SyncView';
import { SettingsView } from '../views/SettingsView';
import { BackupView } from '../views/BackupView';
import { OrganizeView } from '../views/OrganizeView';
import { Sidebar } from './Sidebar';

/** Pages reached from Settings show a "back to Settings" link. */
const SETTINGS_CHILDREN = new Set<Route['name']>(['sync', 'backup', 'organize']);

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'items':
      return <ItemsView filter={route.filter} />;
    case 'generator':
      return <GeneratorView />;
    case 'security':
      return <SecurityView />;
    case 'sync':
      return <SyncView />;
    case 'settings':
      return <SettingsView />;
    case 'backup':
      return <BackupView />;
    case 'organize':
      return <OrganizeView create={route.create} />;
  }
}

function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
}

export function AppShell() {
  const t = useT();
  const route = useApp((s) => s.route);
  const search = useApp((s) => s.search);
  const editor = useApp((s) => s.editor);
  // Keep the editor mounted briefly after it closes so its sheet can slide away.
  const [editorView, setEditorView] = useState<{ editor: NonNullable<typeof editor>; key: number } | null>(null);
  useEffect(() => {
    if (editor) {
      setEditorView((v) => ({ editor, key: (v?.key ?? 0) + 1 }));
      return;
    }
    const id = window.setTimeout(() => setEditorView(null), 320);
    return () => window.clearTimeout(id);
  }, [editor]);
  const collections = useApp((s) => s.collections);
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  const focusSearch = () => {
    if (window.matchMedia('(min-width: 768px)').matches) searchRef.current?.focus();
    else {
      setMobileSearch(true);
      window.setTimeout(() => mobileSearchRef.current?.focus(), 30);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lock('manual');
        return;
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      if (isTyping(e.target)) {
        if (e.key === 'Escape' && e.target === searchRef.current) {
          app.set({ search: '' });
          searchRef.current?.blur();
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        focusSearch();
      } else if (e.key === 'n' && !mod && !e.altKey) {
        e.preventDefault();
        openEditor({ mode: 'new', type: 'login' });
      } else if (e.key === '?') {
        setHelp(true);
      } else if (e.key === 'Escape') {
        app.set({ selectedId: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Typing in search jumps to the item list.
  const onSearch = (value: string) => {
    app.set({ search: value });
    if (value && app.get().route.name !== 'items') app.set({ route: HOME, selectedId: null });
  };

  const title =
    route.name === 'items'
      ? route.filter.kind === 'favorites'
        ? t('nav.favorites')
        : route.filter.kind === 'section' || route.filter.kind === 'category'
          ? (collections.find((c) => c.id === (route.filter as { id: string }).id)?.name ?? t('nav.all'))
          : t('nav.all')
      : route.name === 'generator'
        ? t('nav.generatorShort')
        : route.name === 'security'
          ? t('nav.securityShort')
          : t('nav.settings');

  const tab = route.name === 'items' ? 'vault' : route.name === 'generator' ? 'generator' : route.name === 'security' ? 'security' : 'settings';

  return (
    <div className="animate-unlock flex h-full overflow-hidden md:gap-3 md:p-3">
      <div className="glass hidden overflow-hidden rounded-[26px] md:flex">
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop: floating glass search capsule */}
        <header className="hidden shrink-0 items-center gap-3 pb-3 md:flex">
          <div className="glass-clear relative h-11 w-full max-w-md rounded-full">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={t('search.placeholder')}
              aria-label={t('search.label')}
              autoComplete="off"
              spellCheck={false}
              className="h-full w-full rounded-full bg-transparent pl-10 pr-16 text-[15px] text-fg placeholder:text-muted focus:outline-none"
            />
            <kbd className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 text-[11px] text-faint lg:inline">Ctrl K</kbd>
          </div>
          <button type="button" aria-label={t('shortcuts.title')} title={t('shortcuts.title')} onClick={() => setHelp(true)} className="glass-clear pressable ml-auto hidden size-11 items-center justify-center rounded-full text-[15px] font-semibold text-fg lg:flex cursor-pointer">
            ?
          </button>
        </header>

        {/* Phone: floating glass buttons instead of a bar */}
        <header className="safe-top shrink-0 md:hidden">
          <div className="flex h-16 items-center gap-2 px-4">
            {mobileSearch ? (
              <>
                <div className="glass-clear relative h-12 flex-1 rounded-full">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input
                    ref={mobileSearchRef}
                    type="search"
                    value={search}
                    onChange={(e) => onSearch(e.target.value)}
                    placeholder={t('search.placeholder')}
                    aria-label={t('search.label')}
                    autoComplete="off"
                    className="h-full w-full rounded-full bg-transparent pl-10 pr-4 text-[16px] text-fg placeholder:text-muted focus:outline-none"
                  />
                </div>
                <GlassButton
                  label={t('action.close')}
                  onClick={() => {
                    setMobileSearch(false);
                    app.set({ search: '' });
                  }}
                >
                  <X className="size-5" />
                </GlassButton>
              </>
            ) : (
              <>
                {tab === 'vault' ? (
                  <GlassButton label={t('nav.menu')} onClick={() => setDrawer(true)}>
                    <MenuIcon className="size-5" />
                  </GlassButton>
                ) : null}
                <span className="min-w-0 flex-1" aria-hidden>
                  <span className="sr-only">{title}</span>
                </span>
                <div className="glass-clear flex h-12 items-center rounded-full px-1">
                  <button type="button" aria-label={t('search.label')} title={t('search.label')} onClick={focusSearch} className="pressable flex size-10 items-center justify-center rounded-full text-fg cursor-pointer">
                    <Search className="size-5" />
                  </button>
                  <button type="button" aria-label={t('action.lockNow')} title={t('action.lockNow')} onClick={() => lock('manual')} className="pressable flex size-10 items-center justify-center rounded-full text-fg cursor-pointer">
                    <LockKeyhole className="size-5" />
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {SETTINGS_CHILDREN.has(route.name) ? (
            <div className="flex h-full flex-col">
              <div className="shrink-0 px-4 pt-2 sm:px-6">
                <button type="button" onClick={() => navigate({ name: 'settings' })} className="glass-clear pressable inline-flex h-10 items-center gap-0.5 rounded-full pl-2 pr-4 text-[15px] font-medium text-fg cursor-pointer">
                  <ChevronLeft className="size-5" />
                  {t('nav.settings')}
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <RouteView route={route} />
              </div>
            </div>
          ) : (
            <div key={route.name} className="animate-page h-full">
              <RouteView route={route} />
            </div>
          )}
        </main>

        {/* Phone: floating glass tab bar + add button */}
        <div className="pointer-events-none fixed inset-x-0 z-30 flex items-end gap-2.5 px-4 md:hidden" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
          <nav aria-label={t('nav.main')} className="glass-strong pointer-events-auto grid h-[64px] flex-1 grid-cols-4 rounded-full p-1">
            <BottomTab icon={<KeyRound className="size-[22px]" />} label={t('nav.vault')} active={tab === 'vault'} onClick={() => navigate(HOME)} />
            <BottomTab icon={<WandSparkles className="size-[22px]" />} label={t('nav.generatorShort')} active={tab === 'generator'} onClick={() => navigate({ name: 'generator' })} />
            <BottomTab icon={<ShieldCheck className="size-[22px]" />} label={t('nav.securityShort')} active={tab === 'security'} onClick={() => navigate({ name: 'security' })} />
            <BottomTab icon={<Settings className="size-[22px]" />} label={t('nav.settings')} active={tab === 'settings'} onClick={() => navigate({ name: 'settings' })} />
          </nav>
          {tab === 'vault' && (
            <button type="button" onClick={() => openEditor({ mode: 'new', type: 'login' })} aria-label={t('item.new')} className="glass-tint pressable pointer-events-auto flex size-[64px] shrink-0 items-center justify-center rounded-full cursor-pointer">
              <Plus className="size-7" />
            </button>
          )}
        </div>
      </div>

      {/* Phone folder drawer */}
      <Modal open={drawer} onClose={() => setDrawer(false)} placement="left" bare className="w-[82vw] max-w-[300px] rounded-[26px]">
        <div className="safe-top h-full">
          <Sidebar variant="drawer" onNavigate={() => setDrawer(false)} />
        </div>
      </Modal>

      {editorView && <ItemEditor key={editorView.key} editor={editorView.editor} open={!!editor} />}
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

function GlassButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="glass-clear pressable flex size-12 shrink-0 items-center justify-center rounded-full text-fg cursor-pointer">
      {children}
    </button>
  );
}

function BottomTab({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'pressable flex flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-semibold transition-colors duration-300 cursor-pointer',
        active ? 'bg-[var(--seg-thumb)] text-accent shadow-[inset_0_1px_0_var(--glass-sheen)]' : 'text-fg/75',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const rows: [string, string][] = [
    ['Ctrl / ⌘ + K', t('shortcuts.search')],
    ['N', t('shortcuts.new')],
    ['Ctrl / ⌘ + Shift + L', t('shortcuts.lock')],
    ['Esc', t('shortcuts.close')],
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title')} size="sm">
      <dl className="divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k + v} className="flex items-center justify-between py-2.5">
            <dt className="text-sm text-muted">{v}</dt>
            <dd>
              <kbd className="rounded border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg">{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
