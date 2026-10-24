/**
 * CSV import from other password managers (Bitwarden, Chrome/Edge, Firefox, 1Password,
 * LastPass, KeePass/KeePassXC, Proton Pass, generic). Parsing happens entirely in memory;
 * the plaintext file is never stored or uploaded — imported items are encrypted on save.
 */
import { randomId } from './encoding';
import type { CustomField, ItemType, VaultItem } from '../vault/types';

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const SYNONYMS: Record<string, string[]> = {
  title: ['name', 'title', 'account', 'item name'],
  url: ['url', 'login_uri', 'website', 'uri', 'web site', 'login url'],
  username: ['username', 'login_username', 'user', 'login', 'user name', 'login name'],
  email: ['email', 'e-mail', 'email address'],
  password: ['password', 'login_password', 'pass'],
  notes: ['notes', 'note', 'extra', 'comments', 'comment'],
  folder: ['folder', 'grouping', 'group', 'vault', 'collection'],
  favorite: ['favorite', 'fav', 'favourite', 'starred'],
  tags: ['tags', 'labels'],
  totp: ['totp', 'login_totp', 'otpauth', 'otp', 'one-time password'],
  type: ['type'],
};

export type CsvField = keyof typeof SYNONYMS;

export interface CsvImportPreview {
  headers: string[];
  mapping: Partial<Record<CsvField, number>>;
  rows: string[][];
  detectedFormat: string;
}

export function detectCsv(text: string): CsvImportPreview {
  const all = parseCsv(text);
  if (all.length < 2) throw new Error('The CSV file has no entries.');
  const headers = all[0].map((h) => h.trim());
  const lower = headers.map((h) => h.toLowerCase());
  const mapping: Partial<Record<CsvField, number>> = {};
  for (const [field, names] of Object.entries(SYNONYMS) as [CsvField, string[]][]) {
    const idx = lower.findIndex((h) => names.includes(h));
    if (idx >= 0) mapping[field] = idx;
  }
  if (mapping.password === undefined && mapping.notes === undefined) {
    throw new Error('Could not find a password or notes column. Is this a password-manager export?');
  }
  let detectedFormat = 'Generic CSV';
  if (lower.includes('login_uri')) detectedFormat = 'Bitwarden';
  else if (lower.includes('grouping') && lower.includes('extra')) detectedFormat = 'LastPass';
  else if (lower.includes('httprealm')) detectedFormat = 'Firefox';
  else if (lower.includes('otpauth')) detectedFormat = '1Password';
  else if (lower.includes('vault') && lower.includes('createtime')) detectedFormat = 'Proton Pass';
  else if (lower.join(',') === 'name,url,username,password,note' || lower.join(',') === 'name,url,username,password') detectedFormat = 'Chrome / Edge';
  else if (lower.includes('group') && lower.includes('title')) detectedFormat = 'KeePass';
  return { headers, mapping, rows: all.slice(1), detectedFormat };
}

export interface CsvImportResult {
  items: VaultItem[];
  /** folder names referenced by the items (to be created as sections) */
  folders: string[];
}

export function csvToItems(preview: CsvImportPreview, folderIds: (name: string) => string | null, now = Date.now()): CsvImportResult {
  const get = (row: string[], f: CsvField) => {
    const idx = preview.mapping[f];
    return idx === undefined ? '' : (row[idx] ?? '').trim();
  };
  const folders = new Set<string>();
  const items: VaultItem[] = [];
  for (const row of preview.rows) {
    const password = get(row, 'password');
    const notes = get(row, 'notes');
    const url = get(row, 'url');
    let title = get(row, 'title');
    if (!title && url) {
      try {
        title = new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '');
      } catch {
        title = url;
      }
    }
    const username = get(row, 'username');
    const email = get(row, 'email');
    if (!title && !username && !password && !notes) continue;
    const rawType = get(row, 'type').toLowerCase();
    const type: ItemType = rawType === 'note' || rawType === 'securenote' || (!password && !username && !url && notes) ? 'note' : 'login';
    const folder = get(row, 'folder');
    if (folder) folders.add(folder);
    const custom: CustomField[] = [];
    const totp = get(row, 'totp');
    if (totp) custom.push({ id: randomId(), label: 'One-time password secret (TOTP)', value: totp, hidden: true });
    const tags = get(row, 'tags')
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const fav = get(row, 'favorite').toLowerCase();
    items.push({
      id: randomId(),
      type,
      title: title || 'Imported item',
      url: url || undefined,
      username: username || undefined,
      email: email || undefined,
      password: password || undefined,
      notes: notes || undefined,
      tags,
      customFields: custom,
      favorite: fav === '1' || fav === 'true' || fav === 'yes',
      reprompt: false,
      archivedAt: null,
      trashedAt: null,
      categoryId: null,
      sectionId: folder ? folderIds(folder) : null,
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: password ? now : undefined,
    });
  }
  return { items, folders: [...folders] };
}
