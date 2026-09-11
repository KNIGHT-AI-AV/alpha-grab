/* ═══════════════════════════════════════════════════════════════════════════
   Encoders. PNG / WebP / JPEG come from the browser; TGA and ZIP are written
   here so the tool stays a single file with no dependencies.
   ═══════════════════════════════════════════════════════════════════════════ */

function dataToCanvas(d){
  const cv = newCanvas(d.width, d.height);
  ctx2d(cv).putImageData(d, 0, 0);
  return cv;
}

function canvasToBlob(cv, mime, q){
  return new Promise((res, rej) => {
    cv.toBlob(b => b ? res(b) : rej(new AGError('The browser refused to encode that frame',
      `<code>${mime}</code> is not supported here, or the frame is larger than this browser will encode.`)), mime, q);
  });
}

/* ─────────────────────────── TGA (32-bit, uncompressed) ───────────────────────────
   Still the lingua franca for playout servers and media servers that predate
   PNG alpha handling — CasparCG, Resolume, Notch, older Ross/Chyron pipelines. */
function encodeTGA(d){
  const { width: w, height: h, data: p } = d;
  if (w > 65535 || h > 65535) throw new AGError('Too large for TGA', 'TGA stores its dimensions in 16 bits — 65535 px is the hard maximum per side.');
  const px = w * h * 4;
  const out = new Uint8Array(18 + px + 26);
  out[2] = 2;                        // uncompressed true-colour
  out[12] = w & 255; out[13] = w >> 8;
  out[14] = h & 255; out[15] = h >> 8;
  out[16] = 32;                      // bits per pixel
  out[17] = 0x28;                    // 8 alpha bits | top-down origin
  let o = 18;
  for (let i = 0; i < px; i += 4) {  // BGRA
    out[o++] = p[i+2]; out[o++] = p[i+1]; out[o++] = p[i]; out[o++] = p[i+3];
  }
  out.set([0,0,0,0, 0,0,0,0], o); o += 8;
  const sig = 'TRUEVISION-XFILE.';
  for (let i = 0; i < sig.length; i++) out[o++] = sig.charCodeAt(i);
  out[o++] = 0;
  return new Blob([out], { type: 'image/x-tga' });
}

/* ─────────────────────────── ZIP (stored, no compression) ───────────────────────────
   PNG and WebP are already compressed; deflating them again buys nothing and
   would cost a dependency. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function makeZip(entries){
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  const chunks = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const body = new Uint8Array(await e.blob.arrayBuffer());
    const crc = crc32(body);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, body.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, body);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, body.length, true); cd.setUint32(24, body.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);

    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true);
  eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(eo.buffer)], { type: 'application/zip' });
}

/* ─────────────────────────── fill / key split ───────────────────────────
   The broadcast delivery: one opaque RGB "fill" and one greyscale "key".
   Switchers and playout servers take them as a pair over two SDI paths. */
function makeFill(d, mode, matteHex){
  const out = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
  const p = out.data;
  const [mr, mg, mb] = hexToRgb(matteHex || '#000000');
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i+3] / 255;
    if (mode === 'overBlack')      { p[i] *= a; p[i+1] *= a; p[i+2] *= a; }
    else if (mode === 'overMatte') { p[i] = p[i]*a + mr*(1-a); p[i+1] = p[i+1]*a + mg*(1-a); p[i+2] = p[i+2]*a + mb*(1-a); }
    p[i+3] = 255;
  }
  return out;
}
function makeKey(d){
  const out = new ImageData(new Uint8ClampedArray(d.data.length), d.width, d.height);
  const p = out.data, s = d.data;
  for (let i = 0; i < s.length; i += 4) { const a = s[i+3]; p[i] = p[i+1] = p[i+2] = a; p[i+3] = 255; }
  return out;
}
function flatten(d, hex){
  const out = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
  const p = out.data, [r, g, b] = hexToRgb(hex);
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i+3] / 255;
    p[i] = p[i]*a + r*(1-a); p[i+1] = p[i+1]*a + g*(1-a); p[i+2] = p[i+2]*a + b*(1-a); p[i+3] = 255;
  }
  return out;
}

/* One frame → one blob, in the requested format. */
async function encodeFrame(d, fmtId, o){
  const fmt = AG.FORMATS.find(f => f.id === fmtId) || AG.FORMATS[0];
  if (fmt.id === 'tga') return { blob: encodeTGA(d), fmt };
  const src = fmt.alpha ? d : flatten(d, o.matteColor);
  const cv = dataToCanvas(src);
  const q = fmt.id === 'png' ? undefined : clamp(o.quality, 0.05, 1);
  const blob = await canvasToBlob(cv, fmt.mime, q);
  /* Chrome silently hands back a PNG when it cannot encode the mime you asked
     for. Trust the blob's own type, never the request. */
  if (fmt.id !== 'png' && blob.type !== fmt.mime)
    throw new AGError(`This browser cannot write ${fmt.label}`,
      `It returned <code>${blob.type || 'an unknown type'}</code> instead. Export PNG, or try a Chromium-based browser.`);
  return { blob, fmt };
}

async function copyToClipboard(d){
  if (!navigator.clipboard || !window.ClipboardItem)
    throw new AGError('Clipboard images are not available here',
      'This browser does not expose <code>ClipboardItem</code>. Firefox needs <code>dom.events.asyncClipboard.clipboardItem</code> enabled.');
  const blob = await canvasToBlob(dataToCanvas(d), 'image/png');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (e) {
    /* Permission denied, a page that has not been clicked yet, or a browser
       that only allows clipboard writes from a trusted gesture. Say which door
       is closed and name the one that is open. */
    throw new AGError('The browser would not let this page write to the clipboard',
      (e && e.name === 'NotAllowedError')
        ? 'Clipboard access was denied. Click once inside the page and try again, or allow clipboard permission for this site.'
        : `<code>${(e && e.message) || e}</code>`,
      'Download saves the same frame with no permission at all.');
  }
}
