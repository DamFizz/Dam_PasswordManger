/** Save text as a file on the user's own device (no network involved). */
export function downloadTextFile(filename: string, text: string, type = 'text/plain'): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsText(file: File, maxBytes = 50 * 1024 * 1024): Promise<string> {
  if (file.size > maxBytes) return Promise.reject(new Error('File is too large'));
  return file.text();
}

export function backupFileName(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `myvault-backup-${stamp}.myvault`;
}

/** Print sensitive recovery material in a separate, minimal window (nothing else on the page). */
export function printText(title: string, text: string): void {
  const w = window.open('', '_blank', 'width=640,height=720');
  if (!w) return;
  const doc = w.document;
  doc.title = title;
  const h = doc.createElement('h2');
  h.textContent = title;
  const pre = doc.createElement('pre');
  pre.textContent = text;
  pre.style.fontSize = '16px';
  pre.style.fontFamily = 'Consolas, monospace';
  doc.body.append(h, pre);
  w.focus();
  w.print();
  w.close();
}
