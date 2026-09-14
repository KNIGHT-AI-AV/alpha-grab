/* ═══════════════════════════════════════════════════════════════════════════
   Source loading: URL → fetch → classify → decodable source.
   Three source kinds:
     raster  — ImageBitmap (PNG/WebP/AVIF/GIF/JPEG/BMP/ICO)
     vector  — SVG text, rasterised at any output size (true resolution-free)
     dom     — an HTML template, run in a same-origin iframe then serialised
   ═══════════════════════════════════════════════════════════════════════════ */

const IMG_EXT = /\.(png|webp|avif|gif|jpe?g|bmp|ico|apng)(\?|#|$)/i;
const SVG_EXT = /\.svgz?(\?|#|$)/i;

function normalizeUrl(raw){
  let s = String(raw || '').trim().replace(/^["'<]|["'>]$/g, '');
  if (!s) throw new AGError('Enter a URL', 'Paste a link to an image, an SVG, or an HTML graphics template.');
  if (/^(data|blob):/i.test(s)) return s;
  if (!/^https?:\/\//i.test(s)) {
    if (/^\/\//.test(s)) s = location.protocol + s;
    else if (/^[\w.-]+\.[a-z]{2,}(\/|$|:)/i.test(s)) s = 'https://' + s;
    else throw new AGError('That does not look like a URL', 'Expected something like <code>https://example.com/lower-third.png</code>.');
  }
  return new URL(s).href;
}

/* An error that carries a human diagnosis, a suggested fix, and — when there is
   one — the name of an action that performs it. A wall of text telling someone
   what they could do is worse than a button that does it. */
class AGError extends Error {
  constructor(msg, detail, fix, action){
    super(msg); this.detail = detail || ''; this.fix = fix || ''; this.action = action || '';
  }
}

function proxied(url){
  if (!S.opts.useProxy) return null;
  /* An empty field with the box ticked used to mean "no proxy at all": the
     control sat there switched on and did nothing, and the failure that came
     back was the byte-identical CORS error you got without it. Someone
     following the tool's own advice to "switch on a CORS proxy" therefore had
     no way to tell the box from a lie.

     A ticked box now always routes somewhere. With nothing typed it uses the
     relay we run, which is what the field is pre-filled with anyway. */
  const p = ((S.opts.proxy || '').trim()) || AG.RELAY;
  return p.includes('{url}')
    ? p.replace('{url}', encodeURIComponent(url))
    : p.replace(/\/?$/, '/') + url;
}

/* Is the host reachable at all? An opaque no-cors response proves the server
   answered; only the CORS headers were missing. This is the difference between
   "you are offline / the URL is wrong" and "the server will not share it with
   a browser", and they need completely different fixes. */
async function diagnose(url){
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store' });
    return 'cors';
  } catch (_) {
    return navigator.onLine === false ? 'offline' : 'unreachable';
  }
}

async function fetchWithFallback(url){
  const attempts = [];
  const direct = async u => {
    const r = await fetch(u, { mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow' });
    if (!r.ok) throw new AGError(`Server said ${r.status}`, `<code>${r.status} ${r.statusText || ''}</code> for that URL.`);
    return r;
  };
  try { return { res: await direct(url), via: 'direct' }; }
  catch (e) { attempts.push(e); }

  const px = proxied(url);
  if (px) {
    try { return { res: await direct(px), via: 'proxy' }; }
    catch (e) { attempts.push(e); }
  }

  const why = await diagnose(url);
  if (why === 'offline')
    throw new AGError('You are offline', 'The browser reports no network connection.');
  if (why === 'unreachable')
    throw new AGError('Could not reach that URL',
      'No response from the server — check the address, or that the host is up.');
  throw new AGError('Blocked by CORS',
    'The server answered, but it does not send <code>Access-Control-Allow-Origin</code>, so the browser will not let this page read the pixels. ' +
    'That is the host’s choice and nothing here can change it — it is not a fault in this tool.',
    'Press <b>Use the relay</b> below to fetch it through a small server we run, or drag the file in instead.',
    'relay');
}

/* ─────────────────────────── public loaders ─────────────────────────── */

async function loadFromUrl(raw){
  const url = normalizeUrl(raw);
  const { res, via } = await fetchWithFallback(url);
  const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const buf = await res.arrayBuffer();
  const src = await classify(buf, ct, url);
  src.via = via;
  src.hash = bytesHash(buf);
  return src;
}

/* A fingerprint of exactly what the server just sent. Used to answer one
   question in the repeat loop: "is this actually a new graphic?"

   The failure it exists to catch is silent. Push a graphic, download, push the
   next one, download again — if the second push has not landed yet the server
   returns the same bytes, the export succeeds, the clip number advances, and
   you end up with clip_004.png that is a duplicate of clip_003.png. Nothing
   errors. You find out in the edit.

   FNV-1a over the whole buffer: not cryptographic, but this is comparing a
   response against the one before it, not defending against an adversary. */
function bytesHash(buf){
  const b = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return ((h >>> 0).toString(16).padStart(8, '0')) + ':' + b.length;
}

async function loadFromFile(file){
  const buf = await file.arrayBuffer();
  const src = await classify(buf, (file.type || '').toLowerCase(), file.name, true);
  src.name = slugName(file.name);
  src.via = 'local';
  return src;
}

/* Content sniffing: never trust the extension alone, never trust the
   content-type alone. Magic bytes beat both. */
function sniff(buf){
  const b = new Uint8Array(buf.slice(0, 24));
  const s = (...v) => v.every((x, i) => b[i] === x);
  if (s(0x89,0x50,0x4e,0x47)) return 'image/png';
  if (s(0xff,0xd8,0xff))      return 'image/jpeg';
  if (s(0x47,0x49,0x46,0x38)) return 'image/gif';
  if (s(0x42,0x4d))           return 'image/bmp';
  if (s(0x00,0x00,0x01,0x00)) return 'image/x-icon';
  const asc = String.fromCharCode(...b);
  if (asc.startsWith('RIFF') && asc.slice(8,12) === 'WEBP') return 'image/webp';
  if (asc.slice(4,12) === 'ftypavif' || asc.slice(4,11) === 'ftypavi') return 'image/avif';
  return null;
}

async function classify(buf, ct, urlOrName, isFile){
  const magic = sniff(buf);
  const head  = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 1200)).trim();
  const looksSvg  = /^(<\?xml|<!--|<svg)/i.test(head) && /<svg[\s>]/i.test(head);
  const looksHtml = /^<!doctype html|^<html[\s>]|<head[\s>]|<body[\s>]/i.test(head);
  const name = slugName(urlOrName);
  const base = { name, url: isFile ? '' : urlOrName, bytes: buf.byteLength, mime: magic || ct || '' };

  if (looksSvg || SVG_EXT.test(String(urlOrName)) || /svg/.test(ct)) {
    const text = new TextDecoder('utf-8').decode(buf);
    const dims = svgIntrinsicSize(text);
    return Object.assign(base, { kind:'vector', mime:'image/svg+xml', svgText:text, w:dims.w, h:dims.h, vector:true });
  }

  if (magic || /^image\//.test(ct) || IMG_EXT.test(String(urlOrName))) {
    const blob = new Blob([buf], { type: magic || ct || 'image/png' });
    let bmp;
    try { bmp = await createImageBitmap(blob); }
    catch (e) {
      if (looksHtml) return htmlSource(buf, base, urlOrName);
      throw new AGError('That file would not decode',
        'The bytes arrived but the browser could not read them as an image. It may be a format this browser lacks (AVIF/JXL on older builds), or the URL returned an error page.');
    }
    return Object.assign(base, { kind:'raster', bitmap:bmp, w:bmp.width, h:bmp.height, blob });
  }

  if (looksHtml || /html/.test(ct)) return htmlSource(buf, base, urlOrName);

  throw new AGError('Unrecognised content',
    `The server returned <code>${ct || 'no content-type'}</code> and the bytes are not an image, an SVG or an HTML page.`);
}

function htmlSource(buf, base, url){
  return Object.assign(base, {
    kind: 'dom',
    mime: 'text/html',
    html: new TextDecoder('utf-8', { fatal:false }).decode(buf),
    baseUrl: /^https?:/i.test(String(url)) ? String(url) : location.href,
    w: 1920, h: 1080
  });
}

/* SVG intrinsic size — width/height attrs first, then the viewBox. */
function svgIntrinsicSize(text){
  const root = /<svg\b[^>]*>/i.exec(text);
  const tag = root ? root[0] : '';
  const num = a => {
    const m = new RegExp(a + '\\s*=\\s*["\']([\\d.]+)\\s*(px)?["\']', 'i').exec(tag);
    return m ? parseFloat(m[1]) : 0;
  };
  let w = num('width'), h = num('height');
  const vb = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  if ((!w || !h) && vb) { w = w || parseFloat(vb[3]); h = h || parseFloat(vb[4]); }
  return { w: Math.round(w || 1024), h: Math.round(h || 1024) };
}

/* ═════════════════════ HTML template capture ═════════════════════
   The template is run for real in a same-origin `srcdoc` iframe so its own
   scripts execute and it settles on its hold frame. The settled DOM is then
   REPAINTED as native SVG — rects, gradients, text and images.

   Why not <foreignObject>, which would be one line? Because an SVG containing
   a foreignObject taints every canvas it is drawn on, in every Chromium build,
   over file:// and https:// alike. It renders, and then it cannot be read back,
   so nothing can be exported from it. Measured, not assumed — tests/browser.mjs
   holds the check. Repainting costs more code and pays for itself twice: the
   frame is exportable, and it is vector, so an HTML lower third scales to 8K
   with real curves instead of enlarged pixels.

   What survives the repaint: boxes, background colours, two-stop linear
   gradients, borders, corner radii, opacity, images, inline SVG, readable
   canvases, and text with its font, weight, size, colour, letter-spacing and
   per-line position. What does not: box shadows, filters, blend modes,
   clipping, rotate/scale transforms, and stacking that disagrees with document
   order. Each of those that is actually present is counted and reported rather
   than silently dropped.                                                      */

async function captureDom(src, settleMs, onNote){
  const notes = new Map();
  const note = m => notes.set(m, (notes.get(m) || 0) + 1);
  const W = Math.max(16, Math.round(src.w)), H = Math.max(16, Math.round(src.h));

  const frame = el('iframe', {
    style: `position:fixed;left:-99999px;top:0;width:${W}px;height:${H}px;border:0;visibility:hidden;background:transparent`
  });
  frame.setAttribute('aria-hidden', 'true');

  let html = src.html;
  if (!/<base\b/i.test(html)) {
    const inject = `<base href="${src.baseUrl.replace(/"/g, '&quot;')}">`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + inject) : inject + html;
  }
  frame.srcdoc = html;
  document.body.append(frame);

  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new AGError('The template never finished loading',
        'The page did not fire <code>load</code> within 20 seconds.')), 20000);
      frame.onload = () => { clearTimeout(t); res(); };
      frame.onerror = () => { clearTimeout(t); rej(new AGError('The template failed to load', '')); };
    });

    const doc = frame.contentDocument;
    if (!doc) throw new AGError('Could not read the rendered template', 'The iframe document was not accessible.');

    try { if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, new Promise(r => setTimeout(r, 4000))]); } catch (_) {}
    await new Promise(r => setTimeout(r, clamp(settleMs, 0, AG.SETTLE_MAX)));

    const fontCss = await collectFontFaces(doc, src.baseUrl, note);
    await inlineImages(doc, src.baseUrl, note);
    const svg = domToSvg(doc, W, H, fontCss, note);

    if (onNote) for (const [m, n] of notes) onNote(n > 1 ? `${m} (×${n})` : m);
    return svg;
  } finally {
    frame.remove();
  }
}

