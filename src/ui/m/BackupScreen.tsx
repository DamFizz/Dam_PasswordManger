/**
 * Backup & restore (Android BackupScreens): export an encrypted backup, restore by merging or
 * replacing, safety snapshots, and CSV import from other password managers.
 */
import { useEffect, useState } from 'react';
import { BadgeCheck, Download, FileUp, FolderOpen, GitMerge, History, Sheet, Trash2, Repeat } from 'lucide-react';
import { formatDate, useT } from '../../i18n';
import { csvToItems, detectCsv, type CsvImportPreview } from '../../lib/csv';
import { randomId } from '../../lib/encoding';
import { getRepo, lock, requireSession, useApp } from '../../state/app';
import { confirmDialog, toast, toastError } from '../../state/ui';
import { verifyMasterPassword, WrongPasswordError } from '../../vault/access';
import { createBackup, inspectBackup, openBackup, restoreMerge, restoreReplace, type OpenedBackup } from '../../vault/backup';
import type { Snapshot } from '../../vault/db';
import type { Collection } from '../../vault/types';
import { Modal } from '../components/Modal';
import { backupFileName, downloadTextFile, readFileAsText } from '../download';
import { Body, Column, ErrorText, Footnote, GlassButton, GlassTextField, GroupDivider, IconTile, InsetGroup, LargeTitle, ListRow, RowIconButton, SectionHeader, Stack, ToggleRow } from './kit';
import { PushedScreen } from './Shell';

