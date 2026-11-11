/**
 * Liquid Glass motion helpers.
 *
 *  - <LiquidPill>: one glass "drop" that flows between the selected items of a group
 *    (tabs, segmented controls, sidebar). It stretches toward the target, squashes on the
 *    other axis and settles with a damped spring, like a drop of liquid.
 *  - installLiquidLight(): a specular light that follows the pointer (or finger) across
 *    glass surfaces, brightening the rim and the body near it.
 *  - useRefraction(): bends the backdrop at the edges of small glass controls, like a lens.
 *    Chromium only (SVG filters in backdrop-filter); other browsers keep the plain blur.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';
import { cx } from './cx';

const reducedMotion = () => typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced';

/** Damped-spring easing; falls back to a single overshoot where linear() is unsupported. */
const JELLY =
  typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)')
    ? 'linear(0, 0.2 6%, 0.58 14%, 0.92 22%, 1.1 30%, 1.15 36%, 1.11 42%, 1.02 52%, 0.975 60%, 0.97 67%, 0.99 78%, 1.003 88%, 1)'
    : 'cubic-bezier(0.34, 1.5, 0.64, 1)';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Layout position of `el` inside `host` (ignores transforms, so it is stable during dialog animations). */
function offsetWithin(el: HTMLElement, host: HTMLElement): Box | null {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== host) {
    x += n.offsetLeft;
    y += n.offsetTop;
    const p = n.offsetParent as HTMLElement | null;
    if (!p || (p !== host && !host.contains(p))) return null;
    n = p;
  }
  if (!n || !el.offsetWidth || !el.offsetHeight) return null;
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const frame = (b: Box, extra: Keyframe = {}): Keyframe => ({ transform: `translate(${b.x}px, ${b.y}px)`, width: `${b.w}px`, height: `${b.h}px`, ...extra });

/** The liquid drop between two boxes: leading edge races ahead, trailing edge lags, cross axis squashes. */
function stretched(a: Box, b: Box): Box {
  const [l0, r0, t0, b0] = [a.x, a.x + a.w, a.y, a.y + a.h];
  const [l1, r1, t1, b1] = [b.x, b.x + b.w, b.y, b.y + b.h];
  const right = l1 + r1 > l0 + r0;
  const down = t1 + b1 > t0 + b0;
  const LEAD = 0.82;
  const LAG = 0.22;
  let lm = mix(l0, l1, right ? LAG : LEAD);
  let rm = mix(r0, r1, right ? LEAD : LAG);
  let tm = mix(t0, t1, down ? LAG : LEAD);
  let bm = mix(b0, b1, down ? LEAD : LAG);
  const dx = Math.abs(l1 + r1 - (l0 + r0)) / 2;
  const dy = Math.abs(t1 + b1 - (t0 + b0)) / 2;
  const clamp = (lo: number, hi: number, max: number): [number, number] => {
    if (hi - lo <= max) return [lo, hi];
    const c = (lo + hi) / 2;
    return [c - max / 2, c + max / 2];
  };
  if (dx >= dy) {
    [lm, rm] = clamp(lm, rm, Math.max(a.w, b.w) + 70);
    const c = (tm + bm) / 2;
    const h = (bm - tm) * 0.84;
    tm = c - h / 2;
    bm = c + h / 2;
  } else {
    [tm, bm] = clamp(tm, bm, Math.max(a.h, b.h) + 60);
    const c = (lm + rm) / 2;
    const w = (rm - lm) * 0.95;
    lm = c - w / 2;
    rm = c + w / 2;
  }
  return { x: lm, y: tm, w: rm - lm, h: bm - tm };
}

/**
 * A glass drop that follows the element marked `data-liquid-active={group}` inside its parent.
 * The parent must be positioned (relative/absolute) and the items positioned too, so they
 * paint above the drop. Render it as the parent's first child.
 */
