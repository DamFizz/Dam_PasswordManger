/**
 * Background behind the glass: one of the Android presets, or a photo kept on this device only
 * (IndexedDB, never synced or backed up). It drifts only on the sign-in screens, like Android.
 */
import { useEffect, useState } from 'react';
import { getRepo } from '../../state/app';
import { usePrefs } from '../../state/prefs-store';
import { createStore, useStore } from '../../state/store';

const PHOTO_KEY = 'wallpaper.photo';
/** bumped whenever the photo changes, so it is reloaded */
const photoVersion = createStore<{ v: number }>({ v: 0 });

/** Store a picked photo (scaled to at most 2400 px, JPEG) on this device. */
export async function setWallpaperPhoto(file: Blob): Promise<void> {
  const bmp = await createImageBitmap(file);
  try {
    const f = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * f);
    c.height = Math.round(bmp.height * f);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('image'))), 'image/jpeg', 0.88));
    await getRepo().setLocal(PHOTO_KEY, blob);
    photoVersion.set({ v: photoVersion.get().v + 1 });
  } finally {
    bmp.close();
  }
}

export async function hasWallpaperPhoto(): Promise<boolean> {
  return !!(await getRepo().getLocal<Blob>(PHOTO_KEY).catch(() => undefined));
}

export function Wallpaper({ live }: { live: boolean }) {
  const { wallpaper } = usePrefs();
  const v = useStore(photoVersion, (s) => s.v);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (wallpaper !== 'photo') {
      setUrl(null);
      return;
    }
    let made: string | null = null;
    let alive = true;
    void getRepo()
      .getLocal<Blob>(PHOTO_KEY)
      .then((blob) => {
        if (!alive || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [wallpaper, v]);
  return (
    <div className="lg-wallpaper" aria-hidden data-live={live && !url ? '' : undefined}>
      {url && (
        <>
          <img src={url} alt="" className="lg-wallpaper-photo" />
          <div className="lg-wallpaper-dim" />
        </>
      )}
    </div>
  );
}
