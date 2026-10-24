/** Abstraction over the cloud storage used for sync, so the engine can be tested offline. */
export interface RemoteFileMeta {
  id: string;
  /** monotonically increasing version reported by the provider */
  version: string;
  modifiedTime?: string;
  size?: number;
}

export interface RemoteStore {
  find(): Promise<RemoteFileMeta | null>;
  getMeta(id: string): Promise<RemoteFileMeta | null>;
  download(id: string): Promise<string>;
  create(content: string): Promise<RemoteFileMeta>;
  update(id: string, content: string): Promise<RemoteFileMeta>;
  /** keep an old file under another name instead of deleting it */
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export type RemoteErrorCode = 'auth' | 'network' | 'quota' | 'rate-limit' | 'not-found' | 'server' | 'config';

export class RemoteError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}
