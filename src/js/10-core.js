/* ═══════════════════════════════════════════════════════════════════════════
   AlphaGrab — core constants, state, small utilities.
   © Knight AI+AV. Everything runs in the browser; nothing is uploaded.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const AG = window.AG = {
  VERSION: '__VERSION__',
  BUILD:   '__BUILD__',

  /* Advertised limits. tests/guard.mjs pins the marketing copy to these. */
  MAX_DIM: 8192,          // largest side offered by the UI (probe may allow more)
  MIN_DIM: 16,
  MAX_BATCH: 50,          // URLs per batch run
  SETTLE_MAX: 30000,      // ms an HTML template may run before capture
  MAX_INSTANCES: 8,       // live graphics running at once in the multiviewer
  STEP_FPS: 25,           // frame size the transport steps by, in fps
  SEQ_PAD: 3,             // clip numbering: 001, 002, ... up to SEQ_MAX
  SEQ_MAX: 999,

  /* A relay we run, offered ONLY when a host refuses to share its pixels and
     the visitor asks for it. Off by default: a relay sees every URL routed
     through it, and "nothing is uploaded" has to keep being true for anyone
     who never turns it on. It moves bytes; rendering, keying and encoding
     still happen in the browser. */
  RELAY: 'https://relay-production-057e.up.railway.app/p/{url}',

  /* Output formats offered in the export bar. */
  FORMATS: [
    { id:'png',  label:'PNG',  mime:'image/png',  ext:'png',  alpha:true,  note:'Lossless RGBA. The safe default everywhere.' },
    { id:'webp', label:'WebP', mime:'image/webp', ext:'webp', alpha:true,  note:'Lossy or lossless RGBA. Much smaller for web overlays.' },
    { id:'tga',  label:'TGA',  mime:'image/x-tga',ext:'tga',  alpha:true,  note:'32-bit uncompressed. CasparCG, Resolume, Notch, older playout.' },
    { id:'jpg',  label:'JPEG', mime:'image/jpeg', ext:'jpg',  alpha:false, note:'No alpha — flattened onto the matte colour you pick.' }
  ],

  /* Broadcast / AV output presets. */
  PRESETS: [
    { g:'Broadcast', items:[
      { n:'HD 1280×720',        w:1280, h:720  },
      { n:'HD 1920×1080',       w:1920, h:1080 },
      { n:'UHD 3840×2160',      w:3840, h:2160 },
      { n:'DCI 4K 4096×2160',   w:4096, h:2160 },
      { n:'8K 7680×4320',       w:7680, h:4320 }
    ]},
    { g:'Graphics', items:[
      { n:'Lower third 1920×400', w:1920, h:400 },
      { n:'Full-frame key 1920×1080', w:1920, h:1080 },
      { n:'Bug / logo 512×512',   w:512,  h:512  },
      { n:'Square 2048×2048',     w:2048, h:2048 }
    ]},
    { g:'Vertical / LED', items:[
      { n:'Vertical 1080×1920',   w:1080, h:1920 },
      { n:'Portrait UHD 2160×3840',w:2160,h:3840 },
      { n:'LED 1536×1536',        w:1536, h:1536 },
      { n:'Ribbon 3840×540',      w:3840, h:540  }
    ]}
  ],

  /* Preview backdrops — the classic "check my edges" set. */
  BACKDROPS: [
    { id:'checker', label:'Checker', css:null },
    { id:'black',   label:'Black',   css:'#000000' },
    { id:'white',   label:'White',   css:'#ffffff' },
    { id:'grey',    label:'Grey 18%',css:'#767676' },
    { id:'green',   label:'Green',   css:'#00b140' },   // SMPTE-ish key green
    { id:'blue',    label:'Blue',    css:'#0047bb' },
    { id:'magenta', label:'Magenta', css:'#ff00ff' }
  ],

  VIEWS: [
    { id:'rgba', label:'Result',  key:'1' },
    { id:'fill', label:'Fill',    key:'2' },
    { id:'key',  label:'Key',     key:'3' },
    { id:'split',label:'Fill|Key',key:'4' },
    { id:'src',  label:'Source',  key:'5' }
  ]
};

/* ─────────────────────────── tiny DOM helpers ─────────────────────────── */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (tag, props, kids) => {
  const n = document.createElement(tag);
  const p = props || {};
  /* `dataset` and `style` are read-only accessors — assigning over them throws. */
  for (const k of Object.keys(p)) {
    if (k === 'dataset') Object.assign(n.dataset, p[k]);
    else if (k === 'style' && typeof p[k] === 'object') Object.assign(n.style, p[k]);
    else n[k] = p[k];
  }
  (kids || []).forEach(k => n.append(k));
  return n;
};
const on = (n, ev, fn, o) => n && n.addEventListener(ev, fn, o);

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
const round = (v, p) => { const m = Math.pow(10, p || 0); return Math.round(v * m) / m; };

function bytes(n){
  if (n == null || !isFinite(n)) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return round(n / 1024, 1) + ' KB';
  return round(n / 1048576, 2) + ' MB';
}
function pct(v){ return round(v * 100, v < 0.01 ? 2 : 1) + '%'; }

function hexToRgb(hex){
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [0,0,0];
}
const rgbToHex = (r,g,b) => '#' + [r,g,b].map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('');

