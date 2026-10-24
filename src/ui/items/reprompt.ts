import { t } from '../../i18n';
import { onLock, requireSession } from '../../state/app';
import { requestReauth } from '../../state/ui';
import { verifyMasterPassword } from '../../vault/access';
import type { VaultItem } from '../../vault/types';

/** Items marked "re-prompt" require the master password before secrets are revealed or copied. */
const verifiedAt = new Map<string, number>();
const GRACE_MS = 2 * 60_000;

export async function ensureItemAccess(item: VaultItem): Promise<boolean> {
  if (!item.reprompt) return true;
  const at = verifiedAt.get(item.id);
  if (at && Date.now() - at < GRACE_MS) return true;
  const session = requireSession();
  const ok = await requestReauth({
    title: t('reprompt.title'),
    description: t('reprompt.description', { title: item.title }),
    submitLabel: t('reprompt.submit'),
    run: async (password) => {
      await verifyMasterPassword(session, password);
      return true;
    },
  });
  if (ok) verifiedAt.set(item.id, Date.now());
  return !!ok;
}

export function clearRepromptGrace(): void {
  verifiedAt.clear();
}

onLock(clearRepromptGrace);
