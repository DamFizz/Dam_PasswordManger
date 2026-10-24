import { RemoteError, type RemoteFileMeta, type RemoteStore } from '../src/sync/remote';

/** In-memory stand-in for Google Drive, used only by automated tests. */
export class MemoryRemote implements RemoteStore {
  files = new Map<string, { name: string; content: string; version: number }>();
  private nextId = 1;
  /** optional hooks to simulate a concurrent writer between download and upload */
  beforeUpdate?: () => void;
  afterDownload?: () => Promise<void>;

  async find(): Promise<RemoteFileMeta | null> {
    for (const [id, f] of this.files) if (f.name === 'myvault.vault.json') return { id, version: String(f.version) };
    return null;
  }
  async getMeta(id: string): Promise<RemoteFileMeta | null> {
    const f = this.files.get(id);
    return f ? { id, version: String(f.version) } : null;
  }
  async download(id: string): Promise<string> {
    const f = this.files.get(id);
    if (!f) throw new RemoteError('not-found', 'File not found', 404);
    const content = f.content;
    if (this.afterDownload) await this.afterDownload();
    return content;
  }
  async create(content: string): Promise<RemoteFileMeta> {
    const id = `file-${this.nextId++}`;
    this.files.set(id, { name: 'myvault.vault.json', content, version: 1 });
    return { id, version: '1' };
  }
  async update(id: string, content: string): Promise<RemoteFileMeta> {
    this.beforeUpdate?.();
    const f = this.files.get(id);
    if (!f) throw new RemoteError('not-found', 'File not found', 404);
    f.content = content;
    f.version++;
    return { id, version: String(f.version) };
  }
  async rename(id: string, name: string): Promise<void> {
    const f = this.files.get(id);
    if (f) {
      f.name = name;
      f.version++;
    }
  }
  async remove(id: string): Promise<void> {
    this.files.delete(id);
  }
}