/* ── images, inline SVG and canvases become data URIs the SVG can carry ── */
/* `undo` makes this reversible. A one-shot capture throws its iframe away and
   does not care, but a LIVE instance keeps running after the grab — rewriting
   its image sources and inline background styles permanently would leave the
   monitor showing something the template never asked for, and would fight any
   template that animates those properties. Pass an array and every mutation
   pushes a restore closure onto it. */
async function inlineImages(doc, baseUrl, note, undo){
  const keep = (fn) => { if (undo) undo.push(fn); };
  const abs = u => { try { return new URL(u, baseUrl).href; } catch (_) { return null; } };
  const toData = async (u, cap) => {
    if (/^data:/i.test(u)) return u;
    const url = abs(u); if (!url) return null;
    try {
      const r = await fetch(proxied(url) || url, { mode:'cors', credentials:'omit', cache:'force-cache' });
      if (!r.ok) return null;
      const b = await r.arrayBuffer();
      if (b.byteLength > (cap || 8e6)) return null;
      return `data:${r.headers.get('content-type') || 'application/octet-stream'};base64,${b64(b)}`;
    } catch (_) { return null; }
  };

  for (const img of Array.from(doc.images || [])) {
    const v = img.getAttribute('src');
    if (!v) continue;
    const d = await toData(v);
    keep(() => img.setAttribute('src', v));
    if (d) img.setAttribute('src', d);
    else { note('an image could not be read (CORS) and is missing from the frame'); img.removeAttribute('src'); }
  }
  for (const cv of Array.from(doc.querySelectorAll('canvas'))) {
    try { cv.setAttribute('data-ag-snapshot', cv.toDataURL('image/png')); keep(() => cv.removeAttribute('data-ag-snapshot')); }
    catch (_) { note('a canvas holds cross-origin pixels and could not be captured'); }
  }
  for (const n of Array.from(doc.querySelectorAll('*'))) {
    const bi = doc.defaultView.getComputedStyle(n).backgroundImage;
    const m = /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(bi || '');
    if (!m || /^data:/i.test(m[1])) continue;
    const d = await toData(m[1]);
    if (d) { const was = n.style.backgroundImage; keep(() => { n.style.backgroundImage = was; }); n.style.backgroundImage = `url("${d}")`; }
    else note('a CSS background image could not be read (CORS) and is missing from the frame');
  }
}

