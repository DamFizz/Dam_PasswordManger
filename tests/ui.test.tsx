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

    // Welcome → master password
    await user.click(await screen.findByRole('button', { name: /create a new vault/i }));
    await user.type(screen.getByLabelText('Master password'), MASTER);
    await user.type(screen.getByLabelText('Confirm password'), MASTER);
    const create = screen.getByRole('button', { name: /create vault/i });
    expect(create).toBeDisabled(); // acknowledgement required
    await user.click(screen.getByRole('checkbox'));
    await user.click(create);

    // The recovery key step is optional; the vault opens straight on the item list
    await user.click(await screen.findByRole('button', { name: /skip for now/i }, { timeout: 10000 }));
    // Vault home (same layout as the Android app): overview, tiles, floating tab bar
    expect(await screen.findByRole('heading', { name: 'MyVault', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();

    // New item: + then choose Login, then the full-screen editor
    await user.click(screen.getByRole('button', { name: 'New item' }));
    const chooser = await screen.findByRole('dialog', { name: 'What would you like to save?' });
    await user.click(within(chooser).getByRole('button', { name: 'Login' }));
    await user.type(await screen.findByLabelText('Title'), 'Instagram');
    await user.type(screen.getByLabelText('Website'), 'instagram.com');
    await user.type(screen.getByLabelText('Username'), 'dam');
    await user.type(screen.getByLabelText('Email'), 'dam@example.com');
    await user.type(screen.getByLabelText('Password'), 'Insta-Secret-991!');
    // The password field is masked by default
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Item screen: secret never rendered in clear; new items are protected by default
    await screen.findByRole('heading', { name: 'Instagram', level: 1 });
    expect(document.body.textContent).not.toContain('Insta-Secret-991!');
    expect(screen.getByText('dam@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy Password' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unlock item' }));
    const prompt = await screen.findByRole('dialog', { name: 'Protected item' });
    await user.type(within(prompt).getByLabelText('Master password'), MASTER);
    await user.click(within(prompt).getByRole('button', { name: 'Unlock item' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Protected item' })).not.toBeInTheDocument());

    // Copy works without revealing; user-event provides an in-memory clipboard
    await user.click(await screen.findByRole('button', { name: 'Copy Password' }));
    expect(await navigator.clipboard.readText()).toBe('Insta-Secret-991!');
    expect(document.body.textContent).not.toContain('Insta-Secret-991!');

    // Reveal -> visible; hide -> masked again
    await user.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(screen.getByText('Insta-Secret-991!')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide Password' }));
    expect(document.body.textContent).not.toContain('Insta-Secret-991!');

    // Editing rejects unsafe URLs
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const url = await screen.findByLabelText('Website');
    await user.clear(url);
    await user.type(url, 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/valid http\(s\) web address/i)).toBeInTheDocument();
    await user.clear(url);
    await user.type(url, 'https://www.instagram.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByLabelText('Website')).not.toBeInTheDocument());

    // Lock: nothing sensitive remains on screen or in app state
    lock('manual');
    expect(await screen.findByRole('heading', { name: 'Unlock' })).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { name: 'MyVault', level: 1 }, { timeout: 10000 })).toBeInTheDocument();
    expect(app.get().items.map((i) => i.title)).toEqual(['Instagram']);
  });
});
