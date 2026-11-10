import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoogleSetupHelp } from '../src/ui/screens/SyncView';
import { useClientId } from '../src/state/sync-controller';

function ConnectButton() {
  const clientId = useClientId();
  return <button disabled={!clientId}>Connect Google Drive</button>;
}

describe('Google OAuth client ID', () => {
  it('enables "Connect" as soon as the client ID is saved, without a reload', async () => {
    localStorage.removeItem('myvault.googleClientId');
    const user = userEvent.setup();
    render(
      <>
        <GoogleSetupHelp />
        <ConnectButton />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeDisabled();
    await user.type(screen.getByLabelText('OAuth client ID'), '123456789012-abcdefghijk.apps.googleusercontent.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeEnabled();
  });
});