/* ── @font-face rules whose files we can embed, so SVG text keeps the face ── */
async function collectFontFaces(doc, baseUrl, note){
  let out = '';
  for (const sheet of Array.from(doc.styleSheets || [])) {
    let rules = null;
    try { rules = sheet.cssRules; }
    catch (_) { note('a cross-origin stylesheet could not be inspected; its webfonts fall back to a system face'); continue; }
    for (const rule of Array.from(rules || [])) {
      if (rule.constructor.name !== 'CSSFontFaceRule') continue;
      let css = rule.cssText;
      const urls = new Set();
      css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, u) => { if (!/^data:/i.test(u)) urls.add(u); return m; });
      let allOk = true;
      for (const u of urls) {
        let full = null, d = null;
        try { full = new URL(u, sheet.href || baseUrl).href; } catch (_) {}
        if (full) {
          try {
            const r = await fetch(proxied(full) || full, { mode:'cors', credentials:'omit', cache:'force-cache' });
            if (r.ok) { const b = await r.arrayBuffer(); if (b.byteLength < 6e6) d = `data:font/woff2;base64,${b64(b)}`; }
          } catch (_) {}
        }
        if (d) css = css.split(u).join(d); else allOk = false;
      }
      if (allOk) out += css + '\n';
      else note('a webfont could not be embedded (CORS); that text falls back to a system face');
    }
  }
  return out;
}

