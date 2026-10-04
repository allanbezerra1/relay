// Image editor engine: geometry, document model and Canvas 2D rendering.
//
// Coordinate spaces
//  - source px: the original image (W×H, EXIF-oriented).
//  - frame px:  the image after 90° rotation, flips and straighten. The frame is
//               W'×H' (W/H swapped on odd 90° turns) and the rotated image is
//               scaled up just enough to always cover it. Crop rect, strokes and
//               text/emoji items all live here, so they stay put when you crop.
//  - canvas px: whatever we render into (a preview canvas or the export canvas),
//               reached through a `view` matrix (frame px → canvas px).
// Geometry changes remap strokes/items through new·old⁻¹, so drawings follow the photo.

// ---------- 2D affine helpers: [a, b, c, d, e, f] like canvas setTransform ----------
export const ID = [1, 0, 0, 1, 0, 0];
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const inv = (m) => {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
};
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const T = (x, y) => [1, 0, 0, 1, x, y];
export const S = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
export const R = (rad) => { const c = Math.cos(rad), s = Math.sin(rad); return [c, s, -s, c, 0, 0]; };
export const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- Document ----------

export const ADJUSTMENTS = [
  { id: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { id: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { id: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { id: 'warmth', label: 'Warmth', min: -100, max: 100 },
  { id: 'clarity', label: 'Clarity', min: -100, max: 100 },
  { id: 'vignette', label: 'Vignette', min: 0, max: 100 },
];

export const PRESETS = [
  { id: 'none', name: 'Original' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.45) contrast(1.12)' },
  { id: 'warm', name: 'Warm', css: 'saturate(1.12) brightness(1.03)', warmth: 0.5 },
  { id: 'cool', name: 'Cool', css: 'saturate(0.95) brightness(1.04)', warmth: -0.5 },
  { id: 'mono', name: 'Mono', css: 'grayscale(1) contrast(1.15)' },
  { id: 'sepia', name: 'Sepia', css: 'sepia(0.85) contrast(1.05) brightness(1.02)' },
  { id: 'drama', name: 'Drama', css: 'contrast(1.4) saturate(0.8) brightness(0.92)', vignette: 0.5 },
  { id: 'retro', name: 'Retro', css: 'sepia(0.3) saturate(1.25) contrast(0.88) hue-rotate(-8deg)', warmth: 0.25, fade: 0.14 },
  { id: 'soft', name: 'Soft', css: 'contrast(0.86) brightness(1.08) saturate(0.88)', fade: 0.07 },
  { id: 'night', name: 'Night', css: 'brightness(0.86) contrast(1.2) saturate(0.7) hue-rotate(10deg)', warmth: -0.7, vignette: 0.35 },
];

export const FONTS = [
  { id: 'classic', label: 'Classic', css: (px) => `600 ${px}px "Inter Variable", Inter, "Segoe UI", system-ui, sans-serif` },
  { id: 'bold', label: 'Bold', css: (px) => `900 ${px}px "Arial Black", "Inter Variable", Inter, system-ui, sans-serif` },
  { id: 'typewriter', label: 'Typewriter', css: (px) => `500 ${px}px "Courier New", Courier, "Noto Sans Mono", "DejaVu Sans Mono", ui-monospace, monospace` },
  { id: 'neon', label: 'Neon', css: (px) => `700 ${px}px "Inter Variable", Inter, "Segoe UI", system-ui, sans-serif`, glow: true },
  { id: 'hand', label: 'Handwritten', css: (px) => `italic 500 ${px}px "Segoe Script", "Bradley Hand", "Snell Roundhand", "Brush Script MT", "Comic Sans MS", "URW Chancery L", Georgia, cursive` },
  { id: 'serif', label: 'Elegant', css: (px) => `italic 600 ${px}px Georgia, "Times New Roman", "Noto Serif", "DejaVu Serif", serif` },
];
export const fontOf = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
export const EMOJI_FONT = (px) => `${px}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;

export const ASPECTS = [
  { id: 'free', label: 'Free' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1', r: 1 },
  { id: '4:5', label: '4:5', r: 4 / 5 },
  { id: '3:4', label: '3:4', r: 3 / 4 },
  { id: '9:16', label: '9:16', r: 9 / 16 },
  { id: '16:9', label: '16:9', r: 16 / 9 },
];

export function initialDoc(W, H) {
  return {
    geom: { rot: 0, angle: 0, fx: 1, fy: 1 },
    crop: { x: 0, y: 0, w: W, h: H },
    aspect: 'free',
    adjust: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, clarity: 0, vignette: 0 },
    filter: 'none',
    intensity: 100,
    strokes: [],
    items: [],
  };
}

export function isPristine(doc, W, H) {
  return JSON.stringify(doc) === JSON.stringify(initialDoc(W, H));
}

export const frameSize = (geom, W, H) => (geom.rot % 2 ? [H, W] : [W, H]);

function coverScale(fw, fh, deg) {
  const a = Math.abs(deg * Math.PI / 180), c = Math.cos(a), s = Math.sin(a);
  return Math.max((fw * c + fh * s) / fw, (fw * s + fh * c) / fh);
}

/** source px → frame px */
export function geomMatrix(geom, W, H) {
  const [fw, fh] = frameSize(geom, W, H);
  const rad = (geom.rot * 90 + geom.angle) * Math.PI / 180;
  return [T(fw / 2, fh / 2), S(geom.fx, geom.fy), R(rad), S(coverScale(fw, fh, geom.angle)), T(-W / 2, -H / 2)].reduce(mul);
}

/** Change rotation/flip/straighten, carrying crop, drawings and text along with the photo. */
export function changeGeom(doc, patch, W, H) {
  const geom = { ...doc.geom, ...patch };
  geom.rot = ((geom.rot % 4) + 4) % 4;
  const A = mul(geomMatrix(geom, W, H), inv(geomMatrix(doc.geom, W, H)));
  const k = scaleOf(A);
  const [fw, fh] = frameSize(geom, W, H);
  const strokes = doc.strokes.map((s) => {
    const pts = new Array(s.pts.length);
    for (let i = 0; i < s.pts.length; i += 2) [pts[i], pts[i + 1]] = apply(A, s.pts[i], s.pts[i + 1]);
    return { ...s, pts, size: s.size * k };
  });
  const items = doc.items.map((it) => {
    const [x, y] = apply(A, it.x, it.y);
    const dir = [A[0] * Math.cos(it.rot) + A[2] * Math.sin(it.rot), A[1] * Math.cos(it.rot) + A[3] * Math.sin(it.rot)];
    return { ...it, x, y, size: it.size * k, rot: Math.atan2(dir[1], dir[0]) };
  });
  let crop = doc.crop;
  let aspect = doc.aspect;
  if (geom.rot !== doc.geom.rot || geom.fx !== doc.geom.fx || geom.fy !== doc.geom.fy) {
    const c = doc.crop;
    const pts = [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]].map(([x, y]) => apply(A, x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    crop = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (geom.rot !== doc.geom.rot && !['free', 'original', '1:1'].includes(aspect)) aspect = 'free';
  }
  crop = clampCrop(crop, fw, fh);
  return { ...doc, geom, crop, aspect, strokes, items };
}

export function clampCrop(c, fw, fh) {
  const w = clamp(c.w, 1, fw), h = clamp(c.h, 1, fh);
  return { x: clamp(c.x, 0, fw - w), y: clamp(c.y, 0, fh - h), w, h };
}

export function aspectRatio(id, fw, fh) {
  if (id === 'original') return fw / fh;
  return ASPECTS.find((a) => a.id === id)?.r || null;
}

/** Largest rect of the ratio that fits the frame, centred on the current crop. */
export function cropForAspect(crop, r, fw, fh) {
  if (!r) return crop;
  let w, h;
  if (fw / fh > r) { h = fh; w = h * r; } else { w = fw; h = w / r; }
  const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
  return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h }, fw, fh);
}

/** Drag a crop handle ('tl', 't', 'r', …) or move it ('move') by (dx, dy) frame px. */
export function dragCrop(start, handle, dx, dy, r, fw, fh) {
  const min = Math.max(24, Math.max(fw, fh) * 0.04);
  if (handle === 'move') return clampCrop({ ...start, x: start.x + dx, y: start.y + dy }, fw, fh);
  let x1 = start.x, y1 = start.y, x2 = start.x + start.w, y2 = start.y + start.h;
  const L = handle.includes('l'), Rr = handle.includes('r'), Tt = handle.includes('t'), B = handle.includes('b');
  if (L) x1 = clamp(x1 + dx, 0, x2 - min);
  if (Rr) x2 = clamp(x2 + dx, x1 + min, fw);
  if (Tt) y1 = clamp(y1 + dy, 0, y2 - min);
  if (B) y2 = clamp(y2 + dy, y1 + min, fh);
  if (!r) return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };

  let w = x2 - x1, h = y2 - y1;
  const corner = (L || Rr) && (Tt || B);
  if (corner) {
    if (w / h > r) w = h * r; else h = w / r;
    // Room available from the anchored corner.
    const maxW = L ? start.x + start.w : fw - start.x;
    const maxH = Tt ? start.y + start.h : fh - start.y;
    const f = Math.min(1, maxW / w, maxH / h);
    w *= f; h *= f;
    const ax = L ? start.x + start.w : start.x, ay = Tt ? start.y + start.h : start.y;
    return { x: L ? ax - w : ax, y: Tt ? ay - h : ay, w, h };
  }
  if (L || Rr) {
    const cy = start.y + start.h / 2;
    h = w / r;
    const maxH = 2 * Math.min(cy, fh - cy);
    if (h > maxH) { h = maxH; w = h * r; }
    const ax = L ? start.x + start.w : start.x;
    return { x: L ? ax - w : ax, y: cy - h / 2, w, h };
  }
  const cx = start.x + start.w / 2;
  w = h * r;
  const maxW = 2 * Math.min(cx, fw - cx);
  if (w > maxW) { w = maxW; h = w / r; }
  const ay = Tt ? start.y + start.h : start.y;
  return { x: cx - w / 2, y: Tt ? ay - h : ay, w, h };
}

/** Zoom the crop window around a frame point (f < 1 zooms in). */
export function zoomCrop(c, f, px, py, fw, fh) {
  const min = Math.max(24, Math.max(fw, fh) * 0.04);
  let w = c.w * f, h = c.h * f;
  const fit = Math.min(1, fw / w, fh / h);
  w *= fit; h *= fit;
  if (Math.min(w, h) < min) return c;
  const k = w / c.w;
  return clampCrop({ x: px - (px - c.x) * k, y: py - (py - c.y) * k, w, h }, fw, fh);
}

// ---------- Text / emoji items ----------

let measureCtx = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** Local (unrotated) box of an item, centred at 0,0. */
export function itemBox(it) {
  const ctx = mctx();
  if (it.kind === 'emoji') {
    ctx.font = EMOJI_FONT(it.size);
    const w = Math.max(it.size, ctx.measureText(it.text).width);
    return { w: w * 1.1, h: it.size * 1.25, lines: [it.text], lineH: it.size, pad: 0 };
  }
  ctx.font = fontOf(it.font).css(it.size);
  const lines = (it.text || ' ').split('\n');
  const lineH = it.size * 1.22;
  const w = Math.max(...lines.map((l) => ctx.measureText(l || ' ').width));
  const pad = it.size * 0.42;
  return { w: w + pad * 2, h: lines.length * lineH + pad * 1.1, lines, lineH, pad, textW: w };
}

export function hitItem(items, x, y) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const b = itemBox(it);
    const c = Math.cos(-it.rot), s = Math.sin(-it.rot);
    const lx = (x - it.x) * c - (y - it.y) * s, ly = (x - it.x) * s + (y - it.y) * c;
    if (Math.abs(lx) <= b.w / 2 + 6 && Math.abs(ly) <= b.h / 2 + 6) return it;
  }
  return null;
}

const luminance = (hex) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex || '');
  if (!m) return 1;
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastOn = (hex) => (luminance(hex) > 0.6 ? '#111318' : '#ffffff');

function drawItem(ctx, it) {
  const m = ctx.getTransform();
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  const b = itemBox(it);
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate(it.rot);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (it.kind === 'emoji') {
    ctx.font = EMOJI_FONT(it.size);
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = it.size * 0.08 * k;
    ctx.shadowOffsetY = it.size * 0.03 * k;
    ctx.fillText(it.text, 0, it.size * 0.06);
    ctx.restore();
    return;
  }
  const f = fontOf(it.font);
  ctx.font = f.css(it.size);
  const top = -((b.lines.length - 1) * b.lineH) / 2;
  if (it.bg) {
    ctx.fillStyle = it.color;
    ctx.beginPath();
    ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, it.size * 0.38);
    ctx.fill();
  }
  const fill = it.bg ? contrastOn(it.color) : f.glow ? '#ffffff' : it.color;
  if (f.glow && !it.bg) {
    ctx.shadowColor = it.color;
    for (const blur of [it.size * 0.7, it.size * 0.3]) {
      ctx.shadowBlur = blur * k;
      ctx.fillStyle = it.color;
      b.lines.forEach((l, i) => ctx.fillText(l, 0, top + i * b.lineH));
    }
    ctx.shadowBlur = it.size * 0.12 * k;
  } else if (!it.bg) {
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = it.size * 0.14 * k;
    ctx.shadowOffsetY = it.size * 0.03 * k;
  }
  ctx.fillStyle = fill;
  b.lines.forEach((l, i) => ctx.fillText(l, 0, top + i * b.lineH));
  ctx.restore();
}

// ---------- Strokes ----------

function tracePath(ctx, pts) {
  ctx.beginPath();
  const n = pts.length / 2;
  ctx.moveTo(pts[0], pts[1]);
  if (n === 1) { ctx.lineTo(pts[0] + 0.01, pts[1]); return; }
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    ctx.quadraticCurveTo(x, y, (x + pts[i * 2 + 2]) / 2, (y + pts[i * 2 + 3]) / 2);
  }
  ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
}

function drawStroke(ctx, s, k) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  tracePath(ctx, s.pts);
  if (s.kind === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = s.size;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  } else if (s.kind === 'hl') {
    ctx.globalAlpha = 0.42;
    ctx.lineCap = 'square';
    ctx.lineWidth = s.size;
    ctx.strokeStyle = s.color;
    ctx.stroke();
  } else if (s.kind === 'neon') {
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.size * 1.6 * k;
    ctx.lineWidth = s.size;
    ctx.strokeStyle = s.color;
    ctx.stroke();
    ctx.stroke();
    ctx.shadowBlur = s.size * 0.4 * k;
    ctx.lineWidth = s.size * 0.42;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.stroke();
  } else {
    ctx.lineWidth = s.size;
    ctx.strokeStyle = s.color;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- Rendering ----------

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function adjustCss(a) {
  const parts = [];
  if (a.brightness) parts.push(`brightness(${(1 + a.brightness * 0.0055).toFixed(3)})`);
  if (a.contrast) parts.push(`contrast(${(1 + a.contrast * 0.006).toFixed(3)})`);
  if (a.saturation) parts.push(`saturate(${(1 + a.saturation / 100).toFixed(3)})`);
  return parts.join(' ');
}

function unsharp(c, amount, radius) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const b = canvas(c.width, c.height);
  const bctx = b.getContext('2d', { willReadFrequently: true });
  bctx.filter = `blur(${radius.toFixed(2)}px)`;
  bctx.drawImage(c, 0, 0);
  const A = ctx.getImageData(0, 0, c.width, c.height);
  const Bd = bctx.getImageData(0, 0, c.width, c.height).data;
  const d = A.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    d[i] += amount * (d[i] - Bd[i]);
    d[i + 1] += amount * (d[i + 1] - Bd[i + 1]);
    d[i + 2] += amount * (d[i + 2] - Bd[i + 2]);
  }
  ctx.putImageData(A, 0, 0);
}

/**
 * The photo layer: geometry + adjustments + filter preset, before blur and drawings.
 * opts: { src, W, H, doc, view, w, h, clip, fast }
 */
export function renderImageLayer({ src, W, H, doc, view, w, h, clip = true, fast = false }) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: !fast && !!doc.adjust.clarity });
  const k = scaleOf(view);
  const { crop, adjust } = doc;
  const preset = PRESETS.find((p) => p.id === doc.filter) || PRESETS[0];
  const t = preset.id === 'none' ? 0 : doc.intensity / 100;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const [fw, fh] = frameSize(doc.geom, W, H);
  const area = clip ? crop : { x: 0, y: 0, w: fw, h: fh };
  ctx.setTransform(...view);
  ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
  ctx.save();
  ctx.transform(...geomMatrix(doc.geom, W, H));
  const base = adjustCss(adjust);
  ctx.filter = base || 'none';
  ctx.drawImage(src, 0, 0, W, H);
  if (t > 0 && preset.css) {
    ctx.globalAlpha = t;
    ctx.filter = `${base} ${preset.css}`;
    ctx.drawImage(src, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  ctx.filter = 'none';
  ctx.restore();

  // Warmth: soft-light wash of amber / blue.
  const warmth = adjust.warmth / 100 + (preset.warmth || 0) * t;
  if (warmth) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(1, Math.abs(warmth));
    ctx.fillStyle = warmth > 0 ? '#ff9a2e' : '#2e8bff';
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.restore();
  }
  const fade = (preset.fade || 0) * t;
  if (fade) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgb(${Math.round(fade * 255)},${Math.round(fade * 245)},${Math.round(fade * 235)})`;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.restore();
  }

  if (adjust.clarity && !fast) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const amount = adjust.clarity > 0 ? adjust.clarity / 100 * 1.1 : adjust.clarity / 100 * 0.95;
    const radius = Math.max(0.7, Math.max(fw, fh) * 0.0018 * k);
    unsharp(c, amount, adjust.clarity > 0 ? radius : radius * 2.5);
    ctx.setTransform(...view);
  }

  // Vignette relative to the crop window.
  const vig = adjust.vignette / 100 + (preset.vignette || 0) * t;
  if (vig > 0) {
    ctx.save();
    ctx.transform(...mul(T(crop.x + crop.w / 2, crop.y + crop.h / 2), S(crop.w / 2, crop.h / 2)));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, vig * 0.9)})`);
    ctx.fillStyle = g;
    ctx.fillRect(-1.5, -1.5, 3, 3);
    ctx.restore();
  }
  return c;
}

/** Blur / pixelate brush: paint masked copies of the photo layer onto `ctx`. */
function applyBlurStrokes(ctx, layer, strokes, view, fdim, cacheObj) {
  const k = scaleOf(view);
  for (const kind of ['blur', 'pixel']) {
    const list = strokes.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const key = `${kind}`;
    let fx = cacheObj?.[key];
    if (!fx) {
      fx = canvas(layer.width, layer.height);
      const fctx = fx.getContext('2d');
      if (kind === 'blur') {
        fctx.filter = `blur(${Math.max(2, fdim * 0.014 * k).toFixed(1)}px)`;
        fctx.drawImage(layer, 0, 0);
        fctx.filter = 'none';
      } else {
        const cell = Math.max(3, fdim / 55 * k);
        const sm = canvas(layer.width / cell, layer.height / cell);
        const sctx = sm.getContext('2d');
        sctx.imageSmoothingQuality = 'medium';
        sctx.drawImage(layer, 0, 0, sm.width, sm.height);
        fctx.imageSmoothingEnabled = false;
        fctx.drawImage(sm, 0, 0, fx.width, fx.height);
      }
      if (cacheObj) cacheObj[key] = fx;
    }
    const mask = canvas(layer.width, layer.height);
    const mctx2 = mask.getContext('2d');
    mctx2.setTransform(...view);
    for (const s of list) drawStroke(mctx2, { ...s, kind: 'pen', color: '#000' }, k);
    mctx2.setTransform(1, 0, 0, 1, 0, 0);
    mctx2.globalCompositeOperation = 'source-in';
    mctx2.drawImage(fx, 0, 0);
    ctx.drawImage(mask, 0, 0);
  }
}

/**
 * Full render into `out` (a 2D context sized w×h).
 * cache: optional object reused between preview frames (keeps the photo layer).
 */
export function renderDoc(out, { src, W, H, doc, view, w, h, clip = true, cache = null, fast = false, hideItem = null, background = null }) {
  const [fw, fh] = frameSize(doc.geom, W, H);
  const area = clip ? doc.crop : { x: 0, y: 0, w: fw, h: fh };
  const key = JSON.stringify([view, doc.geom, clip && doc.crop, doc.adjust, doc.filter, doc.intensity, w, h, fast, src.width]);
  let layer, fxCache = null;
  if (cache && cache.key === key) {
    layer = cache.layer;
    fxCache = cache.fx;
  } else {
    layer = renderImageLayer({ src, W, H, doc, view, w, h, clip, fast });
    if (cache) { cache.key = key; cache.layer = layer; cache.fx = fxCache = {}; }
  }
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.clearRect(0, 0, w, h);
  if (background) { out.fillStyle = background; out.fillRect(0, 0, w, h); }
  out.drawImage(layer, 0, 0);
  applyBlurStrokes(out, layer, doc.strokes, view, Math.max(fw, fh), fxCache);

  const k = scaleOf(view);
  const draws = doc.strokes.filter((s) => s.kind !== 'blur' && s.kind !== 'pixel');
  if (draws.length) {
    const d = canvas(w, h);
    const dctx = d.getContext('2d');
    dctx.setTransform(...view);
    dctx.beginPath(); dctx.rect(area.x, area.y, area.w, area.h); dctx.clip();
    for (const s of draws) drawStroke(dctx, s, k);
    out.drawImage(d, 0, 0);
  }
  out.save();
  out.setTransform(...view);
  out.beginPath(); out.rect(area.x, area.y, area.w, area.h); out.clip();
  for (const it of doc.items) if (it.id !== hideItem) drawItem(out, it);
  out.restore();
}

// ---------- Loading & export ----------

const PREVIEW_MAX = 2400;

/** Decode once; keep a downscaled bitmap for the interactive preview. */
export async function loadSource(file) {
  const full = await createImageBitmap(file);
  const W = full.width, H = full.height;
  const f = Math.min(1, PREVIEW_MAX / Math.max(W, H));
  const preview = f < 1
    ? await createImageBitmap(full, { resizeWidth: Math.round(W * f), resizeHeight: Math.round(H * f), resizeQuality: 'high' })
    : full;
  if (preview !== full) full.close();
  let alpha = false;
  if (/png|webp|gif|avif/.test(file.type)) {
    const c = canvas(Math.min(256, preview.width), Math.min(256, preview.height));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(preview, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break; }
  }
  return { preview, W, H, alpha };
}

const MAX_PIXELS = 40e6;

export async function exportDoc(file, doc, { alpha }) {
  const full = await createImageBitmap(file);
  const W = full.width, H = full.height;
  const { crop } = doc;
  const f = Math.min(1, Math.sqrt(MAX_PIXELS / (crop.w * crop.h)));
  const w = Math.max(1, Math.round(crop.w * f)), h = Math.max(1, Math.round(crop.h * f));
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  renderDoc(ctx, { src: full, W, H, doc, view: mul(S(w / crop.w, h / crop.h), T(-crop.x, -crop.y)), w, h, clip: true, background: alpha ? null : '#ffffff' });
  full.close();
  const type = alpha ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((res) => c.toBlob(res, type, 0.9));
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '').replace(/-edited$/, '');
  return new File([blob], `${base}-edited.${alpha ? 'png' : 'jpg'}`, { type, lastModified: Date.now() });
}

export const EDITABLE = /^image\/(jpeg|png|webp|bmp|avif|x-icon)$/;
