/* ═══════════════════════════════════════════════════════════════════════════
   Rasterise → key → matte → analyse.
   Everything below operates on ImageData (straight, non-premultiplied RGBA)
   unless a step explicitly says otherwise.
   ═══════════════════════════════════════════════════════════════════════════ */

const PREVIEW_BUDGET = 6e6;   // px above which the on-screen pass is scaled down

function newCanvas(w, h){
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
function ctx2d(c){ return c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' }); }

/* Force explicit width/height on an <svg> root so <img> cannot fall back to
   300×150, and guarantee a viewBox so it scales instead of clipping. */
function sizeSvg(svgText, w, h){
  const m = /<svg\b[^>]*>/i.exec(svgText);
  if (!m) return svgText;
  let tag = m[0];
  const nat = svgIntrinsicSize(svgText);
  if (!/viewBox\s*=/i.test(tag)) tag = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${nat.w} ${nat.h}"`);
  tag = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  tag = tag.replace(/<svg\b/i, `<svg width="${w}" height="${h}" preserveAspectRatio="none"`);
  if (!/xmlns\s*=/i.test(tag)) tag = tag.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svgText.slice(0, m.index) + tag + svgText.slice(m.index + m[0].length);
}

/* SVG (or a foreignObject wrapper) → bitmap, at exactly w×h. */
function svgToImage(svgText, w, h){
  return new Promise((res, rej) => {
    const blob = new Blob([sizeSvg(svgText, w, h)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new AGError('The vector could not be rasterised',
        'The browser refused to draw this SVG. Most often it still references a font or an image the SVG cannot reach, or the markup is not well-formed XML.'));
    };
    img.src = url;
  });
}

/* Placement of a w×h source inside a W×H frame. */
function placement(sw, sh, W, H, mode){
  if (mode === 'stretch') return { x:0, y:0, w:W, h:H };
  const s = mode === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const w = sw * s, h = sh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/* High-quality raster resize. One drawImage from 4000px to 200px throws away
   most of the samples; halving repeatedly keeps them. */
function drawScaled(dst, bitmap, box, smooth){
  const c = ctx2d(dst);
  c.imageSmoothingEnabled = smooth;
  c.imageSmoothingQuality = 'high';
  let srcCv = bitmap, sw = bitmap.width, sh = bitmap.height;
  if (smooth) {
    while (sw > box.w * 2 && sh > box.h * 2 && sw > 2 && sh > 2) {
      const hw = Math.max(1, Math.floor(sw / 2)), hh = Math.max(1, Math.floor(sh / 2));
      const tmp = newCanvas(hw, hh), tc = ctx2d(tmp);
      tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
      tc.drawImage(srcCv, 0, 0, hw, hh);
      srcCv = tmp; sw = hw; sh = hh;
    }
  }
  c.drawImage(srcCv, box.x, box.y, box.w, box.h);
}

/* ─────────────── source → ImageData at an exact output size ─────────────── */
async function rasterise(src, W, H, opts, onNote){
  const cv = newCanvas(W, H);
  const c = ctx2d(cv);
  c.clearRect(0, 0, W, H);

  if (src.kind === 'vector') {
    const box = placement(src.w, src.h, W, H, opts.fitMode);
    /* Rasterise the vector AT its drawn size: no upscaling blur, ever. */
    const img = await svgToImage(src.svgText, Math.max(1, Math.round(box.w)), Math.max(1, Math.round(box.h)));
    c.drawImage(img, box.x, box.y, box.w, box.h);
  } else if (src.kind === 'dom') {
    /* The template lays out on its own design canvas, then the vector it
       produces is scaled to the output — so a 1920×1080 template exported at
       8K is re-rendered, not enlarged. */
    src.w = clamp(Math.round(opts.domW || 1920), 16, 16384);
    src.h = clamp(Math.round(opts.domH || 1080), 16, 16384);
    const box = placement(src.w, src.h, W, H, opts.fitMode);
    /* A template that is running as a live instance is grabbed FROM that
       instance, so the exported frame is the one the monitor is showing.
       Without an instance (a dropped .html file, a batch run) fall back to the
       one-shot capture, which loads its own throwaway iframe. */
    const svg = src.inst && src.inst.ready
      ? await grabInstance(src.inst, onNote)
      : await captureDom(src, opts.settle, onNote);
    const img = await svgToImage(svg, Math.max(1, Math.round(box.w)), Math.max(1, Math.round(box.h)));
    c.drawImage(img, box.x, box.y, box.w, box.h);
  } else {
    const box = placement(src.w, src.h, W, H, opts.fitMode);
    drawScaled(cv, src.bitmap, box, opts.resample !== 'pixel');
  }

  let data;
  try { data = c.getImageData(0, 0, W, H); }
  catch (e) {
    throw new AGError('The canvas is tainted',
      'Pixels were drawn from a source the browser will not let this page read back. Nothing can be exported from a tainted canvas — this is a browser security rule, not a bug.',
      'Load the file locally, or fetch through a CORS proxy.');
  }
  return data;
}

/* ═══════════════════════════ keyers ═══════════════════════════ */

/* Chroma key in a colour-difference space: distance from the key hue in the
   Cb/Cr plane, so brightness changes across a lit backdrop do not punch holes. */
function chromaKey(d, o){
  const [kr, kg, kb] = hexToRgb(o.keyColor);
  const kY  = 0.299*kr + 0.587*kg + 0.114*kb;
  const kCb = -0.168736*kr - 0.331264*kg + 0.5*kb;
  const kCr = 0.5*kr - 0.418688*kg - 0.081312*kb;
  const tol  = (o.tolerance / 100) * 180;
  const soft = (o.softness  / 100) * 180;
  const spill = o.spill / 100;
  const greenish = kg >= kr && kg >= kb;
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i+3]) continue;
    const r = p[i], g = p[i+1], b = p[i+2];
    const cb = -0.168736*r - 0.331264*g + 0.5*b;
    const cr = 0.5*r - 0.418688*g - 0.081312*b;
    const dist = Math.hypot(cb - kCb, cr - kCr);
    let a = dist <= tol ? 0 : (dist >= tol + soft ? 1 : smoothstep(tol, tol + soft, dist));
    if (a < 1 && spill > 0) {
      /* de-spill: pull the key channel back to its neighbours */
      if (greenish) { const lim = Math.max(r, b); if (g > lim) p[i+1] = g - (g - lim) * spill; }
      else if (kb >= kr && kb >= kg) { const lim = Math.max(r, g); if (b > lim) p[i+2] = b - (b - lim) * spill; }
      else { const lim = Math.max(g, b); if (r > lim) p[i] = r - (r - lim) * spill; }
    }
    p[i+3] = p[i+3] * a;
  }
}

