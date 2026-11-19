/**
 * Payment QR images for My Space (port of the Android app's data/SpaceMedia.kt).
 *
 *  - Originals up to 1.5 MB (PNG / JPEG / WebP, at most 4096 px) are kept byte-for-byte.
 *  - Larger images are scaled to at most 2000 px and stored as PNG, or JPEG at quality 92 if the
 *    PNG would still be too large. Files over 25 MB are refused.
 *  - "QR check": whether a QR code can be read from the image, and a box around it (with room for
 *    the quiet zone) for "Crop to QR". Only a yes/no leaves the decoder: the payload is not kept.
 *  - The payment card: one PNG with the bank, holder, exact number and the original QR.
 *
 * Images are decoded in memory only. Nothing is written to disk except when the user shares.
 */
import { KEEP_ORIGINAL_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, spaceDisplayName } from './space';
import type { SpaceEntry } from '../vault/types';

export interface ImportedImage {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  width: number;
  height: number;
  /** a QR code could be read from the image */
  qrFound: boolean;
  /** box around the QR in the stored image's pixels */
  qrBox: { x: number; y: number; w: number; h: number } | null;
}

export class ImageImportError extends Error {
  constructor(readonly reason: 'notImage' | 'tooLarge' | 'unreadable') {
    super(reason);
    this.name = 'ImageImportError';
  }
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new ImageImportError('notImage');
  }
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ImageImportError('unreadable');
  return [c, ctx];
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new ImageImportError('unreadable'))), type, quality));
}

async function blobBytes(b: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await b.arrayBuffer());
}

/** Look for a QR code on a copy at most 1200 px; returns a box in source pixels with a quiet-zone margin. */
export async function detectQr(source: CanvasImageSource, width: number, height: number): Promise<{ found: boolean; box: ImportedImage['qrBox'] }> {
  try {
    const { default: jsQR } = await import('jsqr');
    const f = Math.max(width, height) > 1200 ? 1200 / Math.max(width, height) : 1;
    const w = Math.max(1, Math.round(width * f));
    const h = Math.max(1, Math.round(height * f));
    const [, ctx] = canvasOf(w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const r = jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (!r) return { found: false, box: null };
    const pts = [r.location.topLeftCorner, r.location.topRightCorner, r.location.bottomLeftCorner, r.location.bottomRightCorner];
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const pad = Math.max(maxX - minX, maxY - minY) * 0.12;
    const x0 = Math.max(0, Math.round((minX - pad) / f));
    const y0 = Math.max(0, Math.round((minY - pad) / f));
    const x1 = Math.min(width, Math.round((maxX + pad) / f));
    const y1 = Math.min(height, Math.round((maxY + pad) / f));
    return { found: true, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  } catch {
    return { found: false, box: null };
  }
}

/** Import a picked image following the Android rules (see the module comment). */
export async function importImage(file: Blob): Promise<ImportedImage> {
  if (file.size > MAX_IMAGE_BYTES) throw new ImageImportError('tooLarge');
  const bmp = await decode(file);
  try {
    const mime = file.type || 'image/png';
    const keep = file.size <= KEEP_ORIGINAL_BYTES && ['image/png', 'image/jpeg', 'image/webp'].includes(mime) && Math.max(bmp.width, bmp.height) <= 4096;
    let bytes: Uint8Array<ArrayBuffer>;
    let outMime = mime;
    let w = bmp.width;
    let h = bmp.height;
    if (keep) {
      bytes = await blobBytes(file);
    } else {
      const f = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
      w = Math.round(bmp.width * f);
      h = Math.round(bmp.height * f);
      const [c, ctx] = canvasOf(w, h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, w, h);
      const png = await toBlob(c, 'image/png');
      if (png.size <= KEEP_ORIGINAL_BYTES) {
        bytes = await blobBytes(png);
        outMime = 'image/png';
      } else {
        bytes = await blobBytes(await toBlob(c, 'image/jpeg', 0.92));
        outMime = 'image/jpeg';
      }
    }
    const { found, box } = await detectQr(bmp, bmp.width, bmp.height);
    const sx = w / bmp.width;
    const sy = h / bmp.height;
    const mapped = box ? { x: Math.round(box.x * sx), y: Math.round(box.y * sy), w: Math.round(box.w * sx), h: Math.round(box.h * sy) } : null;
    return { bytes, mime: outMime, width: w, height: h, qrFound: found, qrBox: mapped };
  } finally {
    bmp.close();
  }
}

/** Crop to the QR box (lossless PNG on white) and re-check that the QR still reads. */
export async function cropToQr(img: ImportedImage): Promise<ImportedImage> {
  if (!img.qrBox) return img;
  const bmp = await decode(new Blob([img.bytes], { type: img.mime }));
  try {
    const b = img.qrBox;
    const side = Math.max(b.w, b.h);
    const [c, ctx] = canvasOf(side, side);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, side, side);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, b.x, b.y, b.w, b.h, Math.round((side - b.w) / 2), Math.round((side - b.h) / 2), b.w, b.h);
    const bytes = await blobBytes(await toBlob(c, 'image/png'));
    const { found } = await detectQr(c, side, side);
    return { bytes, mime: 'image/png', width: side, height: side, qrFound: found, qrBox: null };
  } finally {
    bmp.close();
  }
}