/* Safe filename fragment from a URL or file name. */
function slugName(input){
  let s = String(input || 'frame');
  try {
    if (/^(https?:)?\/\//i.test(s)) {
      const u = new URL(s, location.href);
      const last = u.pathname.split('/').filter(Boolean).pop();
      s = (last ? last.replace(/\.[a-z0-9]{1,5}$/i, '') : u.hostname);
    }
  } catch (_) {}
  s = s.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || 'frame').slice(0, 64);
}

/* Filename template. Tokens are documented in the Help dialog. */
function renderTemplate(tpl, ctx){
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const map = {
    name: ctx.name, w: ctx.w, h: ctx.h, ext: ctx.ext,
    date: `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}`,
    time: `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`,
    host: ctx.host || 'local', n: ctx.n == null ? '' : String(ctx.n).padStart(3,'0'),
    key: ctx.key || ''
  };
  let out = String(tpl || '{name}_{w}x{h}').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
  out = out.replace(/[\\/:*?"<>|]+/g, '-').replace(/-+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '');
  return (out || 'frame') + '.' + ctx.ext;
}

/* ─────────────────────────── toasts ─────────────────────────── */
function toast(title, msg, kind, ms){
  const box = $('#toasts');
  if (!box) return;
  const t = el('div', { className: 'toast' + (kind ? ' ' + kind : '') });
  const b = el('div', {}, []);
  b.append(el('b', { textContent: title }));
  if (msg) { const s = el('span'); s.innerHTML = msg; b.append(s); }
  t.append(b);
  box.append(t);
  const life = ms || (kind === 'err' ? 9000 : 4200);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, life);
  return t;
}

/* ─────────────────────────── busy overlay ─────────────────────────── */
let busyDepth = 0;
function busy(msg){
  busyDepth++;
  const m = $('#busyMsg'); if (m) m.textContent = msg || 'Working…';
  document.body.classList.add('busy');
  return () => {
    busyDepth = Math.max(0, busyDepth - 1);
    if (!busyDepth) document.body.classList.remove('busy');
  };
}
const raf = () => new Promise(r => requestAnimationFrame(() => r()));

/* ─────────────────────────── download ─────────────────────────── */
function saveBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ───────────────────── real canvas ceiling probe ─────────────────────
   Browsers disagree wildly on maximum canvas size and they fail SILENTLY:
   an oversized canvas allocates and then reads back as fully transparent.
   So probe by drawing a known pixel and reading it back. Never advertise a
   ceiling we have not actually written and read. */
function probeCanvasCeiling(){
  const test = n => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const x = c.getContext('2d', { willReadFrequently: true });
      if (!x) return false;
      x.fillStyle = '#ff8000';
      x.fillRect(n - 1, n - 1, 1, 1);
      const d = x.getImageData(n - 1, n - 1, 1, 1).data;
      c.width = c.height = 1;
      return d[0] === 255 && d[1] === 128 && d[3] === 255;
    } catch (_) { return false; }
  };
  let best = 1024;
  for (const n of [2048, 4096, 8192, 11586, 16384]) { if (test(n)) best = n; else break; }
  return best;
}

/* ─────────────────────────── app state ─────────────────────────── */
const S = AG.state = {
  source: null,          // { kind, name, url, mime, bytes, w, h, bitmap|svgText|domHTML }
  srcData: null,         // ImageData rendered at output size, pre-key
  outData: null,         // ImageData after key + matte ops
  stats: null,
  view: 'rgba',
  backdrop: 'checker',
  zoom: 1, fit: true, panX: 0, panY: 0,
  guides: false,
  picking: false,
  queue: [],
  opts: {
    /* resolution */
    sizeMode: 'native',        // native | preset | custom | scale
    presetIdx: '1|1',
    outW: 1920, outH: 1080,
    scale: 2,
    fitMode: 'contain',        // contain | cover | stretch
    resample: 'smooth',        // smooth | pixel
    padColor: '#00000000',
    /* key */
    keyMode: 'none',           // none | chroma | luma | colorAlpha
    keyColor: '#00b140',
    tolerance: 22, softness: 14, spill: 60,
    lumaLo: 6, lumaHi: 30, lumaInvert: false,
    /* matte */
    choke: 0, feather: 0, alphaGamma: 1, alphaGain: 1,
    premul: false, unpremul: false,
    trim: false, trimPad: 0, trimThreshold: 4,
    /* output */
    format: 'png', quality: 0.92, matteColor: '#000000',
    fillMode: 'straight',      // straight | overBlack | overMatte
    filename: '{name}_{w}x{h}',
    /* the repeat loop: same URL, new graphic pushed to it, download again.
       `clipName` carries {n}, which is `seq` zero-padded; `seq` advances on
       every saved clip and is persisted, so closing the tab does not restart
       the numbering mid-session. `refetch` is what makes the loop honest —
       without it Download would re-export the frame already in memory and hand
       back the same graphic under a new number, which looks exactly like
       working. */
    ui: 'simple',              // simple | full
    clipName: 'clip_{n}',
    seq: 1,
    refetch: true,
    /* fetch */
    proxy: '', useProxy: false, settle: 2500, autoRun: true,
    /* design canvas an HTML template lays out on before it is scaled */
    domW: 1920, domH: 1080
  }
};

/* Settings persistence — everything except the source itself. */
const LS_KEY = 'alphagrab.opts.v1';
function saveOpts(){
  try { localStorage.setItem(LS_KEY, JSON.stringify(S.opts)); } catch (_) {}
}
function loadOpts(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(S.opts, JSON.parse(raw));
  } catch (_) {}
}