/* Luma key — for graphics delivered on flat black or flat white. */
function lumaKey(d, o){
  const lo = (o.lumaLo / 100) * 255, hi = (o.lumaHi / 100) * 255;
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i+3]) continue;
    const y = 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2];
    let a = hi <= lo ? (y > lo ? 1 : 0) : smoothstep(lo, hi, y);
    if (o.lumaInvert) a = 1 - a;
    p[i+3] = p[i+3] * a;
  }
}

/* Colour-to-alpha: removes a flat backdrop AND unmixes it out of the pixels it
   contaminated, so anti-aliased type keeps its soft edge instead of a halo.
   This is the right tool for "logo delivered on white". */
function colorToAlpha(d, o){
  const k = hexToRgb(o.keyColor);
  const tolerance = (o.tolerance / 100) * 255;
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const a0 = p[i+3]; if (!a0) continue;
    let a = 0;
    for (let ch = 0; ch < 3; ch++) {
      const v = p[i+ch], kc = k[ch];
      let ac;
      if (v > kc)      ac = (v - kc) / Math.max(1, 255 - kc);
      else if (v < kc) ac = (kc - v) / Math.max(1, kc);
      else             ac = 0;
      if (ac > a) a = ac;
    }
    if (tolerance > 0) a = clamp((a * 255 - tolerance) / Math.max(1, 255 - tolerance), 0, 1);
    if (a <= 0.0001) { p[i+3] = 0; continue; }
    for (let ch = 0; ch < 3; ch++) p[i+ch] = clamp(k[ch] + (p[i+ch] - k[ch]) / a, 0, 255);
    p[i+3] = a0 * a;
  }
}

