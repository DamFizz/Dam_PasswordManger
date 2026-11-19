import type { KdfParams, Sealed } from '../lib/crypto';

export const VAULT_FORMAT = 'myvault-vault';
/** Version written by new vaults (password-only key wrap). */
export const VAULT_FORMAT_VERSION = 1;
/** Version written once a Secret Key has been enabled (header.secretKey). */
export const VAULT_FORMAT_VERSION_SECRET_KEY = 2;
/** Highest header version this app can read. Older apps refuse newer files instead of overwriting them. */
export const VAULT_FORMAT_MAX_VERSION = 2;

export type ItemType = 'login' | 'note' | 'wifi' | 'recoveryCodes' | 'license' | 'custom';

export interface CustomField {
  id: string;
  label: string;
  value: string;
  /** hidden fields are masked like passwords */
  hidden: boolean;
}

export interface PasswordHistoryEntry {
  password: string;
  changedAt: number;
}

export interface VaultItem {
  id: string;
  type: ItemType;
  title: string;
  url?: string;
  username?: string;
  email?: string;
  password?: string;
  notes?: string;
  categoryId?: string | null;
  sectionId?: string | null;
  tags: string[];
  recoveryEmail?: string;
  recoveryInfo?: string;
  importantNotes?: string;
  customFields: CustomField[];
  // Wi-Fi
  ssid?: string;
  wifiSecurity?: string;
  // Software license
  product?: string;
  licenseKey?: string;
  licensee?: string;
  version?: string;
  purchaseDate?: string;
  // Recovery codes
  service?: string;
  codes?: string;
  favorite: boolean;
  /** require re-entering the master password before revealing/copying secrets */
  reprompt: boolean;
  archivedAt?: number | null;
  trashedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  passwordChangedAt?: number;
  passwordHistory?: PasswordHistoryEntry[];
}

export type CollectionKind = 'category' | 'section';

export interface Collection {
  id: string;
  kind: CollectionKind;
  name: string;
  icon: string;
  color: string;
  /** only sections may be nested */
  parentId?: string | null;
  pinned: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** Vault-wide settings that sync between devices (encrypted like any other record). */
export interface VaultSettings {
  passwordHistoryLimit: number; // 0 = disabled
  defaultCategoryId: string | null;
  oldPasswordDays: number;
  trashRetentionDays: number; // 0 = keep until emptied
  /** new items ask for the master password before revealing/copying secrets */
  repromptByDefault: boolean;
  updatedAt: number;
}

export const SETTINGS_RECORD_ID = 'vault-settings';

export const DEFAULT_VAULT_SETTINGS: VaultSettings = {
  passwordHistoryLimit: 5,
  defaultCategoryId: null,
  oldPasswordDays: 365,
  trashRetentionDays: 30,
  repromptByDefault: true,
  updatedAt: 0,
};

// ---------------------------------------------------------------- My Space (same format as the Android app)

/** Whose details these are. Absent = the user's own (entries saved before this field existed). */
export type SpaceOwner = 'me' | 'other';
/** 'bank' = account number and/or an attached payment QR; 'qr' = a payment QR on its own. */
export type SpaceType = 'bank' | 'qr';

/** A bank account or payment QR kept in "My Space". Stored as an encrypted record of kind `space`. */
export interface SpaceEntry {
  id: string;
  type: SpaceType;
  /** Nickname, e.g. "Personal". */
  title: string;
  /** id from BANKS, or "custom" */
  bankId?: string | null;
  /** display name (kept even for known banks, so catalogue renames never change saved data) */
  bankName?: string | null;
  holder?: string | null;
  /** always a string: leading zeros and the exact digits are preserved */
  accountNumber?: string | null;
  duitNowId?: string | null;
  /** "savings" | "current" | "other" | free text */
  accountType?: string | null;
  notes?: string | null;
  /** hex colour, e.g. "#2563eb" */
  color?: string | null;
  icon?: string | null;
  favorite: boolean;
  /** id of the `asset` record holding the payment QR image, if any */
  qrAssetId?: string | null;
  order: number;
  owner?: SpaceOwner | null;
  createdAt: number;
  updatedAt: number;
}

/** An encrypted image: the original bytes as imported (base64) inside an `asset` record. */
export interface SpaceAsset {
  id: string;
  ownerId?: string | null;
  mime: string;
  width: number;
  height: number;
  /** base64 of the original bytes */
  data: string;
  /** SHA-256 of the bytes (hex), to detect corruption and identical re-imports */
  sha256?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Decrypted payload of an encrypted record. `kind` is inside the ciphertext, so it does not leak. */
export type RecordPayload =
  | { kind: 'item'; item: VaultItem; updatedAt: number; device: string }
  | { kind: 'collection'; collection: Collection; updatedAt: number; device: string }
  | { kind: 'settings'; settings: VaultSettings; updatedAt: number; device: string }
  | { kind: 'space'; space: SpaceEntry; updatedAt: number; device: string }
  | { kind: 'asset'; asset: SpaceAsset; updatedAt: number; device: string }
  | { kind: 'tombstone'; updatedAt: number; device: string };

/**
 * Encrypted record as persisted in IndexedDB and in the sync file.
 * Only `id`, `rev` and `vtag` are visible; they are bound to the ciphertext via AAD.
 */
export interface EncryptedRecord {
  id: string;
  /** monotonically increasing revision counter */
  rev: number;
  /** random tag identifying this exact revision */
  vtag: string;
  iv: string;
  ct: string;
}

export interface WrappedKey extends Sealed {}

export interface VaultHeader {
  format: typeof VAULT_FORMAT;
  version: number;
  vaultId: string;
  createdAt: number;
  rev: number;
  vtag: string;
  updatedAt: number;
  kdf: KdfParams;
  /** vault key wrapped with the master-password-derived key */
  passwordWrap: WrappedKey;
  /** vault key wrapped with the optional emergency recovery key */
  recoveryWrap?: WrappedKey | null;
  /** SecurityConfig encrypted with the vault's security subkey */
  security: Sealed;
  /**
   * Format v2: when set, `passwordWrap` is wrapped with a KEK that needs the master password AND
   * the device-held Secret Key (see docs in src/vault/secret-key.ts). null = password only.
   */
  secretKey?: SecretKeyInfo | null;
}

export interface SecretKeyInfo {
  /** HKDF-derived identifier of the Secret Key (lets the app say "wrong Secret Key") */
  id: string;
  createdAt: number;
}

export interface TotpSettings {
  secret: string;
  digits: 6;
  period: 30;
  algorithm: 'SHA1';
  enrolledAt: number;
}

export interface SecurityConfig {
  totp: TotpSettings | null;
  /** SHA-256 hashes (base64) of remaining single-use recovery codes */
  recoveryCodeHashes: string[];
  recoveryCodesCreatedAt: number | null;
  recoveryKeyCreatedAt: number | null;
  passwordChangedAt: number;
  /** Secret Key (26 base32 chars) kept inside the encrypted vault so unlocked devices can show it again */
  secretKey?: string | null;
}

export function emptyItem(type: ItemType, id: string, now: number): VaultItem {
  return {
    id,
    type,
    title: '',
    tags: [],
    customFields: [],
    favorite: false,
    reprompt: false,
    archivedAt: null,
    trashedAt: null,
    categoryId: null,
    sectionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Fields that hold secrets and must be masked by default. */
export const SECRET_FIELDS = ['password', 'licenseKey', 'codes'] as const;
