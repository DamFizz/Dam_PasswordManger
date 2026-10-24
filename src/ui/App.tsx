import { useApp } from '../state/app';
import { ConfirmHost, ReauthHost, Toaster } from './components/Feedback';
import { Logo } from './components/Misc';
import { LockScreen } from './screens/LockScreen';
import { Onboarding } from './screens/Onboarding';
import { AppShell } from './shell/AppShell';
import { UpdatePrompt } from './shell/UpdatePrompt';

export function App() {
  const phase = useApp((s) => s.phase);
  return (
    <>
      {phase === 'loading' && (
        <div className="ambient flex h-full items-center justify-center" aria-busy="true">
          <Logo className="size-14 animate-pulse" />
        </div>
      )}
      {phase === 'welcome' && <Onboarding />}
      {phase === 'locked' && <LockScreen />}
      {phase === 'unlocked' && <AppShell />}
      <Toaster />
      <ConfirmHost />
      <ReauthHost />
      <UpdatePrompt />
    </>
  );
}
