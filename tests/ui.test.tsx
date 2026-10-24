import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/ui/App';
import { app, boot, lock } from '../src/state/app';
import '../src/state/sync-controller';

const MASTER = 'Orbit-Timber-Lemon-Glide-42';
beforeAll(() => {
  localStorage.setItem('myvault.prefs', JSON.stringify({ lang: 'en', autoSync: false }));
});

describe('MyVault UI (end-to-end in jsdom)', () => {
  it('creates a vault, stores an item with a hidden password, copies it without revealing, and locks', async () => {
    const user = userEvent.setup();
    await boot();
    render(<App />);

    // Welcome → how it works → master password
    await user.click(await screen.findByRole('button', { name: /create a new vault/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByLabelText('Master password'), MASTER);
    await user.type(screen.getByLabelText('Confirm password'), MASTER);
    const create = screen.getByRole('button', { name: /create vault/i });
    expect(create).toBeDisabled(); // acknowledgement required
    await user.click(screen.getByRole('checkbox'));
    await user.click(create);

    // Optional steps can be skipped
    await user.click(await screen.findByRole('button', { name: /skip for now/i }, { timeout: 10000 }));
    await user.click(await screen.findByRole('button', { name: /skip for now/i }));
    await user.click(await screen.findByRole('button', { name: /maybe later/i }));
    await user.click(await screen.findByRole('button', { name: /open my vault/i }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();

    // Add a login
    await user.click(screen.getByRole('button', { name: /add an account/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'Instagram');
    await user.type(within(dialog).getByLabelText('Website URL'), 'instagram.com');
    await user.type(within(dialog).getByLabelText('Username'), 'dam');
    await user.type(within(dialog).getByLabelText('Email'), 'dam@example.com');
    await user.type(within(dialog).getByLabelText('Password'), 'Insta-Secret-991!');
    // Password input is masked while typing
    expect(within(dialog).getByLabelText('Password')).toHaveAttribute('type', 'password');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    // Detail view: password hidden by default, never rendered in the DOM until revealed
    await screen.findByRole('heading', { name: 'Instagram', level: 2 });
    expect(document.body.textContent).not.toContain('Insta-Secret-991!');
    expect(screen.getByText('dam@example.com')).toBeInTheDocument();

    // Copy works without revealing
    await user.click(screen.getAllByRole('button', { name: 'Copy Password' })[0]);
    // user-event provides an in-memory clipboard
    expect(await navigator.clipboard.readText()).toBe('Insta-Secret-991!');
    expect(document.body.textContent).not.toContain('Insta-Secret-991!');

    // Reveal → visible; hide → masked again
    await user.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(screen.getByText('Insta-Secret-991!')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide Password' }));
    expect(document.body.textContent).not.toContain('Insta-Secret-991!');

    // Unsafe URLs are rejected by the editor
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editDialog = await screen.findByRole('dialog');
    const url = within(editDialog).getByLabelText('Website URL');
    await user.clear(url);
    await user.type(url, 'javascript:alert(1)');
    await user.click(within(editDialog).getByRole('button', { name: 'Save' }));
    expect(await within(editDialog).findByText(/valid http\(s\) web address/i)).toBeInTheDocument();
    await user.clear(url);
    await user.type(url, 'https://www.instagram.com');
    await user.click(within(editDialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Lock: nothing sensitive remains on screen or in app state
    lock('manual');
    expect(await screen.findByRole('heading', { name: /myvault is locked/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Instagram');
    expect(document.body.textContent).not.toContain('dam@example.com');
    expect(app.get().items).toHaveLength(0);
    expect(app.get().session).toBeNull();

    // Wrong password is rejected, right password restores the data
    await user.type(screen.getByLabelText('Master password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: /^unlock$/i }));
    expect(await screen.findByText(/incorrect master password/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Master password'));
    await user.type(screen.getByLabelText('Master password'), MASTER);
    await user.click(screen.getByRole('button', { name: /^unlock$/i }));
    expect(await screen.findByRole('heading', { name: 'Overview' }, { timeout: 10000 })).toBeInTheDocument();
    expect(app.get().items.map((i) => i.title)).toEqual(['Instagram']);
  });
});
