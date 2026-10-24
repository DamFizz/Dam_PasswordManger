import { useEffect, useState } from 'react';
import { DatabaseBackup, Download, FileSpreadsheet, FileUp, History, LifeBuoy, TriangleAlert, Upload } from 'lucide-react';
import { formatDate, useT } from '../../i18n';
import { csvToItems, detectCsv, type CsvImportPreview } from '../../lib/csv';
import { randomId } from '../../lib/encoding';
import { getRepo, lock, requireSession, useApp } from '../../state/app';
import { confirmDialog, toast, toastError } from '../../state/ui';
import { verifyMasterPassword, WrongPasswordError } from '../../vault/access';
import { BackupPasswordError, createBackup, inspectBackup, openBackup, restoreMerge, restoreReplace, type OpenedBackup } from '../../vault/backup';
import type { Snapshot } from '../../vault/db';
import type { Collection } from '../../vault/types';
import { Button } from '../components/Button';
import { Checkbox, Segmented } from '../components/Field';
import { PageHeader, SectionCard } from '../components/Misc';
import { PasswordInput } from '../components/Secret';
import { backupFileName, downloadTextFile, readFileAsText } from '../download';

function ExportCard() {
  const t = useT();
  const lastBackupAt = useApp((s) => s.lastBackupAt);
  const [mode, setMode] = useState<'master' | 'separate'>('master');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = mode === 'master' ? !!pw : pw.length >= 10 && pw === pw2;
  return (
    <SectionCard title={t('backup.export')} description={t('backup.exportHelp')}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setBusy(true);
          setError(null);
          try {
            const session = requireSession();
            // Verify the master password so a typo can't produce a backup nobody can open.
            if (mode === 'master') await verifyMasterPassword(session, pw);
            const text = await createBackup(session, pw, __APP_VERSION__);
            downloadTextFile(backupFileName(), text, 'application/json');
            setPw('');
            setPw2('');
            toast(t('backup.exported'));
          } catch (err) {
            setError(err instanceof WrongPasswordError ? t('lock.wrongPassword') : err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Segmented
          label={t('backup.protection')}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setPw('');
            setPw2('');
          }}
          size="sm"
          options={[
            { value: 'master', label: t('backup.useMaster') },
            { value: 'separate', label: t('backup.useSeparate') },
          ]}
        />
        <PasswordInput label={mode === 'master' ? t('lock.masterPassword') : t('backup.backupPassword')} value={pw} onValueChange={setPw} showStrength={mode === 'separate'} autoComplete={mode === 'master' ? 'current-password' : 'new-password'} error={error ?? undefined} />
        {mode === 'separate' && <PasswordInput label={t('onboarding.pw.confirm')} value={pw2} onValueChange={setPw2} autoComplete="new-password" error={pw2 && pw !== pw2 ? t('onboarding.pw.mismatch') : undefined} />}
        <p className="text-xs leading-relaxed text-faint">{mode === 'master' ? t('backup.masterNote') : t('backup.separateNote')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={busy} disabled={!valid} icon={<Download className="size-4" />}>
            {t('backup.download')}
          </Button>
          <span className="text-xs text-faint">{lastBackupAt ? t('backup.last', { date: formatDate(lastBackupAt, true) }) : t('backup.never')}</span>
        </div>
      </form>
    </SectionCard>
  );
}

function RestoreCard() {
  const t = useT();
  const session = useApp((s) => s.session);
  const [file, setFile] = useState<{ name: string; text: string; createdAt: number; version: number } | null>(null);
  const [pw, setPw] = useState('');
  const [masterPw, setMasterPw] = useState('');
  const [opened, setOpened] = useState<OpenedBackup | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sameVault = opened?.header.vaultId === session?.vaultId;

  const reset = () => {
    setFile(null);
    setPw('');
    setMasterPw('');
    setOpened(null);
    setError(null);
  };

  return (
    <SectionCard title={t('backup.restoreTitle')} description={t('backup.restoreHelp')}>
      {!file ? (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line-strong p-6 text-center hover:border-accent/60">
          <Upload className="size-6 text-accent" />
          <span className="text-sm font-medium text-fg">{t('backup.chooseFile')}</span>
          <span className="text-xs text-faint">.myvault</span>
          <input
            type="file"
            accept=".myvault,.json,application/json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setError(null);
              try {
                const text = await readFileAsText(f);
                const info = inspectBackup(text);
                setFile({ name: f.name, text, createdAt: info.createdAt, version: info.version });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
            <p className="font-medium text-fg">{file.name}</p>
            <p className="mt-0.5 text-muted">{t('backup.fileInfo', { date: formatDate(file.createdAt, true), version: file.version })}</p>
          </div>
          {!opened ? (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  setOpened(await openBackup(file.text, pw));
                  setMasterPw(pw);
                } catch (err) {
                  setError(err instanceof BackupPasswordError ? t('backup.wrongPassword') : err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <PasswordInput label={t('backup.backupPassword')} value={pw} onValueChange={setPw} autoFocus help={t('backup.backupPasswordHelp')} />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={reset}>
                  {t('action.cancel')}
                </Button>
                <Button type="submit" variant="primary" loading={busy} disabled={!pw}>
                  {t('backup.open')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-success">{t('backup.valid', { n: opened.records.length })}</p>
              <Segmented
                label={t('backup.mode')}
                value={mode}
                onChange={setMode}
                size="sm"
                options={[
                  { value: 'merge', label: t('backup.merge') },
                  { value: 'replace', label: t('backup.replace') },
                ]}
              />
              <p className="text-sm text-muted">{mode === 'merge' ? t('backup.mergeHelp') : t('backup.replaceHelp')}</p>
              {mode === 'merge' && (
                <PasswordInput label={t('backup.backupMaster')} value={masterPw} onValueChange={setMasterPw} help={sameVault ? t('backup.sameVault') : t('backup.otherVault')} />
              )}
              {error && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={reset}>
                  {t('action.cancel')}
                </Button>
                <Button
                  variant={mode === 'replace' ? 'danger' : 'primary'}
                  loading={busy}
                  disabled={mode === 'merge' && !masterPw}
                  onClick={async () => {
                    setError(null);
                    if (mode === 'replace') {
                      const ok = await confirmDialog({ title: t('backup.replaceConfirmTitle'), message: t('backup.replaceConfirm'), confirmLabel: t('backup.replace'), danger: true, acknowledge: t('backup.replaceAck') });
                      if (!ok) return;
                      setBusy(true);
                      try {
                        await restoreReplace(getRepo(), opened);
                        reset();
                        lock('restore');
                        toast(t('backup.restoredUnlock'), { kind: 'info', duration: 7000 });
                      } catch (err) {
                        toastError(err);
                      } finally {
                        setBusy(false);
                      }
                      return;
                    }
                    setBusy(true);
                    try {
                      await getRepo().createSnapshot('before-merge', randomId());
                      const r = await restoreMerge(requireSession(), opened, masterPw);
                      toast(t('backup.merged', { added: r.added, copies: r.copies, skipped: r.skipped }), { duration: 7000 });
                      reset();
                    } catch (err) {
                      setError(err instanceof WrongPasswordError ? t('backup.wrongMaster') : err instanceof Error ? err.message : String(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {mode === 'merge' ? t('backup.mergeNow') : t('backup.replaceNow')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && !file && <p className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    </SectionCard>
  );
}

function CsvImportCard() {
  const t = useT();
  const collections = useApp((s) => s.collections);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  return (
    <SectionCard title={t('csv.title')} description={t('csv.help')}>
      <div className="mb-4 flex gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-fg">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
        <p>{t('csv.warning')}</p>
      </div>
      {done !== null ? (
        <div className="space-y-3">
          <p className="text-sm text-success">{t('csv.done', { n: done })}</p>
          <p className="text-sm text-fg">{t('csv.deleteFile', { file: fileName })}</p>
          <Button size="sm" onClick={() => { setDone(null); setPreview(null); setFileName(''); }}>
            {t('action.done')}
          </Button>
        </div>
      ) : !preview ? (
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface-2 p-4 hover:border-accent/50">
          <FileSpreadsheet className="size-5 text-accent" />
          <span className="text-sm font-medium text-fg">{t('csv.choose')}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setError(null);
              try {
                const text = await readFileAsText(f, 20 * 1024 * 1024);
                setPreview(detectCsv(text));
                setFileName(f.name);
                setAck(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
            <p className="font-medium text-fg">{fileName}</p>
            <p className="mt-0.5 text-muted">{t('csv.detected', { format: preview.detectedFormat, n: preview.rows.length })}</p>
            <p className="mt-1 text-xs text-faint">
              {t('csv.columns')}: {Object.keys(preview.mapping).join(', ')}
            </p>
          </div>
          <Checkbox checked={ack} onChange={setAck} label={t('csv.ack')} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!ack}
              loading={busy}
              icon={<FileUp className="size-4" />}
              onClick={async () => {
                setBusy(true);
                try {
                  const session = requireSession();
                  const now = Date.now();
                  const existing = new Map(collections.filter((c) => c.kind === 'section').map((c) => [c.name.toLowerCase(), c.id]));
                  const created: Collection[] = [];
                  const folderId = (name: string) => {
                    const key = name.toLowerCase();
                    let id = existing.get(key);
                    if (!id) {
                      id = randomId();
                      existing.set(key, id);
                      created.push({ id, kind: 'section', name: name.slice(0, 60), icon: 'folder', color: '#64748b', parentId: null, pinned: false, order: 100 + created.length, createdAt: now, updatedAt: now });
                    }
                    return id;
                  };
                  const { items } = csvToItems(preview, folderId, now);
                  if (created.length) await session.saveCollections(created);
                  await session.saveItems(items);
                  setDone(items.length);
                  setPreview(null);
                } catch (err) {
                  toastError(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('csv.import', { n: preview.rows.length })}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    </SectionCard>
  );
}

function SnapshotsCard() {
  const t = useT();
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const load = () => void getRepo().listSnapshots().then(setSnaps);
  useEffect(load, []);
  const reasons: Record<string, string> = {
    'before-restore': t('snapshot.beforeRestore'),
    'before-merge': t('snapshot.beforeMerge'),
    'before-cloud-download': t('snapshot.beforeCloud'),
  };
  return (
    <SectionCard title={t('snapshot.title')} description={t('snapshot.help')}>
      {snaps.length === 0 ? (
        <p className="text-sm text-faint">{t('snapshot.none')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {snaps.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
              <History className="size-4 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{reasons[s.reason] ?? s.reason}</p>
                <p className="text-xs text-faint">{t('snapshot.info', { date: formatDate(s.createdAt, true), n: s.records.length })}</p>
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  const ok = await confirmDialog({ title: t('snapshot.restore'), message: t('snapshot.restoreConfirm'), confirmLabel: t('snapshot.restore'), danger: true });
                  if (!ok) return;
                  await restoreReplace(getRepo(), { createdAt: s.createdAt, appVersion: '', version: 1, header: s.header, records: s.records });
                  lock('restore');
                  toast(t('backup.restoredUnlock'), { kind: 'info', duration: 7000 });
                }}
              >
                {t('snapshot.restore')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await getRepo().deleteSnapshot(s.id);
                  load();
                }}
              >
                {t('action.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function BackupView() {
  const t = useT();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        <PageHeader title={t('backup.title')} subtitle={t('backup.subtitle')} icon={<DatabaseBackup className="size-5" />} />
        <div className="space-y-4">
          <ExportCard />
          <RestoreCard />
          <CsvImportCard />
          <SnapshotsCard />
          <SectionCard title={t('guide.title')}>
            <div className="flex gap-3">
              <LifeBuoy className="mt-0.5 size-5 shrink-0 text-accent" />
              <ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-muted">
                <li>{t('guide.1')}</li>
                <li>{t('guide.2')}</li>
                <li>{t('guide.3')}</li>
                <li>{t('guide.4')}</li>
                <li>{t('guide.5')}</li>
                <li className="text-fg">{t('guide.6')}</li>
              </ol>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
