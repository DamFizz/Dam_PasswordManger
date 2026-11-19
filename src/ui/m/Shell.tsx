/**
 * App shell, same structure as the Android app's MainScreen:
 *  - four tabs in a floating glass tab bar: Vault, My Space, Generator, Security;
 *  - top-right glass buttons: search (expands into a field), new, and the profile avatar
 *    (tap: profile sheet with Settings and Lock; press and hold: lock right away);
 *  - screens opened from a tab (item, settings...) push in from the right with a back button.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, KeyRound, Landmark, Lock, Plus, Search, Settings as SettingsIcon, ShieldCheck, User, WandSparkles, X } from 'lucide-react';
import { useT } from '../../i18n';
import { app, back, depthOf, HOME, lock, navigate, openEditor, tabOf, useApp, type Route, type Tab } from '../../state/app';
import { usePrefs } from '../../state/prefs-store';
import { createStore, useStore } from '../../state/store';
import { Modal } from '../components/Modal';
import { cx } from '../cx';
import { LiquidPill } from '../liquid';
import { ITEM_TYPE_ICONS } from '../icons';
import { Chevron, Footnote, GlassButton, GlassIconButton, InsetGroup, ListRow, IconTile } from './kit';
import { VaultTab } from './VaultTab';
import { ItemScreen } from './ItemScreen';
import { EditorScreen } from './EditorScreen';
import { SpaceTab, SpaceAddSheet } from './SpaceTab';
import { SpaceItemScreen } from './SpaceItemScreen';
import { SpaceEditScreen } from './SpaceEditScreen';
import { GeneratorTab } from './GeneratorTab';
import { SecurityTab } from './SecurityTab';
import { SettingsScreen } from './SettingsScreen';
import { OrganizeScreen } from './OrganizeScreen';
import { BackupScreen } from './BackupScreen';
import { SyncScreen } from './SyncScreen';
import type { ItemType } from '../../vault/types';

/** My Space search text (the vault search lives in the app store). */
export const spaceSearch = createStore<{ q: string }>({ q: '' });
export function useSpaceSearch(): string {
  return useStore(spaceSearch, (s) => s.q);
}

function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
}

const TYPES: ItemType[] = ['login', 'note', 'wifi', 'recoveryCodes', 'license', 'custom'];

export function Shell() {
  const t = useT();
  const route = useApp((s) => s.route);
  const editor = useApp((s) => s.editor);
  const [profile, setProfile] = useState(false);
  const [chooseType, setChooseType] = useState(false);
  const [spaceAdd, setSpaceAdd] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const tab = tabOf(route);

  // direction of the last navigation, for push/pop motion
  const prev = useRef<Route>(route);
  const [dir, setDir] = useState<'push' | 'pop' | 'tab'>('tab');
  useEffect(() => {
    const a = prev.current;
    if (a === route) return;
    const d = depthOf(route) - depthOf(a);
    setDir(tabOf(a) && tabOf(route) && d === 0 ? 'tab' : d > 0 ? 'push' : d < 0 ? 'pop' : 'tab');
    prev.current = route;
  }, [route]);

  // Keep the editor mounted briefly after closing so it can slide away.
  const [editorView, setEditorView] = useState<{ key: number; open: boolean } | null>(null);
  useEffect(() => {
    if (editor) {
      setEditorView((v) => ({ key: (v?.key ?? 0) + (v?.open ? 0 : 1), open: true }));
      return;
    }
    setEditorView((v) => (v ? { ...v, open: false } : v));
    const id = window.setTimeout(() => setEditorView(null), 300);
    return () => window.clearTimeout(id);
  }, [editor]);

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
        const r = app.get().route;
        if (r.name !== 'home' && r.name !== 'items' && r.name !== 'space') navigate(HOME);
        setSearchOpen(true);
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      if (isTyping(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'n' && !mod && !e.altKey) {
        e.preventDefault();
        openEditor({ mode: 'new', type: 'login' });
      } else if (e.key === 'Escape' || (e.key === 'ArrowLeft' && e.altKey)) {
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Switching tabs closes and clears the search.
  useEffect(() => {
    setSearchOpen(false);
    app.set({ search: '' });
    spaceSearch.set({ q: '' });
  }, [tab]);

  const screen = <RouteView route={route} />;
  const animClass = dir === 'push' ? 'animate-screen-push' : dir === 'pop' ? 'animate-screen-pop' : 'animate-page';

  return (
    <div className="relative h-full overflow-hidden">
      {tab ? (
        <>
          <TopBar>
            {tab === 'vault' || tab === 'space' ? (
              <SearchMorph
                open={searchOpen}
                onOpenChange={(o) => {
                  setSearchOpen(o);
                  if (!o) {
                    app.set({ search: '' });
                    spaceSearch.set({ q: '' });
                  }
                }}
                space={tab === 'space'}
              >
                <GlassIconButton label={t('a.action_add')} onClick={() => (tab === 'space' ? setSpaceAdd(true) : setChooseType(true))}>
                  <Plus />
                </GlassIconButton>
                <ProfileButton onClick={() => setProfile(true)} />
              </SearchMorph>
            ) : (
              <ProfileButton onClick={() => setProfile(true)} />
            )}
          </TopBar>
          <main key={route.name === 'items' ? `items-${JSON.stringify(route.filter)}` : route.name} className={cx('h-full overflow-y-auto overscroll-contain', animClass)} id="main-scroll">
            <div className="pb-36 pt-[calc(env(safe-area-inset-top)+76px)]">{screen}</div>
          </main>
          <TabBar tab={tab} />
        </>
      ) : (
        <main key={JSON.stringify(route)} className={cx('h-full overflow-y-auto overscroll-contain', animClass)} id="main-scroll">
          {screen}
        </main>
      )}

      {editorView && (
        <div className={cx('absolute inset-0 z-30', editorView.open ? 'animate-screen-push' : 'animate-screen-out')} inert={!editorView.open}>
          <EditorScreen key={editorView.key} />
        </div>
      )}

      <ProfileSheet open={profile} onClose={() => setProfile(false)} />
      <SpaceAddSheet open={spaceAdd} onClose={() => setSpaceAdd(false)} />
      <Modal open={chooseType} onClose={() => setChooseType(false)} title={t('a.item_new_title')} size="sm">
        <InsetGroup className="mb-1">
          {TYPES.map((type, i) => {
            const Icon = ITEM_TYPE_ICONS[type];
            return (
              <div key={type}>
                {i > 0 && <div className="ml-[68px] h-px bg-line" />}
                <ListRow
                  title={t(`a.type_${type}` as never)}
                  leading={<IconTile icon={<Icon className="size-full" />} />}
                  onClick={() => {
                    setChooseType(false);
                    openEditor({ mode: 'new', type });
                  }}
                />
              </div>
            );
          })}
        </InsetGroup>
      </Modal>
    </div>
  );
}

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
    case 'items':
      return <VaultTab />;
    case 'item':
      return <ItemScreen id={route.id} />;
    case 'space':
      return <SpaceTab />;
    case 'spaceItem':
      return <SpaceItemScreen id={route.id} />;
    case 'spaceEdit':
      return <SpaceEditScreen id={route.id} type={route.type} owner={route.owner} />;
    case 'generator':
      return <GeneratorTab />;
    case 'security':
      return <SecurityTab />;
    case 'settings':
      return <SettingsScreen />;
    case 'organize':
      return <OrganizeScreen create={route.create} />;
    case 'backup':
      return <BackupScreen />;
    case 'sync':
      return <SyncScreen />;
  }
}