function FilePickButton({ label, accept, icon, onFile }: { label: string; accept: string; icon: React.ReactNode; onFile: (f: File) => void }) {
  return (
    <label className="glass-clear lg-wide inline-flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-full px-[22px] py-3.5 text-[17px] font-semibold text-fg">
      <span className="flex [&>svg]:size-5">{icon}</span>
      {label}
      <input
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

export function BackupScreen() {
  const t = useT();
  const lastBackupAt = useApp((s) => s.lastBackupAt);
  const collections = useApp((s) => s.collections);
  const session = useApp((s) => s.session);
  const [exportOpen, setExportOpen] = useState(false);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [backupPw, setBackupPw] = useState('');
  const [opened, setOpened] = useState<OpenedBackup | null>(null);
  const [backupMaster, setBackupMaster] = useState('');
  const [backupSk, setBackupSk] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<CsvImportPreview | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvAck, setCsvAck] = useState(false);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const loadSnaps = () => void getRepo().listSnapshots().then(setSnaps);
  useEffect(loadSnaps, []);
  const snapReason: Record<string, string> = {
    'before-restore': t('snapshot.beforeRestore'),
    'before-merge': t('snapshot.beforeMerge'),
    'before-cloud-download': t('snapshot.beforeCloud'),
  };

  return (
    <PushedScreen title={t('a.bk_title')}>
      <Column>
        <Stack gap={12}>
          <LargeTitle className="pl-1.5">{t('a.bk_title')}</LargeTitle>
          <Body className="px-1.5">{t('a.bk_subtitle')}</Body>

          <SectionHeader>{t('a.bk_export')}</SectionHeader>
          <Footnote className="px-4">{t('a.bk_export_help')}</Footnote>
          <GlassButton block icon={<Download />} onClick={() => setExportOpen(true)}>
            {t('a.bk_export')}
          </GlassButton>
          <Footnote className="px-4">{lastBackupAt ? t('a.bk_last', { 1: formatDate(lastBackupAt, true) }) : t('a.bk_never')}</Footnote>

          <SectionHeader>{t('a.bk_restore')}</SectionHeader>
          <Footnote className="px-4">{t('a.bk_restore_help')}</Footnote>
          <FilePickButton
            label={file ? t('a.import_picked', { 1: file.name }) : t('a.import_pick')}
            accept=".myvault,.json,application/json"
            icon={<FolderOpen />}
            onFile={async (f) => {
              setError(null);
              setOpened(null);
              try {
                const text = await readFileAsText(f);
                inspectBackup(text);
                setFile({ name: f.name, text });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
          {file && !opened && (
            <>
              <GlassTextField value={backupPw} onChange={setBackupPw} placeholder={t('a.import_backup_password')} secret />
              <ErrorText>{error}</ErrorText>
              <GlassButton
                block
                loading={busy}
                disabled={!backupPw}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    setOpened(await openBackup(file.text, backupPw));
                    setBackupPw('');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('a.import_open')}
              </GlassButton>
            </>
          )}
          {!file && <ErrorText>{error}</ErrorText>}
          {opened && (
            <>
              <InsetGroup>
                <ListRow title={t('a.bk_valid', { 1: formatDate(opened.createdAt, true), 2: opened.records.length })} leading={<IconTile icon={<BadgeCheck className="size-full" />} size={34} color="#46a758" />} />
              </InsetGroup>
              <Footnote className="px-4">{t('a.bk_merge_help')}</Footnote>
              <GlassTextField value={backupMaster} onChange={setBackupMaster} placeholder={t('a.bk_backup_master')} secret />
              {opened.header.secretKey && <GlassTextField value={backupSk} onChange={(v) => setBackupSk(v.toUpperCase())} placeholder={t('a.bk_backup_sk')} mono />}
              <ErrorText>{error}</ErrorText>
              <GlassButton
                block
                icon={<GitMerge />}
                loading={busy}
                disabled={!backupMaster}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await getRepo().createSnapshot('before-merge', randomId());
                    const r = await restoreMerge(requireSession(), opened, backupMaster, backupSk || undefined);
                    toast(t('backup.merged', { added: r.added, copies: r.copies, skipped: r.skipped }));
                    setOpened(null);
                    setFile(null);
                    setBackupMaster('');
                    setBackupSk('');
                    loadSnaps();
                  } catch (err) {
                    setError(err instanceof WrongPasswordError ? t('lock.wrongPassword') : err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('a.bk_merge')}
              </GlassButton>
              <Footnote className="px-4">{t('a.bk_replace_help')}</Footnote>
              <GlassButton
                block
                prominent={false}
                destructive
                icon={<Repeat />}
                onClick={async () => {
                  const ok = await confirmDialog({ title: t('a.bk_replace'), message: t('a.bk_replace_help'), confirmLabel: t('a.import_replace'), danger: true, acknowledge: t('backup.replaceAck') });
                  if (!ok) return;
                  try {
                    await restoreReplace(getRepo(), opened);
                    lock('restore');
                  } catch (err) {
                    toastError(err);
                  }
                }}
              >
                {t('a.bk_replace')}
              </GlassButton>
            </>
          )}

          <SectionHeader>{t('a.bk_snapshots')}</SectionHeader>
          <Footnote className="px-4">{t('a.bk_snapshots_help')}</Footnote>
          {snaps.length === 0 ? (
            <Footnote className="px-4">{t('a.bk_snapshots_none')}</Footnote>
          ) : (
            <InsetGroup>
              {snaps.map((s, i) => (
                <div key={s.id}>
                  {i > 0 && <GroupDivider inset={64} />}
                  <ListRow
                    title={t('a.bk_snapshot_info', { 1: formatDate(s.createdAt, true), 2: s.records.length })}
                    subtitle={snapReason[s.reason] ?? s.reason}
                    leading={<IconTile icon={<History className="size-full" />} size={34} />}
                    trailing={
                      <RowIconButton
                        label={t('a.org_delete')}
                        tone="danger"
                        onClick={async () => {
                          await getRepo().deleteSnapshot(s.id);
                          loadSnaps();
                        }}
                      >
                        <Trash2 />
                      </RowIconButton>
                    }
                    onClick={async () => {
                      const ok = await confirmDialog({ title: t('a.bk_snapshot_restore'), message: t('a.bk_snapshot_confirm'), confirmLabel: t('a.action_restore'), danger: true });
                      if (!ok) return;
                      await restoreReplace(getRepo(), { createdAt: s.createdAt, appVersion: '', version: 1, header: s.header, records: s.records });
                      lock('restore');
                    }}
                  />
                </div>
              ))}
            </InsetGroup>
          )}

          <SectionHeader>{t('a.csv_title')}</SectionHeader>
          <Footnote className="px-4">{t('a.csv_help')}</Footnote>
          <Footnote className="px-4 !text-danger">{t('a.csv_warning')}</Footnote>
          <FilePickButton
            label={t('a.csv_choose')}
            accept=".csv,text/csv"
            icon={<FileUp />}
            onFile={async (f) => {
              setCsvAck(false);
              try {
                setCsv(detectCsv(await readFileAsText(f, 20 * 1024 * 1024)));
                setCsvError(null);
              } catch (err) {
                setCsv(null);
                setCsvError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
          {csvError && <Footnote className="px-4 !text-danger">{csvError}</Footnote>}
          {csv && (
            <>
              <InsetGroup>
                <ListRow title={t('a.csv_detected', { 1: csv.detectedFormat, 2: csv.rows.length })} subtitle={Object.keys(csv.mapping).join(', ')} leading={<IconTile icon={<Sheet className="size-full" />} size={34} />} />
                <GroupDivider inset={64} />
                <ToggleRow title={t('a.csv_ack')} checked={csvAck} onChange={setCsvAck} />
              </InsetGroup>
              <GlassButton
                block
                disabled={!csvAck}
                onClick={async () => {
                  try {
                    const s = requireSession();
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
                    const { items } = csvToItems(csv, folderId, now, s.settings().repromptByDefault);
                    if (created.length) await s.saveCollections(created);
                    await s.saveItems(items);
                    toast(t('csv.done', { n: items.length }));
                    setCsv(null);
                  } catch (err) {
                    toastError(err);
                  }
                }}
              >
                {t('a.csv_import', { 1: csv.rows.length })}
              </GlassButton>
            </>
          )}
        </Stack>
      </Column>
      {session && <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} />}
    </PushedScreen>
  );
}

function ExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [master, setMaster] = useState('');
  const [useMaster, setUseMaster] = useState(true);
  const [separate, setSeparate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setMaster('');
    setSeparate('');
    setError(null);
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('a.bk_export')}
      size="sm"
    >
      <div className="flex flex-col gap-3 pb-1">
        <GlassTextField value={master} onChange={setMaster} placeholder={t('a.master_password')} secret />
        <InsetGroup>
          <ToggleRow title={t('a.bk_use_master')} checked={useMaster} onChange={setUseMaster} />
        </InsetGroup>
        {!useMaster && (
          <>
            <GlassTextField value={separate} onChange={setSeparate} placeholder={t('a.bk_separate_password')} secret />
            <Footnote>{t('a.bk_separate_note')}</Footnote>
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <GlassButton
          block
          loading={busy}
          disabled={!master || (!useMaster && separate.length < 10)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const s = requireSession();
              await verifyMasterPassword(s, master);
              const text = await createBackup(s, useMaster ? master : separate, __APP_VERSION__);
              downloadTextFile(backupFileName(), text, 'application/json');
              toast(t('backup.exported'));
              reset();
              onClose();
            } catch (err) {
              setError(err instanceof WrongPasswordError ? t('lock.wrongPassword') : err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('a.bk_save')}
        </GlassButton>
      </div>
    </Modal>
  );
}
