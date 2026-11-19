/**
 * My Space: bank accounts and payment QR codes kept next to the password vault.
 * Port of the Android app's `core/Space.kt` so both apps show and share the same thing.
 *
 * MyVault is an organiser, not a banking app: it never connects to a bank, never makes payments
 * and never generates a QR from an account number. It only stores the QR your bank gave you.
 */
import { bytesToHex, randomId } from './encoding';
import type { SpaceAsset, SpaceEntry } from '../vault/types';

export interface Bank {
  id: string;
  name: string;
  /** up to 3-4 letters for the generic badge (no logos or branding) */
  short: string;
}

export const CUSTOM_BANK = 'custom';

/** Malaysian banks offered in the picker (same list as Android). */
export const BANKS: Bank[] = [
  { id: 'maybank', name: 'Maybank', short: 'MBB' },
  { id: 'cimb', name: 'CIMB Bank', short: 'CIMB' },
  { id: 'publicbank', name: 'Public Bank', short: 'PBB' },
  { id: 'rhb', name: 'RHB Bank', short: 'RHB' },
  { id: 'hongleong', name: 'Hong Leong Bank', short: 'HLB' },
  { id: 'ambank', name: 'AmBank', short: 'AMB' },
  { id: 'bankislam', name: 'Bank Islam', short: 'BIMB' },
  { id: 'bankrakyat', name: 'Bank Rakyat', short: 'BKR' },
  { id: 'bsn', name: 'BSN', short: 'BSN' },
  { id: 'affin', name: 'Affin Bank', short: 'AFF' },
  { id: 'alliance', name: 'Alliance Bank', short: 'ABMB' },
  { id: 'hsbc', name: 'HSBC', short: 'HSBC' },
  { id: 'ocbc', name: 'OCBC', short: 'OCBC' },
  { id: 'standardchartered', name: 'Standard Chartered', short: 'SC' },
  { id: 'bankmuamalat', name: 'Bank Muamalat', short: 'BMMB' },
  { id: 'agrobank', name: 'Agrobank', short: 'AGRO' },
  { id: 'uob', name: 'UOB', short: 'UOB' },
  { id: 'tng', name: "Touch 'n Go eWallet", short: 'TNG' },
];

/** Card colours offered in the editor (same as Android). */
export const SPACE_COLORS = ['#2563eb', '#0d9488', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#475569', '#ca8a04'];

export function bankById(id: string | null | undefined): Bank | undefined {
  return BANKS.find((b) => b.id === id);
}

export function isMine(e: SpaceEntry): boolean {
  return e.owner !== 'other';
}

/** What the card shows as its name. Someone else's entry is named after the person first. */
export function spaceDisplayName(e: SpaceEntry): string {
  const t = e.title?.trim();
  if (t) return t;
  const fallback = isMine(e) ? e.bankName ?? '' : e.holder?.trim() || e.bankName || '';
  if (fallback.trim()) return fallback.trim();
  return e.type === 'qr' ? 'Payment QR' : 'Bank account';
}

/** Up to 3-4 letters for the generic bank badge. */
export function bankBadge(e: SpaceEntry): string {
  const known = bankById(e.bankId)?.short;
  if (known) return known;
  const letters = (e.bankName ?? '')
    .split(/[ -]/)
    .filter((w) => w.trim())
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return letters || 'QR';
}

/** Initials for someone else's entry (shown on a ring instead of a bank badge). */
export function personInitials(e: SpaceEntry): string {
  const name = (e.holder || e.title || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Strip spaces and dashes typed for readability; everything else (leading zeros!) is kept. */
export function normalizeAccountNumber(input: string): string {
  return input.replace(/[\s-]/g, '');
}

/** "•••• 1234" (or the whole number when it is 4 characters or fewer). */
export function maskedNumber(n: string | null | undefined): string {
  const s = n ?? '';
  return s.length <= 4 ? s : `•••• ${s.slice(-4)}`;
}

/** Groups of 4 for reading only. Copy and share always use the original string. */
export function groupedNumber(n: string | null | undefined): string {
  return (n ?? '').replace(/(.{4})(?=.)/g, '$1 ');
}

export interface ShareOptions {
  includeBank: boolean;
  includeHolder: boolean;
}

export interface ShareLabels {
  bank: string;
  holder: string;
  number: string;
}

/**
 * Plain-text message with only what the user chose: bank, holder, account number (exact).
 * Notes, DuitNow ID and other metadata are never added implicitly.
 */
export function shareText(e: SpaceEntry, o: ShareOptions, labels: ShareLabels): string {
  const lines: string[] = [];
  if (o.includeBank && e.bankName?.trim()) lines.push(`${labels.bank}: ${e.bankName}`);
  if (o.includeHolder && e.holder?.trim()) lines.push(`${labels.holder}: ${e.holder}`);
  if (e.accountNumber?.trim()) lines.push(`${labels.number}: ${e.accountNumber}`);
  return lines.join('\n');
}

export function searchSpace(entries: SpaceEntry[], query: string): SpaceEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const digits = normalizeAccountNumber(q);
  return entries.filter(
    (e) =>
      [e.title, e.bankName, e.holder, e.duitNowId, e.notes].some((v) => v?.toLowerCase().includes(q)) ||
      (digits.length > 0 && !!e.accountNumber?.includes(digits)),
  );
}

/** Your own: favourites first, then manual order, then name. Someone else's: alphabetical by name. */
export function sortSpace(entries: SpaceEntry[]): SpaceEntry[] {
  return [...entries].sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order || spaceDisplayName(a).toLowerCase().localeCompare(spaceDisplayName(b).toLowerCase()),
  );
}

export function sortPeople(entries: SpaceEntry[]): SpaceEntry[] {
  return [...entries].sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || spaceDisplayName(a).toLowerCase().localeCompare(spaceDisplayName(b).toLowerCase()),
  );
}

export function newSpaceEntry(type: 'bank' | 'qr', owner: 'me' | 'other', now = Date.now()): SpaceEntry {
  return {
    id: randomId(),
    type,
    title: '',
    bankId: null,
    bankName: null,
    holder: null,
    accountNumber: null,
    duitNowId: null,
    accountType: null,
    notes: null,
    color: SPACE_COLORS[0],
    icon: null,
    favorite: false,
    qrAssetId: null,
    order: 0,
    owner: owner === 'other' ? 'other' : null,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------- images

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Originals up to this size are kept byte-for-byte. */
export const KEEP_ORIGINAL_BYTES = 1.5 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 2000;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToBase64Std(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytesStd(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function makeAsset(ownerId: string, mime: string, width: number, height: number, bytes: Uint8Array, now = Date.now()): Promise<SpaceAsset> {
  return { id: randomId(), ownerId, mime, width, height, data: bytesToBase64Std(bytes), sha256: await sha256Hex(bytes), createdAt: now, updatedAt: now };
}

/** True when the stored bytes still match their checksum. */
export async function assetIntact(a: SpaceAsset): Promise<boolean> {
  if (!a.sha256) return true;
  try {
    return (await sha256Hex(base64ToBytesStd(a.data))) === a.sha256;
  } catch {
    return false;
  }
}

/** A data: URL for showing the stored image (never written anywhere). */
export function assetDataUrl(a: SpaceAsset): string {
  return `data:${a.mime};base64,${a.data}`;
}
