import { useApp } from '../state/app';
import { ConfirmHost, ReauthHost, Toaster } from './components/Feedback';
import { Logo } from './components/Misc';
import { LockScreen } from './screens/LockScreen';
import { Onboarding } from './screens/Onboarding';
import { Shell } from './m/Shell';
import { Wallpaper } from './m/Wallpaper';
import { UpdatePrompt } from './shell/UpdatePrompt';

export function App() {
  const phase = useApp((s) => s.phase);
  return (
    <>
      <Wallpaper live={phase !== 'unlocked'} />
      {phase === 'loading' && (
        <div className="flex h-full items-center justify-center" aria-busy="true">
          <Logo className="size-10 animate-pulse" />
        </div>
      )}
      {phase === 'welcome' && <Onboarding />}
      {phase === 'locked' && <LockScreen />}
      {phase === 'unlocked' && <Shell />}
      <Toaster />
      <ConfirmHost />
      <ReauthHost />
      <UpdatePrompt />
    </>
  );
}
