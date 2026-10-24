/** Google Drive v3 REST client limited to the private appDataFolder. */
import { SYNC_FILE_NAME } from './format';
import { RemoteError, type RemoteFileMeta, type RemoteStore } from './remote';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,version,modifiedTime,size';

interface DriveFile {
  id: string;
  name: string;
  version: string;
  modifiedTime?: string;
  size?: string;
}

function toMeta(f: DriveFile): RemoteFileMeta {
  return { id: f.id, version: String(f.version), modifiedTime: f.modifiedTime, size: f.size ? Number(f.size) : undefined };
}

export class DriveRemote implements RemoteStore {
  constructor(private readonly getToken: () => Promise<string>) {}

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
    } catch {
      throw new RemoteError('network', 'Could not reach Google Drive. Check your internet connection.');
    }
    if (res.ok) return res;
    let reason = '';
    try {
      const body = (await res.json()) as { error?: { errors?: { reason?: string }[]; message?: string } };
      reason = body.error?.errors?.[0]?.reason ?? '';
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401) throw new RemoteError('auth', 'Your Google session expired. Please reconnect.', 401);
    if (res.status === 404) throw new RemoteError('not-found', 'Cloud vault file not found.', 404);
    if (res.status === 429 || reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded') {
      throw new RemoteError('rate-limit', 'Google Drive is rate limiting requests. Sync will retry later.', res.status);
    }
    if (reason === 'storageQuotaExceeded') throw new RemoteError('quota', 'Your Google Drive storage is full.', res.status);
    if (res.status === 403) {
      if (reason === 'insufficientPermissions' || reason === 'accessNotConfigured') {
        throw new RemoteError('config', 'Google Drive access is not configured correctly (is the Drive API enabled?).', 403);
      }
      throw new RemoteError('auth', 'Google Drive denied access. Please reconnect.', 403);
    }
    if (res.status >= 500) throw new RemoteError('server', 'Google Drive is temporarily unavailable.', res.status);
    throw new RemoteError('server', `Unexpected Google Drive response (${res.status}).`, res.status);
  }

  async find(): Promise<RemoteFileMeta | null> {
    const q = encodeURIComponent(`name = '${SYNC_FILE_NAME}' and trashed = false`);
    const res = await this.request(`${API}/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&pageSize=10&fields=files(${FIELDS})`);
    const body = (await res.json()) as { files: DriveFile[] };
    return body.files.length ? toMeta(body.files[0]) : null;
  }

  async getMeta(id: string): Promise<RemoteFileMeta | null> {
    try {
      const res = await this.request(`${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`);
      return toMeta((await res.json()) as DriveFile);
    } catch (e) {
      if (e instanceof RemoteError && e.code === 'not-found') return null;
      throw e;
    }
  }

  async download(id: string): Promise<string> {
    const res = await this.request(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    return res.text();
  }

  async create(content: string): Promise<RemoteFileMeta> {
    const boundary = `myvault-${crypto.randomUUID()}`;
    const metadata = { name: SYNC_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.request(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return toMeta((await res.json()) as DriveFile);
  }

  async update(id: string, content: string): Promise<RemoteFileMeta> {
    const res = await this.request(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: content,
    });
    return toMeta((await res.json()) as DriveFile);
  }

  async rename(id: string, name: string): Promise<void> {
    await this.request(`${API}/files/${encodeURIComponent(id)}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  async remove(id: string): Promise<void> {
    await this.request(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async about(): Promise<{ email?: string; name?: string }> {
    const res = await this.request(`${API}/about?fields=user(displayName,emailAddress)`);
    const body = (await res.json()) as { user?: { displayName?: string; emailAddress?: string } };
    return { email: body.user?.emailAddress, name: body.user?.displayName };
  }

  async quota(): Promise<{ usage?: number; limit?: number }> {
    const res = await this.request(`${API}/about?fields=storageQuota(usage,limit)`);
    const body = (await res.json()) as { storageQuota?: { usage?: string; limit?: string } };
    return {
      usage: body.storageQuota?.usage ? Number(body.storageQuota.usage) : undefined,
      limit: body.storageQuota?.limit ? Number(body.storageQuota.limit) : undefined,
    };
  }
}