// ---------------------------------------------------------------- bars

/** Floating top bar: buttons on the right, content dissolves under it (scroll edge effect). */
export function TopBar({ children, left }: { children?: ReactNode; left?: ReactNode }) {
  return (
    <header className="lg-topbar pointer-events-none absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex h-[calc(env(safe-area-inset-top)+68px)] w-full max-w-[1080px] items-end gap-2 px-4 pb-2.5 sm:px-6">
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">{left}</div>
        <div className="pointer-events-auto ml-auto flex min-w-0 flex-1 items-center justify-end gap-2.5">{children}</div>
      </div>
    </header>
  );
}

/** Pushed screens: glass back button on the left, optional actions on the right. */
export function PushedScreen({ children, actions, title }: { children: ReactNode; actions?: ReactNode; title?: string }) {
  const t = useT();
  return (
    <div className="relative min-h-full">
      <TopBar
        left={
          <GlassIconButton label={t('a.back')} onClick={back}>
            <ArrowLeft />
          </GlassIconButton>
        }
      >
        {actions}
      </TopBar>
      <div className="pb-16 pt-[calc(env(safe-area-inset-top)+76px)]">
        {title && <span className="sr-only">{title}</span>}
        {children}
      </div>
    </div>
  );
}

function TabBar({ tab }: { tab: Tab }) {
  const t = useT();
  const items: { id: Tab; label: string; icon: ReactNode; route: Route }[] = [
    { id: 'vault', label: t('a.tab_vault'), icon: <ShieldCheck />, route: HOME },
    { id: 'space', label: t('a.tab_space'), icon: <Landmark />, route: { name: 'space' } },
    { id: 'generator', label: t('a.tab_generator'), icon: <WandSparkles />, route: { name: 'generator' } },
    { id: 'security', label: t('a.tab_security'), icon: <KeyRound />, route: { name: 'security' } },
  ];
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}>
      <nav aria-label={t('nav.main')} className="glass-strong lg-tabbar pointer-events-auto relative grid h-[66px] w-full max-w-[520px] grid-cols-4 rounded-full p-1">
        <LiquidPill group="tab" />
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            aria-current={tab === it.id ? 'page' : undefined}
            data-liquid-active={tab === it.id ? 'tab' : undefined}
            onClick={() => (tab === it.id && it.id === 'vault' ? navigate(HOME) : navigate(it.route))}
            className={cx(
              'lg-tab relative flex flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold transition-colors duration-300 cursor-pointer [&_svg]:size-[22px]',
              tab === it.id ? 'text-accent' : 'text-fg/75',
            )}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** The round search button expands into a field across the top bar and absorbs the other buttons. */
