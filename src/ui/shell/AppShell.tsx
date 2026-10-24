import { useEffect, useRef, useState } from 'react';
import { Command, Home, Layers, LockKeyhole, Menu as MenuIcon, Plus, Search, ShieldCheck, WandSparkles, X } from 'lucide-react';
import { useT } from '../../i18n';
import { app, lock, navigate, openEditor, useApp, type Route } from '../../state/app';
import { IconButton } from '../components/Button';
import { Modal } from '../components/Modal';
import { cx } from '../cx';
import { ItemEditor } from '../items/ItemEditor';
import { NewItemMenu, NewItemPicker } from '../items/NewItemMenu';
import { DashboardView } from '../views/DashboardView';
import { ItemsView } from '../views/ItemsView';
import { GeneratorView } from '../views/GeneratorView';
import { SecurityView } from '../views/SecurityView';
import { SyncView } from '../screens/SyncView';
import { SettingsView } from '../views/SettingsView';
import { BackupView } from '../views/BackupView';
import { OrganizeView } from '../views/OrganizeView';
import { Sidebar } from './Sidebar';
import { SyncPill } from './SyncPill';
import { BackupReminder } from './BackupReminder';

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'dashboard':
      return <DashboardView />;
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
  const [drawer, setDrawer] = useState(false);
  const [picker, setPicker] = useState(false);
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
        setPicker(true);
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
    const r = app.get().route;
    if (value && r.name !== 'items') app.set({ route: { name: 'items', filter: { kind: 'all' } }, selectedId: null });
  };

  return (
    <div className="flex h-full overflow-hidden bg-bg">
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar */}
        <header className="hidden h-16 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-6 backdrop-blur md:flex">
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={t('search.placeholder')}
              aria-label={t('search.label')}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-xl border border-line bg-surface pl-10 pr-20 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-faint lg:inline-flex">
              <Command className="size-3" />K
            </kbd>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SyncPill className="hidden lg:flex" />
            <IconButton label={t('shortcuts.title')} onClick={() => setHelp(true)} className="hidden lg:inline-flex">
              <span className="text-sm font-semibold">?</span>
            </IconButton>
            <NewItemMenu />
          </div>
        </header>

        {/* Mobile header */}
        <header className="safe-top flex shrink-0 items-center gap-2 border-b border-line bg-bg/90 px-3 backdrop-blur md:hidden">
          <div className="flex h-14 w-full items-center gap-2">
            {mobileSearch ? (
              <>
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                  <input
                    ref={mobileSearchRef}
                    type="search"
                    value={search}
                    onChange={(e) => onSearch(e.target.value)}
                    placeholder={t('search.placeholder')}
                    aria-label={t('search.label')}
                    autoComplete="off"
                    className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-[16px] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
                  />
                </div>
                <IconButton
                  label={t('action.close')}
                  onClick={() => {
                    setMobileSearch(false);
                    app.set({ search: '' });
                  }}
                >
                  <X className="size-5" />
                </IconButton>
              </>
            ) : (
              <>
                <IconButton label={t('nav.menu')} onClick={() => setDrawer(true)}>
                  <MenuIcon className="size-5" />
                </IconButton>
                <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold">MyVault</h1>
                <IconButton label={t('search.label')} onClick={focusSearch}>
                  <Search className="size-5" />
                </IconButton>
                <SyncPill compact />
                <IconButton label={t('action.lockNow')} onClick={() => lock('manual')} tone="accent">
                  <LockKeyhole className="size-5" />
                </IconButton>
              </>
            )}
          </div>
        </header>

        <BackupReminder />

        <main className="relative min-h-0 flex-1 overflow-hidden">
          <RouteView route={route} />
        </main>

        {/* Mobile bottom navigation */}
        <nav aria-label={t('nav.main')} className="safe-bottom shrink-0 border-t border-line bg-surface/95 backdrop-blur md:hidden">
          <div className="grid h-16 grid-cols-5">
            <BottomTab icon={<Home className="size-[22px]" />} label={t('nav.home')} active={route.name === 'dashboard'} onClick={() => navigate({ name: 'dashboard' })} />
            <BottomTab icon={<Layers className="size-[22px]" />} label={t('nav.vault')} active={route.name === 'items'} onClick={() => navigate({ name: 'items', filter: { kind: 'all' } })} />
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => setPicker(true)}
                aria-label={t('item.new')}
                className="bg-accent-gradient flex size-14 -translate-y-4 items-center justify-center rounded-2xl text-on-accent shadow-strong ring-4 ring-bg transition-transform active:scale-95 cursor-pointer"
              >
                <Plus className="size-7" />
              </button>
            </div>
            <BottomTab icon={<WandSparkles className="size-[22px]" />} label={t('nav.generatorShort')} active={route.name === 'generator'} onClick={() => navigate({ name: 'generator' })} />
            <BottomTab icon={<ShieldCheck className="size-[22px]" />} label={t('nav.securityShort')} active={route.name === 'security'} onClick={() => navigate({ name: 'security' })} />
          </div>
        </nav>
      </div>

      {/* Mobile drawer */}
      <Modal open={drawer} onClose={() => setDrawer(false)} placement="left" bare className="safe-top w-[86vw] max-w-[320px] rounded-r-3xl border-l-0">
        <Sidebar variant="drawer" onNavigate={() => setDrawer(false)} />
      </Modal>

      <NewItemPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(type) => {
          setPicker(false);
          openEditor({ mode: 'new', type });
        }}
      />
      {editor && <ItemEditor editor={editor} />}
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

function BottomTab({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={cx('flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium cursor-pointer', active ? 'text-accent' : 'text-faint')}>
      {icon}
      {label}
    </button>
  );
}

function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const rows: [string, string][] = [
    ['Ctrl / ⌘ + K', t('shortcuts.search')],
    ['/', t('shortcuts.search')],
    ['N', t('shortcuts.new')],
    ['Ctrl / ⌘ + Shift + L', t('shortcuts.lock')],
    ['Esc', t('shortcuts.close')],
    ['?', t('shortcuts.help')],
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title')} size="sm">
      <dl className="divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k + v} className="flex items-center justify-between py-2.5">
            <dt className="text-sm text-muted">{v}</dt>
            <dd>
              <kbd className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg">{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