export interface CardLabels {
  holder: string;
  number: string;
  footer: string;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/** One PNG with the bank, holder, exact number and the original QR (same layout as Android). */
export async function paymentCard(e: SpaceEntry, qr: { bytes: Uint8Array; mime: string } | null, accent: string, labels: CardLabels): Promise<Blob> {
  const w = 1080;
  const pad = 72;
  const header = 210;
  const qrSide = 820;
  const qrBmp = qr ? await decode(new Blob([qr.bytes as Uint8Array<ArrayBuffer>], { type: qr.mime })) : null;
  const ratio = qrBmp ? Math.min(1.6, Math.max(0.5, qrBmp.height / qrBmp.width)) : 1;
  const h = Math.round(header + (qrBmp ? qrSide * ratio + 80 : 40) + 400);
  const [c, ctx] = canvasOf(w, h);
  const sans = "-apple-system, 'Segoe UI', Roboto, 'Inter Variable', sans-serif";
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, header);
  ctx.fillStyle = '#fff';
  ctx.font = `bold 60px ${sans}`;
  ctx.fillText(fit(ctx, e.bankName || spaceDisplayName(e), w - pad * 2), pad, 112);
  if (e.title.trim() && e.title !== e.bankName) {
    ctx.globalAlpha = 0.86;
    ctx.font = `36px ${sans}`;
    ctx.fillText(fit(ctx, e.title, w - pad * 2), pad, 168);
    ctx.globalAlpha = 1;
  }
  let y = header + 60;
  if (qrBmp) {
    const dh = qrSide * ratio;
    ctx.imageSmoothingEnabled = qrBmp.width > qrSide;
    ctx.drawImage(qrBmp, (w - qrSide) / 2, y, qrSide, dh);
    ctx.imageSmoothingEnabled = true;
    qrBmp.close();
    y += dh + 80;
  }
  const field = (label: string, value: string | null | undefined, big: boolean) => {
    if (!value?.trim()) return;
    ctx.fillStyle = 'rgb(100 116 139)';
    ctx.font = `32px ${sans}`;
    ctx.fillText(label, pad, y);
    y += big ? 74 : 62;
    ctx.fillStyle = 'rgb(15 23 42)';
    ctx.font = big ? "bold 60px 'JetBrains Mono Variable', ui-monospace, Consolas, monospace" : `bold 46px ${sans}`;
    ctx.fillText(fit(ctx, value, w - pad * 2), pad, y);
    y += 70;
  };
  field(labels.holder, e.holder, false);
  field(labels.number, e.accountNumber, true);
  ctx.fillStyle = 'rgb(148 163 184)';
  ctx.font = `26px ${sans}`;
  ctx.fillText(labels.footer, pad, h - 44);
  return toBlob(c, 'image/png');
}

export function extFor(mime: string): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
}

/**
 * Share with the system share sheet (Web Share API) when available; otherwise copy the text and/or
 * download the image. Returns what happened, for the toast.
 */
export async function shareContent(opts: { title: string; text?: string; file?: { blob: Blob; name: string } }): Promise<'shared' | 'cancelled' | 'copied' | 'downloaded'> {
  const files = opts.file ? [new File([opts.file.blob], opts.file.name, { type: opts.file.blob.type })] : undefined;
  const data: ShareData = { title: opts.title, ...(opts.text ? { text: opts.text } : {}), ...(files ? { files } : {}) };
  if (navigator.share && (!files || navigator.canShare?.({ files }))) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  if (opts.file) {
    const url = URL.createObjectURL(opts.file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = opts.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    if (opts.text) await navigator.clipboard?.writeText(opts.text).catch(() => undefined);
    return 'downloaded';
  }
  if (opts.text) {
    await navigator.clipboard?.writeText(opts.text);
    return 'copied';
  }
  return 'cancelled';
}