/* ── the repaint ────────────────────────────────────────────────────────── */
const XESC = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function domToSvg(doc, W, H, fontCss, note){
  const win = doc.defaultView;
  const defs = [], body = [];
  let gid = 0;

  const cssColor = c => {
    const m = /^rgba?\(([^)]+)\)/i.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s));
    const a = p.length > 3 ? p[3] : 1;
    return a <= 0.002 ? null : { fill: `rgb(${p[0]|0},${p[1]|0},${p[2]|0})`, opacity: a };
  };

  const seen = new Set();
  const flag = (cond, msg) => { if (cond && !seen.has(msg)) { seen.add(msg); note(msg); } };

  /* linear-gradient(<angle|to side>, c1 [pos], c2 [pos], …) — the shape that
     actually turns up in lower thirds. Anything else is reported, not faked. */
  const gradient = bi => {
    const m = /linear-gradient\(([\s\S]+)\)\s*$/i.exec(bi.trim());
    if (!m) { flag(true, 'an unsupported background image (radial, conic or layered) was dropped'); return null; }
    const parts = m[1].split(/,(?![^(]*\))/).map(s => s.trim());
    let angle = 180;
    if (/^(to\s|[-\d.]+deg)/i.test(parts[0])) {
      const head = parts.shift();
      if (/deg/i.test(head)) angle = parseFloat(head);
      else {
        const dirs = { 'to top':0, 'to right':90, 'to bottom':180, 'to left':270,
                       'to top right':45, 'to right top':45, 'to bottom right':135, 'to right bottom':135,
                       'to bottom left':225, 'to left bottom':225, 'to top left':315, 'to left top':315 };
        const k = head.toLowerCase();
        angle = dirs[k] != null ? dirs[k] : 180;
      }
    }
    const stops = parts.map((p, i) => {
      const cm = /^(rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)\s*([\d.]+%)?/i.exec(p);
      return cm ? { c: cm[1], o: cm[2] || round(i / Math.max(1, parts.length - 1) * 100, 2) + '%' } : null;
    }).filter(Boolean);
    if (stops.length < 2) return null;
    const rad = (angle - 90) * Math.PI / 180;
    const id = 'agg' + (gid++);
    defs.push(`<linearGradient id="${id}" x1="${round(50 - Math.cos(rad) * 50,2)}%" y1="${round(50 - Math.sin(rad) * 50,2)}%" x2="${round(50 + Math.cos(rad) * 50,2)}%" y2="${round(50 + Math.sin(rad) * 50,2)}%">` +
      stops.map(s => `<stop offset="${s.o}" stop-color="${XESC(s.c)}"/>`).join('') + `</linearGradient>`);
    return `url(#${id})`;
  };

  const boxRect = (r, fill, cs, extra) => {
    const rad = parseFloat(cs.borderTopLeftRadius) || 0;
    return `<rect x="${round(r.left,2)}" y="${round(r.top,2)}" width="${round(r.width,2)}" height="${round(r.height,2)}"` +
           (rad ? ` rx="${round(Math.min(rad, r.width / 2, r.height / 2),2)}"` : '') +
           ` fill="${fill}"${extra || ''}/>`;
  };
  const imageTag = (r, href, fit) =>
    `<image x="${round(r.left,2)}" y="${round(r.top,2)}" width="${round(r.width,2)}" height="${round(r.height,2)}"` +
    ` preserveAspectRatio="${fit}" href="${XESC(href)}"/>`;

  function paint(node, out){
    if (node.nodeType === 3) return paintText(node, out);
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (/^(script|style|link|meta|title|head|template|noscript)$/.test(tag)) return;

    const cs = win.getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const alpha = parseFloat(cs.opacity);
    if (alpha <= 0.002) return;

    const r = node.getBoundingClientRect();
    const painted = r.width > 0.4 && r.height > 0.4;

    flag(cs.boxShadow && cs.boxShadow !== 'none', 'box shadows are not repainted');
    flag(cs.filter && cs.filter !== 'none', 'CSS filters are not repainted');
    flag(cs.mixBlendMode && cs.mixBlendMode !== 'normal', 'blend modes are not repainted');
    if (cs.transform && cs.transform !== 'none') {
      const mm = /matrix\(([^)]+)\)/.exec(cs.transform);
      const p = mm ? mm[1].split(',').map(Number) : null;
      const translateOnly = p && Math.abs(p[0] - 1) < 1e-3 && Math.abs(p[1]) < 1e-3 &&
                            Math.abs(p[2]) < 1e-3 && Math.abs(p[3] - 1) < 1e-3;
      flag(!translateOnly, 'a rotate or scale transform was flattened to its bounding box');
    }

    const group = [];
    if (painted) {
      const bg = cssColor(cs.backgroundColor);
      if (bg) group.push(boxRect(r, bg.fill, cs, bg.opacity < 1 ? ` fill-opacity="${round(bg.opacity,3)}"` : ''));

      const bi = cs.backgroundImage;
      if (bi && bi !== 'none') {
        const urlm = /url\(\s*["']?(data:[^"')]+)["']?\s*\)/i.exec(bi);
        if (urlm) group.push(imageTag(r, urlm[1],
          /cover/.test(cs.backgroundSize) ? 'xMidYMid slice' : /contain/.test(cs.backgroundSize) ? 'xMidYMid meet' : 'none'));
        else { const g = gradient(bi); if (g) group.push(boxRect(r, g, cs)); }
      }

      const bw = parseFloat(cs.borderTopWidth) || 0;
      if (bw > 0.2 && cs.borderTopStyle !== 'none') {
        const bc = cssColor(cs.borderTopColor);
        const uniform = [cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth]
          .every(v => Math.abs(parseFloat(v) - bw) < 0.2);
        if (bc && uniform) {
          const rad = parseFloat(cs.borderTopLeftRadius) || 0;
          group.push(`<rect x="${round(r.left + bw/2,2)}" y="${round(r.top + bw/2,2)}"` +
            ` width="${round(Math.max(0, r.width - bw),2)}" height="${round(Math.max(0, r.height - bw),2)}"` +
            (rad ? ` rx="${round(Math.max(0, rad - bw/2),2)}"` : '') +
            ` fill="none" stroke="${bc.fill}" stroke-width="${round(bw,2)}"` +
            (bc.opacity < 1 ? ` stroke-opacity="${round(bc.opacity,3)}"` : '') + `/>`);
        } else flag(!!bc, 'a border with uneven sides was not repainted');
      }

      if (tag === 'img' && node.getAttribute('src'))
        group.push(imageTag(r, node.getAttribute('src'),
          cs.objectFit === 'cover' ? 'xMidYMid slice' : cs.objectFit === 'contain' ? 'xMidYMid meet' : 'none'));

      if (tag === 'canvas' && node.getAttribute('data-ag-snapshot'))
        group.push(imageTag(r, node.getAttribute('data-ag-snapshot'), 'none'));

      if (tag === 'svg') {
        /* an inline SVG is already vector — carry it through untouched */
        const clone = node.cloneNode(true);
        clone.setAttribute('x', round(r.left, 2)); clone.setAttribute('y', round(r.top, 2));
        clone.setAttribute('width', round(r.width, 2)); clone.setAttribute('height', round(r.height, 2));
        group.push(new XMLSerializer().serializeToString(clone));
        out.push(alpha < 1 ? `<g opacity="${round(alpha,3)}">${group.join('')}</g>` : group.join(''));
        return;
      }
    }

    const kids = [];
    for (const child of Array.from(node.childNodes)) paint(child, kids);
    const all = group.concat(kids).join('');
    if (!all) return;
    out.push(alpha < 1 ? `<g opacity="${round(alpha,3)}">${all}</g>` : all);
  }

  /* Text is emitted line by line, positioned from the browser's own line boxes,
     so wrapping, alignment and letter-spacing land where the page put them. */
  function paintText(node, out){
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) return;
    const parent = node.parentElement;
    if (!parent) return;
    const cs = win.getComputedStyle(parent);
    const col = cssColor(cs.color);
    if (!col) return;
    const size = parseFloat(cs.fontSize) || 16;

    const range = doc.createRange();
    const lines = [];
    let cur = null;
    for (let i = 0; i < raw.length; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      const cr = range.getBoundingClientRect();
      if (!cr.width && !cr.height) continue;                 // collapsed whitespace
      if (!cur || Math.abs(cr.top - cur.top) > 1.5) { cur = { top: cr.top, bottom: cr.bottom, left: cr.left, text: raw[i] }; lines.push(cur); }
      else { cur.text += raw[i]; cur.bottom = Math.max(cur.bottom, cr.bottom); cur.left = Math.min(cur.left, cr.left); }
    }

    const deco = cs.textDecorationLine || '';
    for (const ln of lines) {
      const t = ln.text.replace(/\s+$/, '');
      if (!t.trim()) continue;
      out.push(`<text x="${round(ln.left,2)}" y="${round((ln.top + ln.bottom) / 2,2)}" dominant-baseline="central"` +
        ` font-family="${XESC(cs.fontFamily)}" font-size="${round(size,2)}px"` +
        (cs.fontWeight && cs.fontWeight !== '400' ? ` font-weight="${XESC(cs.fontWeight)}"` : '') +
        (cs.fontStyle && cs.fontStyle !== 'normal' ? ` font-style="${XESC(cs.fontStyle)}"` : '') +
        (cs.letterSpacing && cs.letterSpacing !== 'normal' ? ` letter-spacing="${XESC(cs.letterSpacing)}"` : '') +
        (/underline|line-through/.test(deco) ? ` text-decoration="${/underline/.test(deco) ? 'underline' : 'line-through'}"` : '') +
        ` fill="${col.fill}"${col.opacity < 1 ? ` fill-opacity="${round(col.opacity,3)}"` : ''}` +
        ` xml:space="preserve">${XESC(t)}</text>`);
    }
    flag(cs.textShadow && cs.textShadow !== 'none', 'text shadows are not repainted');
  }

  /* The page's own ground paints only if it is opaque; a template meant for a
     switcher normally leaves it transparent. */
  if (doc.body) {
    for (const n of [doc.documentElement, doc.body]) {
      const c = cssColor(win.getComputedStyle(n).backgroundColor);
      if (c) body.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${c.fill}"` +
        (c.opacity < 1 ? ` fill-opacity="${round(c.opacity,3)}"` : '') + `/>`);
    }
    for (const child of Array.from(doc.body.childNodes)) paint(child, body);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    (fontCss ? `<defs><style type="text/css">${fontCss.replace(/<\/?style/gi, '')}</style></defs>` : '') +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    body.join('') + `</svg>`;
}

function b64(buf){
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
