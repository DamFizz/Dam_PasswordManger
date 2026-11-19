/**
 * Generator tab (Android ToolsScreens.GeneratorTab): the result with a strength meter, Regenerate /
 * Copy, "Save to vault" (new login, or replace an existing login's password; history is kept),
 * Password / Passphrase with their options.
 */
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Copy, Plus, RefreshCw, Save } from 'lucide-react';
import { useT } from '../../i18n';
import { generatePassphrase, generatePassword, MIN_LENGTH } from '../../lib/generator';
import { estimateStrength } from '../../lib/strength';
import { app, openEditor, saveItem, useApp } from '../../state/app';
import { toast, toastError } from '../../state/ui';
import { Modal } from '../components/Modal';
import { copyWithFeedback } from '../components/Secret';
import { Body, CheckMark, Chevron, Column, FlowingSelector, Footnote, GlassButton, GroupDivider, IconTile, InsetGroup, LargeTitle, ListRow, Stack, ToggleRow } from './kit';

const STRENGTH_COLORS = ['#e5484d', '#f76b15', '#f5a524', '#46a758', '#12a594'];

export function StrengthBar({ password }: { password: string }) {
  const t = useT();
  const r = estimateStrength(password);
  const color = STRENGTH_COLORS[r.score]!;
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease-spring)]" style={{ width: `${((r.score + 1) / 5) * 100}%`, background: color }} />
      </div>
      <div className="flex text-[13px]">
        <span className="flex-1 font-semibold" style={{ color }}>
          {t(`a.strength_${r.label}` as never)}
        </span>
        <span className="text-faint">{t('a.strength_bits', { 1: Math.round(r.bits) })}</span>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="px-4 py-2.5">
      <label className="block text-[17px] text-fg">
        {label}
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="lg-slider mt-2 block w-full" aria-label={label} />
      </label>
    </div>
  );
}