export function LiquidPill({ group, className }: { group: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const pill = ref.current;
    const host = pill?.parentElement;
    if (!pill || !host) return;
    let prev: Box | null = null;
    let anim: Animation | null = null;

    const current = (): Box | null => {
      if (!anim) return prev;
      const cs = getComputedStyle(pill);
      const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
      return { x: m.m41, y: m.m42, w: parseFloat(cs.width), h: parseFloat(cs.height) };
    };

    const place = (animate: boolean) => {
      const target = host.querySelector<HTMLElement>(`[data-liquid-active="${group}"]`);
      const next = target ? offsetWithin(target, host) : null;
      if (!next) {
        if (prev) {
          anim?.cancel();
          anim = null;
          pill.style.opacity = '0';
          if (animate && !reducedMotion()) pill.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.6' }], { duration: 220, easing: 'ease-in' });
          prev = null;
        }
        return;
      }
      const from = current();
      if (from && Math.abs(from.x - next.x) < 0.5 && Math.abs(from.y - next.y) < 0.5 && Math.abs(from.w - next.w) < 0.5 && Math.abs(from.h - next.h) < 0.5) return;
      anim?.cancel();
      anim = null;
      pill.style.transform = `translate(${next.x}px, ${next.y}px)`;
      pill.style.width = `${next.w}px`;
      pill.style.height = `${next.h}px`;
      pill.style.opacity = '1';
      prev = next;
      if (!animate || reducedMotion()) return;
      if (!from) {
        anim = pill.animate([frame(next, { opacity: 0, scale: '0.55' }), frame(next, { opacity: 1, scale: '1' })], { duration: 520, easing: JELLY });
      } else {
        const dist = Math.hypot(next.x - from.x, next.y - from.y);
        anim = pill.animate(
          [
            { ...frame(from), easing: 'cubic-bezier(0.3, 0, 0.6, 1)' },
            { ...frame(stretched(from, next)), offset: 0.34, easing: JELLY },
            frame(next),
          ],
          { duration: Math.min(820, 520 + dist * 0.45) },
        );
      }
      anim.onfinish = () => {
        anim = null;
      };
    };

    place(false);
    // On resize: snap at rest, but re-aim smoothly if the drop is mid-flight
    const mo = new MutationObserver(() => place(true));
    mo.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-liquid-active'] });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place(anim !== null)) : null;
    ro?.observe(host);
    return () => {
      mo.disconnect();
      ro?.disconnect();
      anim?.cancel();
    };
  }, [group]);

  return <span ref={ref} aria-hidden className={cx('lg-pill', className)} />;
}

// ----------------------------------------------------------------------------- light

const LIGHT_SELECTOR = '.glass, .glass-strong, .glass-clear, .glass-tint, .card, .lg-panel';
let lightInstalled = false;

/** Specular light that follows the pointer over glass. Call once at startup. */
export function installLiquidLight(): void {
  if (lightInstalled || typeof document === 'undefined') return;
  lightInstalled = true;
  let lit: HTMLElement[] = [];
  let raf = 0;
  let last: PointerEvent | null = null;

  const chain = (target: EventTarget | null): HTMLElement[] => {
    const out: HTMLElement[] = [];
    let el = target instanceof Element ? target.closest<HTMLElement>(LIGHT_SELECTOR) : null;
    while (el && out.length < 2) {
      out.push(el);
      el = el.parentElement?.closest<HTMLElement>(LIGHT_SELECTOR) ?? null;
    }
    return out;
  };
  const light = (e: PointerEvent) => {
    const next = chain(e.target);
    for (const el of lit) if (!next.includes(el)) el.removeAttribute('data-lit');
    for (const el of next) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
      el.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
      el.setAttribute('data-lit', '');
    }
    lit = next;
  };
  const clear = () => {
    for (const el of lit) el.removeAttribute('data-lit');
    lit = [];
  };

  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch' && e.buttons === 0) return;
      last = e;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (last) light(last);
        });
    },
    { passive: true },
  );
  document.addEventListener('pointerdown', light, { passive: true, capture: true });
  const end = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') clear();
  };
  document.addEventListener('pointerup', end, { passive: true });
  document.addEventListener('pointercancel', clear, { passive: true });
  document.documentElement.addEventListener('pointerleave', clear);
  window.addEventListener('blur', clear);
}