/* ═══════════════════════ matte operations ═══════════════════════ */

function alphaPlane(d){
  const n = d.width * d.height, a = new Float32Array(n), p = d.data;
  for (let i = 0, j = 3; i < n; i++, j += 4) a[i] = p[j] / 255;
  return a;
}
function writeAlpha(d, a){
  const p = d.data;
  for (let i = 0, j = 3; i < a.length; i++, j += 4) p[j] = clamp(a[i] * 255, 0, 255);
}

/* Separable box blur — three passes approximate a gaussian closely enough for
   a matte and cost a fraction of one. */
function boxBlur(a, w, h, r){
  if (r < 0.5) return a;
  const R = Math.round(r);
  let src = a, dst = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    /* horizontal */
    for (let y = 0; y < h; y++) {
      const row = y * w; let sum = 0;
      for (let x = -R; x <= R; x++) sum += src[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        dst[row + x] = sum / (2 * R + 1);
        sum += src[row + clamp(x + R + 1, 0, w - 1)] - src[row + clamp(x - R, 0, w - 1)];
      }
    }
    /* vertical */
    const t = src; src = dst; dst = t;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -R; y <= R; y++) sum += src[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / (2 * R + 1);
        sum += src[clamp(y + R + 1, 0, h - 1) * w + x] - src[clamp(y - R, 0, h - 1) * w + x];
      }
    }
    const t2 = src; src = dst; dst = t2;
  }
  return src;
}

/* Erode (choke) / dilate (grow) with a separable square kernel. */
function morph(a, w, h, r, grow){
  const R = Math.abs(Math.round(r)); if (!R) return a;
  const pick = grow ? Math.max : Math.min;
  let src = a, dst = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = src[row + x];
      for (let k = -R; k <= R; k++) v = pick(v, src[row + clamp(x + k, 0, w - 1)]);
      dst[row + x] = v;
    }
  }
  const t = src; src = dst; dst = t;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = src[y * w + x];
      for (let k = -R; k <= R; k++) v = pick(v, src[clamp(y + k, 0, h - 1) * w + x]);
      dst[y * w + x] = v;
    }
  }
  return dst;
}

function matteOps(d, o, scale){
  const s = scale || 1;
  const needs = o.choke || o.feather || o.alphaGamma !== 1 || o.alphaGain !== 1;
  if (!needs) return;
  let a = alphaPlane(d);
  if (o.choke)   a = morph(a, d.width, d.height, Math.abs(o.choke) * s, o.choke > 0);
  if (o.feather) a = boxBlur(a, d.width, d.height, o.feather * s);
  if (o.alphaGamma !== 1 || o.alphaGain !== 1) {
    const g = 1 / clamp(o.alphaGamma, 0.05, 8);
    for (let i = 0; i < a.length; i++) a[i] = clamp(Math.pow(a[i], g) * o.alphaGain, 0, 1);
  }
  writeAlpha(d, a);
}

function premultiply(d){
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) { const a = p[i+3] / 255; p[i] *= a; p[i+1] *= a; p[i+2] *= a; }
}
function unpremultiply(d){
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i+3] / 255; if (a <= 0 || a >= 1) continue;
    p[i] = clamp(p[i]/a, 0, 255); p[i+1] = clamp(p[i+1]/a, 0, 255); p[i+2] = clamp(p[i+2]/a, 0, 255);
  }
}