export function GeneratorTab() {
  const t = useT();
  const items = useApp((s) => s.items);
  const [mode, setMode] = useState<'password' | 'passphrase'>('password');
  const [length, setLength] = useState(20);
  const [upper, setUpper] = useState(true);
  const [lower, setLower] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [ambiguous, setAmbiguous] = useState(true);
  const [repeats, setRepeats] = useState(true);
  const [words, setWords] = useState(5);
  const [separator, setSeparator] = useState('-');
  const [capitalize, setCapitalize] = useState(true);
  const [number, setNumber] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [saveSheet, setSaveSheet] = useState(false);
  const [pickLogin, setPickLogin] = useState(false);
  const [pickSeparator, setPickSeparator] = useState(false);
  const anyClass = upper || lower || digits || symbols;

  const result = useMemo(() => {
    try {
      return mode === 'password'
        ? generatePassword({ length, upper, lower, digits, symbols, excludeAmbiguous: ambiguous, avoidRepeats: repeats })
        : generatePassphrase({ words, separator, capitalize, includeNumber: number });
    } catch {
      return '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, mode, length, upper, lower, digits, symbols, ambiguous, repeats, words, separator, capitalize, number]);
  const logins = items.filter((i) => i.type === 'login' && !i.trashedAt && !i.archivedAt).sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));

  const replace = async (id: string) => {
    const item = app.get().items.find((i) => i.id === id);
    if (!item) return;
    try {
      await saveItem({ ...item, password: result });
      toast(t('a.toast_saved'));
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Column>
      <Stack gap={12}>
        <LargeTitle className="pl-1.5">{t('a.gen_title')}</LargeTitle>
        <Body className="px-1.5">{t('a.gen_subtitle')}</Body>
        <InsetGroup>
          <div className="flex flex-col gap-3.5 p-[18px]">
            <p className={result ? 'break-all font-mono text-[22px] font-bold leading-[30px] text-fg select-all' : 'font-mono text-[22px] font-bold leading-[30px] text-danger'} data-testid="generated">
              {result || t('a.gen_none_selected')}
            </p>
            {result && <StrengthBar password={result} />}
          </div>
        </InsetGroup>
        <div className="flex gap-2.5">
          <GlassButton className="flex-1" prominent={false} icon={<RefreshCw />} onClick={() => setNonce((n) => n + 1)}>
            {t('a.gen_regenerate')}
          </GlassButton>
          <GlassButton className="flex-1" icon={<Copy />} disabled={!result} onClick={() => void copyWithFeedback(result, { secret: true, label: t('a.field_password') })}>
            {t('a.detail_copy')}
          </GlassButton>
        </div>
        <GlassButton block prominent={false} icon={<Save />} disabled={!result} onClick={() => setSaveSheet(true)}>
          {t('a.gen_save')}
        </GlassButton>
        <FlowingSelector
          label={t('a.gen_title')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'password', label: t('a.gen_password') },
            { value: 'passphrase', label: t('a.gen_passphrase') },
          ]}
          className="lg-seg-accent"
        />
        {mode === 'password' ? (
          <>
            <InsetGroup>
              <Slider label={t('a.gen_length', { 1: length })} value={length} min={MIN_LENGTH} max={64} onChange={setLength} />
              <GroupDivider />
              <ToggleRow title={t('a.gen_upper')} checked={upper} onChange={setUpper} />
              <GroupDivider />
              <ToggleRow title={t('a.gen_lower')} checked={lower} onChange={setLower} />
              <GroupDivider />
              <ToggleRow title={t('a.gen_digits')} checked={digits} onChange={setDigits} />
              <GroupDivider />
              <ToggleRow title={t('a.gen_symbols')} checked={symbols} onChange={setSymbols} />
            </InsetGroup>
            <InsetGroup>
              <ToggleRow title={t('a.gen_ambiguous')} subtitle={t('a.gen_ambiguous_help')} checked={ambiguous} onChange={setAmbiguous} />
              <GroupDivider />
              <ToggleRow title={t('a.gen_repeats')} checked={repeats} onChange={setRepeats} />
            </InsetGroup>
            {!anyClass && <Footnote className="px-4 !text-danger">{t('a.gen_none_selected')}</Footnote>}
          </>
        ) : (
          <InsetGroup>
            <Slider label={t('a.gen_words', { 1: words })} value={words} min={3} max={12} onChange={setWords} />
            <GroupDivider />
            <ListRow
              title={t('a.gen_separator')}
              trailing={
                <>
                  <span className="font-mono text-[17px] text-muted">{separator === ' ' ? '␣' : separator}</span>
                  <Chevron />
                </>
              }
              onClick={() => setPickSeparator(true)}
            />
            <GroupDivider />
            <ToggleRow title={t('a.gen_capitalize')} checked={capitalize} onChange={setCapitalize} />
            <GroupDivider />
            <ToggleRow title={t('a.gen_number')} checked={number} onChange={setNumber} />
          </InsetGroup>
        )}
        <Footnote className="px-4">{t('a.gen_wordlist_note')}</Footnote>
      </Stack>

      <Modal open={pickSeparator} onClose={() => setPickSeparator(false)} title={t('a.gen_separator')} size="sm">
        <InsetGroup className="mb-1">
          {['-', ' ', '.', '_', ','].map((sep, i) => (
            <div key={sep}>
              {i > 0 && <GroupDivider />}
              <ListRow title={sep === ' ' ? '␣  (space)' : sep} trailing={<CheckMark on={separator === sep} />} onClick={() => (setSeparator(sep), setPickSeparator(false))} />
            </div>
          ))}
        </InsetGroup>
      </Modal>
      <Modal open={saveSheet} onClose={() => setSaveSheet(false)} title={t('a.gen_save')} size="sm">
        <div className="flex flex-col gap-3 pb-1">
          <InsetGroup>
            <ListRow
              title={t('a.gen_new_entry')}
              leading={<IconTile icon={<Plus className="size-full" />} size={32} />}
              onClick={() => {
                setSaveSheet(false);
                openEditor({ mode: 'new', type: 'login', preset: { password: result } });
              }}
            />
            <GroupDivider inset={62} />
            <ListRow title={t('a.gen_existing')} leading={<IconTile icon={<ArrowLeftRight className="size-full" />} size={32} />} onClick={() => (setSaveSheet(false), setPickLogin(true))} />
          </InsetGroup>
          <Footnote className="px-4">{t('a.gen_history_note')}</Footnote>
        </div>
      </Modal>
      <Modal open={pickLogin} onClose={() => setPickLogin(false)} title={t('a.gen_existing')} size="sm">
        <InsetGroup className="mb-1">
          {logins.map((l, i) => (
            <div key={l.id}>
              {i > 0 && <GroupDivider />}
              <ListRow title={l.title} subtitle={l.username ?? l.email} onClick={() => (setPickLogin(false), void replace(l.id))} />
            </div>
          ))}
        </InsetGroup>
      </Modal>
    </Column>
  );
}