// ----------------------------------------------------------------------------- refraction

let refractSvg: SVGSVGElement | null = null;
let refractId = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';

function refractionSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Chrome\/\d+/.test(ua) && !/Firefox|FxiOS|CriOS/.test(ua) && !!CSS.supports?.('backdrop-filter', 'url(#x)');
}

/** Displacement map for a rounded rectangle: pixels near the rim sample the backdrop further inside. */
function displacementMap(w: number, h: number, radius: number, band: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const r = Math.min(radius, w / 2, h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - (w / 2 - r);
      const qy = Math.abs(py) - (h / 2 - r);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      const depth = -sd;
      let dx = 0;
      let dy = 0;
      if (depth < band) {
        let nx: number;
        let ny: number;
        if (qx > 0 && qy > 0) {
          const l = Math.hypot(qx, qy) || 1;
          nx = qx / l;
          ny = qy / l;
        } else if (qx > qy) {
          nx = 1;
          ny = 0;
        } else {
          nx = 0;
          ny = 1;
        }
        const t = 1 - Math.max(depth, 0) / band;
        const m = t * t * (3 - 2 * t);
        dx = -Math.sign(px) * nx * m;
        dy = -Math.sign(py) * ny * m;
      }
      const i = (y * w + x) * 4;
      img.data[i] = Math.round(128 + dx * 127);
      img.data[i + 1] = Math.round(128 + dy * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Lens-like refraction at the rim of a small glass control. Returns a callback ref, so it also
 * works for elements that mount later; the element keeps its blur/saturation after refraction.
 */
export function useRefraction<T extends HTMLElement>({ blur, saturate = 180, band = 14, strength = 26 }: { blur: number; saturate?: number; band?: number; strength?: number }) {
  return useCallback(
    (el: T | null) => {
      if (!el || !refractionSupported()) return;
      return attachRefraction(el, blur, saturate, band, strength);
    },
    [blur, saturate, band, strength],
  );
}

function attachRefraction(el: HTMLElement, blur: number, saturate: number, band: number, strength: number): () => void {
  if (!refractSvg) {
    refractSvg = document.createElementNS(SVG_NS, 'svg');
    refractSvg.setAttribute('aria-hidden', 'true');
    refractSvg.setAttribute('width', '0');
    refractSvg.setAttribute('height', '0');
    refractSvg.style.position = 'absolute';
    document.body.appendChild(refractSvg);
  }
  const id = `lg-refract-${++refractId}`;
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.id = id;
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const image = document.createElementNS(SVG_NS, 'feImage');
  image.setAttribute('result', 'map');
  image.setAttribute('preserveAspectRatio', 'none');
  const disp = document.createElementNS(SVG_NS, 'feDisplacementMap');
  disp.setAttribute('in', 'SourceGraphic');
  disp.setAttribute('in2', 'map');
  disp.setAttribute('xChannelSelector', 'R');
  disp.setAttribute('yChannelSelector', 'G');
  disp.setAttribute('scale', String(strength));
  filter.append(image, disp);
  refractSvg.appendChild(filter);

  let size = '';
  const update = () => {
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (!w || !h || `${w}x${h}` === size) return;
    size = `${w}x${h}`;
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || h / 2;
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h })) {
      filter.setAttribute(k, String(v));
      image.setAttribute(k, String(v));
    }
    image.setAttribute('href', displacementMap(w, h, radius, Math.min(band, h / 2)));
    const value = `url(#${id}) blur(${blur}px) saturate(${saturate}%)`;
    el.style.setProperty('backdrop-filter', value);
    el.style.setProperty('-webkit-backdrop-filter', value);
  };
  update();
  const ro = new ResizeObserver(update);
  ro.observe(el);
  return () => {
    ro.disconnect();
    filter.remove();
    el.style.removeProperty('backdrop-filter');
    el.style.removeProperty('-webkit-backdrop-filter');
  };
}