/* Bounding box of everything above `thr`, then crop with padding. */
function contentBox(d, thr){
  const { width: w, height: h, data: p } = d;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (p[row + x*4 + 3] > thr) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x:x0, y:y0, w:x1-x0+1, h:y1-y0+1 };
}
function cropData(d, box, pad){
  const P = Math.max(0, Math.round(pad || 0));
  const W = box.w + P*2, H = box.h + P*2;
  const cv = newCanvas(d.width, d.height); ctx2d(cv).putImageData(d, 0, 0);
  const out = newCanvas(W, H); const c = ctx2d(out);
  c.drawImage(cv, box.x, box.y, box.w, box.h, P, P, box.w, box.h);
  return c.getImageData(0, 0, W, H);
}

/* ═══════════════════════ measurement / QC ═══════════════════════
   Every number here is counted from the pixels that were actually produced.
   Nothing is inferred from the file extension or the source's own claims. */
function analyse(d){
  const p = d.data, n = d.width * d.height;
  let opaque = 0, clear = 0, semi = 0, maxA = 0, minA = 255;
  let overshoot = 0, semiSamples = 0, greenBias = 0;
  const hist = new Uint32Array(64);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = p[j+3];
    hist[a >> 2]++;
    if (a > maxA) maxA = a; if (a < minA) minA = a;
    if (a === 255) opaque++; else if (a === 0) clear++; else {
      semi++;
      if (semi < 400000) {
        semiSamples++;
        const r = p[j], g = p[j+1], b = p[j+2];
        if (Math.max(r, g, b) > a + 2) overshoot++;
        greenBias += (g - (r + b) / 2);
      }
    }
  }
  const box = contentBox(d, 0);
  return {
    w: d.width, h: d.height, n,
    opaque, clear, semi, maxA, minA, hist,
    hasAlpha: maxA !== minA || maxA < 255,
    allOpaque: clear === 0 && semi === 0,
    coverage: (opaque + semi) / n,
    clearRatio: clear / n,
    semiRatio: semi / n,
    /* Straight RGBA can hold colour brighter than its alpha; premultiplied
       cannot. Zero overshoot across many soft pixels means it was very likely
       premultiplied upstream. */
    likelyPremultiplied: semiSamples > 500 && overshoot === 0,
    spillHint: semiSamples > 500 ? greenBias / semiSamples : 0,
    box
  };
}

/* ═════════════ the pipeline, at whatever size you ask for ═════════════
   Split in two on purpose: rasterising an SVG or running an HTML template is
   the expensive half, and moving a tolerance slider must not repeat it. */
function applyPipeline(raw, opts, scale){
  const d = new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height);
  if (opts.unpremul) unpremultiply(d);
  if (opts.keyMode === 'chroma')          chromaKey(d, opts);
  else if (opts.keyMode === 'luma')       lumaKey(d, opts);
  else if (opts.keyMode === 'colorAlpha') colorToAlpha(d, opts);

  matteOps(d, opts, scale);

  let out = d;
  if (opts.trim) {
    const box = contentBox(d, opts.trimThreshold);
    if (box && (box.w !== d.width || box.h !== d.height)) out = cropData(d, box, Math.round(opts.trimPad * scale));
  }
  if (opts.premul) premultiply(out);
  return out;
}

async function buildFrame(src, W, H, opts, onNote){
  const raw = await rasterise(src, W, H, opts, onNote);
  return applyPipeline(raw, opts, 1);
}

/* Target size for the current settings. */
function targetSize(src, o, ceiling){
  const cap = Math.min(ceiling || AG.MAX_DIM, 32768);
  let w, h;
  if (o.sizeMode === 'native')      { w = src.w; h = src.h; }
  else if (o.sizeMode === 'scale')  { w = src.w * o.scale; h = src.h * o.scale; }
  else if (o.sizeMode === 'preset') {
    const [gi, ii] = String(o.presetIdx).split('|').map(Number);
    const pr = (AG.PRESETS[gi] && AG.PRESETS[gi].items[ii]) || { w:1920, h:1080 };
    w = pr.w; h = pr.h;
  } else { w = o.outW; h = o.outH; }
  w = clamp(Math.round(w || 1), AG.MIN_DIM, cap);
  h = clamp(Math.round(h || 1), AG.MIN_DIM, cap);
  return { w, h };
}