function SearchMorph({ open, onOpenChange, space, children }: { open: boolean; onOpenChange: (o: boolean) => void; space: boolean; children: ReactNode }) {
  const t = useT();
  const vaultQ = useApp((s) => s.search);
  const spaceQ = useSpaceSearch();
  const q = space ? spaceQ : vaultQ;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => input.current?.focus(), 180);
    return () => window.clearTimeout(id);
  }, [open]);
  const set = (v: string) => (space ? spaceSearch.set({ q: v }) : app.set({ search: v }));
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
      <div className={cx('lg-search glass-clear relative flex h-[46px] shrink-0 items-center overflow-hidden rounded-full', open ? 'lg-search-open' : '')}>
        <button
          type="button"
          aria-label={open ? t('a.cancel') : space ? t('a.space_search') : t('a.vault_search')}
          title={space ? t('a.space_search') : t('a.vault_search')}
          onClick={() => onOpenChange(!open)}
          className="flex size-[46px] shrink-0 items-center justify-center text-fg cursor-pointer [&_svg]:size-[22px]"
        >
          <Search />
        </button>
        {open && (
          <>
            <input
              ref={input}
              type="search"
              value={q}
              onChange={(e) => set(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  onOpenChange(false);
                }
              }}
              placeholder={space ? t('a.space_search') : t('a.vault_search')}
              aria-label={space ? t('a.space_search') : t('a.vault_search')}
              autoComplete="off"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent pr-2 text-[17px] text-fg placeholder:text-faint focus:outline-none"
            />
            <button type="button" aria-label={t('a.cancel')} onClick={() => onOpenChange(false)} className="mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-full text-muted cursor-pointer hover:bg-surface-2">
              <X className="size-5" />
            </button>
          </>
        )}
      </div>
      <div className={cx('lg-search-siblings flex items-center gap-2.5', open && 'lg-search-siblings-hidden')} aria-hidden={open || undefined} inert={open}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- profile

export function initialOf(name: string): string | null {
  const c = name.trim()[0];
  return c ? c.toUpperCase() : null;
}

function Avatar({ name, size }: { name: string; size: number }) {
  const initial = initialOf(name);
  return initial ? (
    <span className="font-semibold text-white" style={{ fontSize: size * 0.42 }}>
      {initial}
    </span>
  ) : (
    <User className="text-white" style={{ width: size * 0.5, height: size * 0.5 }} />
  );
}

/** Glass avatar. Tap: profile (Settings, Lock). Press and hold: lock right away. */
function ProfileButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  const { displayName } = usePrefs();
  const timer = useRef(0);
  const held = useRef(false);
  return (
    <button
      type="button"
      aria-label={t('a.profile_title')}
      title={t('a.profile_title')}
      className="glass-tint lg-avatar flex size-[46px] shrink-0 items-center justify-center rounded-full cursor-pointer"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        held.current = false;
        timer.current = window.setTimeout(() => {
          held.current = true;
          lock('manual');
        }, 650);
      }}
      onPointerUp={() => window.clearTimeout(timer.current)}
      onPointerLeave={() => window.clearTimeout(timer.current)}
      onClick={() => {
        if (held.current) return;
        onClick();
      }}
    >
      <Avatar name={displayName} size={46} />
    </button>
  );
}

function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { displayName } = usePrefs();
  const count = useApp((s) => s.items.filter((i) => !i.trashedAt && !i.archivedAt).length);
  return (
    <Modal open={open} onClose={onClose} size="sm" title={<span className="sr-only">{t('a.profile_title')}</span>}>
      <div className="flex flex-col gap-3.5 pb-1">
        <div className="flex items-center gap-3.5 py-1">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent">
            <Avatar name={displayName} size={64} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[24px] font-bold leading-[30px] text-fg">{displayName.trim() || 'MyVault'}</p>
            <p className="text-[13px] text-muted">{displayName.trim() ? t(count === 1 ? 'a.profile_items.one' : 'a.profile_items.other', { 1: count }) : t('a.profile_add_name')}</p>
          </div>
        </div>
        <InsetGroup>
          <ListRow
            title={t('a.settings_title')}
            leading={<IconTile icon={<SettingsIcon className="size-full" />} size={34} />}
            trailing={<Chevron />}
            onClick={() => {
              onClose();
              navigate({ name: 'settings' });
            }}
          />
        </InsetGroup>
        <GlassButton
          block
          icon={<Lock />}
          onClick={() => {
            onClose();
            lock('manual');
          }}
        >
          {t('a.lock_now')}
        </GlassButton>
        <Footnote className="px-2">{t('a.profile_hold_hint')}</Footnote>
      </div>
    </Modal>
  );
}
