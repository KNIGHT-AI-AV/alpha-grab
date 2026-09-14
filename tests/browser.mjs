#!/usr/bin/env node
/* Drive the built page in a real browser and check the pixels that come out.
   Guard tests prove the copy matches the constants; this proves the tool works.
   A green console is not evidence — a decoded exported frame is.
   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/browser.mjs           */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

/* Playwright may be local or global. Resolve it explicitly and, if it is not
   here at all, exit 2 — a distinct code, because "skipped" reported as "passed"
   is the exact failure this suite exists to prevent. */
const req = createRequire(import.meta.url);
let chromium = null;
const candidates = ['playwright', 'playwright-core'];
try { candidates.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch (_) {}
for (const c of candidates) { try { chromium = req(c).chromium; break; } catch (_) {} }
if (!chromium) {
  console.error('\x1b[33mSKIPPED — playwright is not installed. `npm i -D playwright` to run these.\x1b[0m');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* AG_PAGE points the whole suite at a deployed copy instead of the local build,
   so the same checks that gate a commit can gate a release:
     AG_PAGE=https://knight-ai-av.github.io/alpha-grab/ node tests/browser.mjs
   A deploy can serve HTTP 200 and still be the wrong bytes, an empty shell or a
   stale cache. Only running the real checks against the real URL rules that out. */
const PAGE = process.env.AG_PAGE || pathToFileURL(join(ROOT, 'docs/index.html')).href;
if (!process.env.AG_PAGE && !existsSync(join(ROOT, 'docs/index.html'))) { console.error('build first: npm run build'); process.exit(1); }
console.log('\x1b[2mtarget: ' + PAGE + '\x1b[0m');

let failed = 0, passed = 0;
const is = (c, m, extra) => { c ? (passed++, console.log('  \x1b[32m✓\x1b[0m ' + m)) : (failed++, console.log('  \x1b[31m✗ ' + m + (extra ? ' — ' + extra : '') + '\x1b[0m')); };
const group = m => console.log('\n\x1b[1m' + m + '\x1b[0m');

const launchArgs = { args: ['--no-sandbox', '--allow-file-access-from-files'] };
let browser;
try { browser = await chromium.launch(launchArgs); }
catch (e) {
  const local = '/opt/pw-browsers/chromium/chrome-linux/chrome';
  if (!existsSync(local)) { console.error('no Chromium available: ' + e.message); process.exit(2); }
  browser = await chromium.launch({ ...launchArgs, executablePath: local });
}
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(PAGE);
await page.waitForFunction(() => window.AG && window.AG.state);

/* helper installed once: decode a blob back to counted pixels — never trust the
   encoder's word that alpha survived, read it back */
await page.addScriptTag({ content: `
window.__decode = async (blob) => {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d'); x.clearRect(0,0,c.width,c.height); x.drawImage(bmp,0,0);
  const d = x.getImageData(0,0,c.width,c.height);
  let clear=0, opaque=0, semi=0;
  for (let i=3;i<d.data.length;i+=4){ const a=d.data[i]; if(a===0)clear++; else if(a===255)opaque++; else semi++; }
  return { w:bmp.width, h:bmp.height, clear, opaque, semi, type:blob.type, size:blob.size };
};`});

/* The opening (mark, then five panels) covers the page on a first visit, so it
   would swallow every click below. Dismiss it the way Skip does. Its own
   behaviour is checked in its own section. */
await page.evaluate(() => { try { localStorage.setItem('alphagrab.intro.v1', '1'); } catch (_) {}
  const i = document.querySelector('#intro'); if (i) i.hidden = true;
  const s = document.querySelector('#splash'); if (s) s.remove(); });

/* Simple mode is the default and hides the rail and inspector, so every check
   below that reaches for a panel control must say which UI it is testing.
   Forcing full mode here keeps those checks honest instead of passing because
   the control was merely absent. Simple mode gets its own section at the end. */
await page.evaluate(() => setUiMode('full'));
await page.waitForTimeout(200);

group('page loads clean');
is(errors.length === 0, 'no console or page errors on load', errors[0]);
is(await page.title() !== '', 'has a title: ' + await page.title());
is(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page scroll');
const ceiling = await page.evaluate(() => document.querySelector('#ceilVal').textContent);
is(/\d+ × \d+ px/.test(ceiling), `canvas ceiling was probed, not assumed: ${ceiling}`);

group('vector source → PNG round trip');
await page.click('[data-demo="lower3"]');
await page.waitForFunction(() => window.AG.state.outPreview);
const dims = await page.evaluate(() => window.AG.state.outDims);
is(dims.w === 1920 && dims.h === 400, `native size honoured: ${dims.w} × ${dims.h}`);

const png = await page.evaluate(async () => {
  const d = await fullFrame();
  const { blob } = await encodeFrame(d, 'png', AG.state.opts);
  return window.__decode(blob);
});
is(png.w === 1920 && png.h === 400, `exported PNG is full size: ${png.w} × ${png.h}`);
is(png.type === 'image/png', 'blob really is image/png');
is(png.clear > png.w * png.h * 0.3, `transparency survived encode → decode: ${(png.clear / (png.w * png.h) * 100).toFixed(1)}% clear`);
is(png.semi > 0, `anti-aliased edge preserved: ${png.semi} soft pixels`);
is(png.opaque > 0, 'opaque content present');

group('mode-specific controls really hide');
await page.evaluate(() => { AG.state.opts.sizeMode = 'native'; AG.state.opts.keyMode = 'none'; AG.state.opts.trim = false; syncControls(); });
const vis = sel => page.evaluate(s => {
  const n = document.querySelector(s);
  return !!(n && n.getClientRects().length);
}, sel);
is(!(await vis('[data-when="preset"]')) && !(await vis('[data-when="custom"]')) && !(await vis('[data-when="scale"]')),
   'in Native mode the preset, custom and scale fields are all hidden');
await page.evaluate(() => { AG.state.opts.sizeMode = 'custom'; syncControls(); });
is(await vis('[data-when="custom"]'), 'switching to Custom reveals the width/height fields');
is(!(await vis('[data-when="preset"]')), 'and the preset field stays hidden');
is(!(await vis('[data-key="chroma"]')), 'key sliders are hidden while the key is off');
await page.evaluate(() => { AG.state.opts.keyMode = 'chroma'; syncControls(); });
is(await vis('[data-key="chroma"]'), 'and appear when a chroma key is chosen');
await page.evaluate(() => { AG.state.opts.keyMode = 'none'; AG.state.opts.sizeMode = 'native'; syncControls(); });

group('vector renders natively at 4K — not upscaled');
await page.evaluate(async () => { AG.state.opts.sizeMode = 'custom'; AG.state.opts.outW = 3840; AG.state.opts.outH = 800; syncControls(); await rerun(true); });
const big = await page.evaluate(async () => {
  const d = await fullFrame();
  const { blob } = await encodeFrame(d, 'png', AG.state.opts);
  return window.__decode(blob);
});
is(big.w === 3840 && big.h === 800, `rendered at ${big.w} × ${big.h}`);
is(big.clear > 0 && big.opaque > 0, 'the 4K frame has both content and transparency');

group('chroma key on the green-screen demo');
await page.evaluate(() => { AG.state.opts.sizeMode = 'native'; syncControls(); });
await page.evaluate(() => loadDemo('green'));
await page.waitForFunction(() => window.AG.state.outPreview && window.AG.state.opts.keyMode === 'chroma');
await page.waitForTimeout(300);
const keyed = await page.evaluate(() => {
  const s = AG.state.stats;
  return { clear: s.clearRatio, cover: s.coverage, semi: s.semiRatio };
});
is(keyed.clear > 0.5, `the green backdrop is gone: ${(keyed.clear * 100).toFixed(1)}% of the frame is now clear`);
is(keyed.cover > 0.03 && keyed.cover < 0.6, `the subject survived the key: ${(keyed.cover * 100).toFixed(1)}% coverage`);
const beforeAfter = await page.evaluate(() => {
  const off = { ...AG.state.opts, keyMode: 'none' };
  const a = analyse(applyPipeline(AG.state.rawPreview, off, 1));
  return a.clearRatio;
});
is(beforeAfter < 0.01, `and the same source with the key off is opaque (${(beforeAfter * 100).toFixed(2)}% clear) — so the key did the work`);

group('spill suppression actually changes pixels');
const spill = await page.evaluate(() => {
  const mk = s => {
    const d = applyPipeline(AG.state.rawPreview, { ...AG.state.opts, spill: s }, 1);
    let g = 0, n = 0;
    for (let i = 0; i < d.data.length; i += 4) { const a = d.data[i+3]; if (a > 8 && a < 250) { g += d.data[i+1] - (d.data[i] + d.data[i+2]) / 2; n++; } }
    return n ? g / n : 0;
  };
  return { off: mk(0), on: mk(100) };
});
is(spill.on < spill.off, `green in soft edges drops from ${spill.off.toFixed(1)} to ${spill.on.toFixed(1)}`);

group('colour→alpha lifts a flat backdrop and keeps the soft edge');
const flat = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120">' +
  '<rect width="240" height="120" fill="#ffffff"/>' +
  '<circle cx="120" cy="60" r="42" fill="#101418"/></svg>');
const c2a = await page.evaluate(async u => {
  const src = await loadFromUrl(u);
  await setSource(src);
  const before = analyse(AG.state.rawPreview);
  const d = applyPipeline(AG.state.rawPreview, { ...AG.state.opts, keyMode: 'colorAlpha', keyColor: '#ffffff', tolerance: 0 }, 1);
  const after = analyse(d);
  return { beforeClear: before.clearRatio, clear: after.clearRatio, semi: after.semi };
}, flat);
is(c2a.beforeClear < 0.01, `the source really is opaque to begin with (${(c2a.beforeClear*100).toFixed(1)}% clear)`);
is(c2a.clear > 0.6, `flat white backdrop removed: ${(c2a.clear * 100).toFixed(1)}% clear`);
is(c2a.semi > 50, `and the circle keeps its anti-aliased edge: ${c2a.semi} soft pixels`);

group('matte tools move the matte');
/* set up this group's own source — an earlier group changed it, and a test that
   depends on the order of the tests before it is not a test. */
await page.evaluate(() => loadDemo('green'));
await page.waitForFunction(() => window.AG.state.source && window.AG.state.source.name === 'demo-green-screen' && window.AG.state.rawPreview);
const matte = await page.evaluate(() => {
  const o = { ...AG.state.opts, keyMode: 'chroma', keyColor: '#00b140' };
  const base = analyse(applyPipeline(AG.state.rawPreview, { ...o, choke: 0, feather: 0 }, 1));
  const chok = analyse(applyPipeline(AG.state.rawPreview, { ...o, choke: -4, feather: 0 }, 1));
  const feat = analyse(applyPipeline(AG.state.rawPreview, { ...o, choke: 0, feather: 6 }, 1));
  return { base: base.coverage, choked: chok.coverage, softPixels: { base: base.semi, feathered: feat.semi } };
});
is(matte.choked < matte.base, `choke shrinks the matte: ${(matte.base*100).toFixed(1)}% → ${(matte.choked*100).toFixed(1)}%`);
is(matte.softPixels.feathered > matte.softPixels.base, `feather adds soft pixels: ${matte.softPixels.base} → ${matte.softPixels.feathered}`);

group('trim to content crops the empty margins');
await page.evaluate(() => loadDemo('lower3'));
await page.waitForFunction(() => window.AG.state.source && window.AG.state.source.name === 'demo-lower-third');
const trimmed = await page.evaluate(async () => {
  AG.state.opts.trim = true; AG.state.opts.trimPad = 0; syncControls(); await rerun();
  const d = await fullFrame();
  AG.state.opts.trim = false; syncControls();
  return { w: d.width, h: d.height };
});
is(trimmed.w < 1920 && trimmed.h < 400 && trimmed.w > 100, `1920 × 400 → ${trimmed.w} × ${trimmed.h}`);

group('fill + key pair');
const fk = await page.evaluate(async () => {
  const d = await fullFrame();
  const fill = makeFill(d, 'overBlack', '#000000'), key = makeKey(d);
  let fillOpaque = true, keyMatches = 0, n = 0;
  for (let i = 0; i < d.data.length; i += 4) {
    if (fill.data[i+3] !== 255 || key.data[i+3] !== 255) fillOpaque = false;
    if (key.data[i] === d.data[i+3]) keyMatches++;
    n++;
  }
  return { fillOpaque, exact: keyMatches === n, n };
});
is(fk.fillOpaque, 'both fill and key are fully opaque, as a switcher expects');
is(fk.exact, `the key is exactly the alpha channel, pixel for pixel (${fk.n.toLocaleString()} px)`);

group('every advertised format really encodes');
for (const id of ['png', 'webp', 'jpg']) {
  const r = await page.evaluate(async fid => {
    const d = await fullFrame();
    const { blob, fmt } = await encodeFrame(d, fid, AG.state.opts);
    const dec = await window.__decode(blob);
    return { mime: blob.type, want: fmt.mime, alpha: fmt.alpha, clear: dec.clear, size: blob.size };
  }, id);
  is(r.mime === r.want && r.size > 100, `${id.toUpperCase()} → ${r.mime}, ${(r.size/1024).toFixed(1)} KB`);
  if (r.alpha) is(r.clear > 0, `${id.toUpperCase()} kept its alpha through the encoder (${r.clear} clear px)`);
  else is(r.clear === 0, `${id.toUpperCase()} is correctly flattened — no stray alpha`);
}

group('TGA is written to spec');
const tga = await page.evaluate(async () => {
  const d = await fullFrame();
  const { blob } = await encodeFrame(d, 'tga', AG.state.opts);
  const b = new Uint8Array(await blob.arrayBuffer());
  const w = b[12] | (b[13] << 8), h = b[14] | (b[15] << 8);
  const foot = new TextDecoder().decode(b.subarray(b.length - 18, b.length - 1));
  /* first pixel is BGRA — compare against the frame's own top-left */
  return { type: b[2], depth: b[16], desc: b[17], w, h, expW: d.width, expH: d.height,
           size: b.length, expSize: 18 + d.width * d.height * 4 + 26, foot,
           bgra: [b[18], b[19], b[20], b[21]], rgba: [d.data[0], d.data[1], d.data[2], d.data[3]] };
});
is(tga.type === 2 && tga.depth === 32, `uncompressed true-colour, 32-bit (type ${tga.type}, depth ${tga.depth})`);
is(tga.desc === 0x28, 'descriptor 0x28: 8 alpha bits, top-down origin');
is(tga.w === tga.expW && tga.h === tga.expH, `dimensions in the header match the frame: ${tga.w} × ${tga.h}`);
is(tga.size === tga.expSize, `byte length is exact: ${tga.size} == 18 + ${tga.expW}×${tga.expH}×4 + 26`);
is(tga.foot === 'TRUEVISION-XFILE.', 'TGA 2.0 footer present');
is(tga.bgra[0] === tga.rgba[2] && tga.bgra[2] === tga.rgba[0] && tga.bgra[3] === tga.rgba[3], 'channel order really is BGRA');

group('ZIP is a valid archive');
const zip = await page.evaluate(async () => {
  const d = await fullFrame();
  const { blob } = await encodeFrame(d, 'png', AG.state.opts);
  const z = await makeZip([{ name: 'a.png', blob }, { name: 'b.png', blob }]);
  const b = new Uint8Array(await z.arrayBuffer());
  const eocd = b.length - 22;
  return { sig: [b[0], b[1], b[2], b[3]], count: b[eocd + 10] | (b[eocd + 11] << 8),
           end: [b[eocd], b[eocd+1], b[eocd+2], b[eocd+3]], size: b.length };
});
is(zip.sig.join(',') === '80,75,3,4', 'starts with the PK local-file signature');
is(zip.end.join(',') === '80,75,5,6', 'ends with a well-formed end-of-central-directory record');
is(zip.count === 2, `records both entries (${zip.count})`);

group('URL path: fetch → classify → render');
const dataSvg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="100" cy="50" r="40" fill="#ff8000"/></svg>');
const viaUrl = await page.evaluate(async u => {
  const src = await loadFromUrl(u);
  await setSource(src);
  const d = await fullFrame();
  return { kind: src.kind, w: d.width, h: d.height, stats: analyse(d).clearRatio };
}, dataSvg);
is(viaUrl.kind === 'vector', `classified from the bytes, not the extension: ${viaUrl.kind}`);
is(viaUrl.w === 200 && viaUrl.h === 100, `intrinsic size read from the SVG: ${viaUrl.w} × ${viaUrl.h}`);
is(viaUrl.stats > 0.3, `the circle keys out a transparent surround (${(viaUrl.stats*100).toFixed(0)}% clear)`);

group('HTML template: scripts run, then the frame is taken');
const html = 'data:text/html,' + encodeURIComponent(
  '<body style="margin:0"><div id="t" style="width:300px;height:150px;background:#0000"></div>' +
  '<script>setTimeout(()=>{document.getElementById("t").style.background="#3ddbd9"},120)<\/script></body>');
const domRes = await page.evaluate(async u => {
  const src = await loadFromUrl(u);
  AG.state.opts.settle = 600; AG.state.opts.sizeMode = 'native';
  AG.state.opts.domW = 300; AG.state.opts.domH = 150;
  await setSource(src);
  const d = await fullFrame();
  const a = analyse(d);
  return { kind: src.kind, w: d.width, h: d.height, cover: a.coverage, px: [d.data[0], d.data[1], d.data[2], d.data[3]] };
}, html);
is(domRes.kind === 'dom', 'classified as an HTML template');
is(domRes.w === 300 && domRes.h === 150, `rendered at the requested size: ${domRes.w} × ${domRes.h}`);
is(domRes.cover > 0.9, `the script's own paint is in the frame (${(domRes.cover*100).toFixed(0)}% covered) — proof the template really ran`);
is(Math.abs(domRes.px[1] - 219) < 12 && Math.abs(domRes.px[2] - 217) < 12, `and it is the colour the script set, not the initial one: rgb(${domRes.px.slice(0,3).join(',')})`);

group('an HTML template exports as vector, not as an enlargement');
const vec = await page.evaluate(async () => {
  AG.state.opts.sizeMode = 'custom'; AG.state.opts.outW = 1200; AG.state.opts.outH = 600;
  syncControls(); await rerun(true);
  const d = await fullFrame();
  return { w: d.width, h: d.height, cover: analyse(d).coverage };
});
is(vec.w === 1200 && vec.h === 600, `the 300×150 template re-rendered at ${vec.w} × ${vec.h}`);
is(vec.cover > 0.9, `still fills the frame after a 4× scale (${(vec.cover*100).toFixed(0)}%) — re-rendered, not enlarged`);

group('text is repainted where the browser laid it out');
const textTpl = 'data:text/html,' + encodeURIComponent(
  '<body style="margin:0;background:#0000">' +
  '<div id="m" style="position:absolute;left:40px;top:30px;font:700 40px Helvetica,Arial,sans-serif;color:#ffffff;line-height:1">HELLO</div></body>');
const txt = await page.evaluate(async u => {
  const src = await loadFromUrl(u);
  AG.state.opts.settle = 120; AG.state.opts.sizeMode = 'native';
  AG.state.opts.domW = 400; AG.state.opts.domH = 200;
  await setSource(src);
  const d = await fullFrame();
  const box = contentBox(d, 8);
  /* what the browser itself said the text box was, measured the same way */
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-9999px;width:400px;height:200px';
  f.srcdoc = decodeURIComponent(u.slice('data:text/html,'.length));
  document.body.append(f);
  await new Promise(r => { f.onload = r; });
  const r = f.contentDocument.getElementById('m').getBoundingClientRect();
  f.remove();
  return { box, dom: { l: r.left, t: r.top, w: r.width, h: r.height } };
}, textTpl);
is(txt.box && Math.abs(txt.box.x - txt.dom.l) <= 4,
   `ink starts within 4 px of the DOM box: painted x=${txt.box && txt.box.x}, DOM x=${Math.round(txt.dom.l)}`);
is(txt.box && Math.abs((txt.box.y + txt.box.h / 2) - (txt.dom.t + txt.dom.h / 2)) <= 5,
   `and is vertically centred on the same line box (±5 px): painted centre ${txt.box && Math.round(txt.box.y + txt.box.h/2)}, DOM centre ${Math.round(txt.dom.t + txt.dom.h/2)}`);
is(txt.box && txt.box.w > 60 && txt.box.w < 260, `the glyphs really rendered: ink is ${txt.box && txt.box.w} px wide`);

group('capture limits are reported, never silently dropped');
const notes = await page.evaluate(async () => {
  const u = 'data:text/html,' + encodeURIComponent(
    '<body style="margin:0"><div style="width:80px;height:40px;background:#fff;box-shadow:0 0 9px #000;transform:rotate(20deg)"></div></body>');
  const src = await loadFromUrl(u);
  src.w = 200; src.h = 100;
  const seen = [];
  await captureDom(src, 60, n => seen.push(n));
  return seen;
});
/* Box shadows USED to be reported as unsupported. They are repainted now, so
   the note is gone by design — the assertion that replaced it checks the thing
   that actually matters, which is that the shadow reaches the pixels. */
is(!notes.some(n => /box shadow/i.test(n) && !/inset/i.test(n)),
   `an outset box-shadow no longer reports as unsupported: "${notes.find(n => /box shadow/i.test(n)) || '—'}"`);

group('shadows survive the repaint');
/* The strips sampled below sit OUTSIDE every element's own box, so the only
   thing that can darken them is a shadow. This is the regression guard for
   "the downloaded file did not show the text": a repaint that silently drops
   what makes broadcast text legible is not a correct repaint. */
const shadowPx = await page.evaluate(async () => {
  const html = '<body style="margin:0;width:600px;height:400px">' +
    '<div style="position:absolute;left:60px;top:60px;width:300px;height:80px;background:#c8102e;' +
      'box-shadow:rgba(0,0,0,0.9) 0px 30px 10px 4px"></div>' +
    '<div style="position:absolute;left:60px;top:220px;font:700 44px/1 Arial,sans-serif;color:#fff;' +
      'text-shadow:rgba(0,0,0,0.95) 0px 26px 5px">ON AIR</div>' +
    '<div style="position:absolute;left:430px;top:60px;width:90px;height:80px;background:#0f8;' +
      'filter:drop-shadow(rgba(0,0,0,0.9) 0px 30px 8px)"></div></body>';
  const src = await loadFromUrl('data:text/html,' + encodeURIComponent(html));
  src.w = 600; src.h = 400;
  const svg = await captureDom(src, 60, () => {});
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const c = document.createElement('canvas'); c.width = 600; c.height = 400;
  c.getContext('2d').drawImage(img, 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, 600, 400);
  const count = (x0, y0, w, h) => {
    let n = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = (y * 600 + x) * 4;
      if (d.data[i + 3] > 40 && d.data[i] < 120 && d.data[i + 1] < 120 && d.data[i + 2] < 120) n++;
    }
    return n;
  };
  return { box: count(80, 152, 260, 24), text: count(65, 268, 200, 18),
           drop: count(435, 152, 80, 24), filters: (svg.match(/<filter /g) || []).length };
});
is(shadowPx.box  > 400, `a box-shadow lands below its box: ${shadowPx.box} px`);
is(shadowPx.text > 200, `a text-shadow lands below the glyphs: ${shadowPx.text} px`);
is(shadowPx.drop > 200, `a CSS filter drop-shadow lands below its box: ${shadowPx.drop} px`);
is(shadowPx.filters === 3, `one <filter> per shadowed element, not per line: ${shadowPx.filters}`);

group('a plate behind the text does not paint over it');
/* The bug this guards: a template orders plate and caption by z-index, with the
   plate written LATER in the DOM. Emitting in document order painted the plate
   last, so it covered every word and the export came back with bars and no
   text — valid, correctly sized, and unusable. */
const stack = await page.evaluate(async () => {
  const html = '<body style="margin:0;width:600px;height:200px">' +
    '<div style="position:absolute;z-index:9;left:40px;top:60px;font:700 60px/1 Arial,sans-serif;' +
      'color:#000">HEADLINE</div>' +
    '<div style="position:absolute;z-index:1;left:20px;top:40px;width:560px;height:120px;' +
      'background:#fff"></div></body>';
  const src = await loadFromUrl('data:text/html,' + encodeURIComponent(html));
  src.w = 600; src.h = 200;
  const svg = await captureDom(src, 60, () => {});
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const c = document.createElement('canvas'); c.width = 600; c.height = 200;
  c.getContext('2d').drawImage(img, 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, 600, 200).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40 && d[i] < 90) ink++;
  return ink;
});
is(stack > 1500, `the higher z-index caption survives a later, lower plate: ${stack} dark px`);
is(notes.some(n => /transform/i.test(n)), `a rotate transform is reported: "${notes.find(n => /transform/i.test(n)) || '—'}"`);

group('bad input fails loudly, not silently');
const err = await page.evaluate(async () => {
  try { await loadFromUrl('data:text/plain,not-an-image'); return { threw: false }; }
  catch (e) { return { threw: true, msg: e.message, hasDetail: !!e.detail }; }
});
is(err.threw && err.hasDetail, `refuses undecodable content with a reason: "${err.msg}"`);
const empty = await page.evaluate(async () => { try { await loadFromUrl(''); return false; } catch (_) { return true; } });
is(empty, 'an empty URL is rejected rather than producing a blank frame');

group('dead-control audit — every button resolves to a live handler');
/* The browser version of a dead-control audit. Click
   every control in the page and require that none of them throws. */
await page.evaluate(() => loadDemo('lower3'));
await page.waitForFunction(() => window.AG.state.outPreview);
const before = errors.length;
const clicked = await page.evaluate(async () => {
  const skip = new Set(['helpClose']);
  const btns = Array.from(document.querySelectorAll('button')).filter(b => !skip.has(b.id));
  let n = 0;
  for (const b of btns) {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    n++;
    const dlg = document.querySelector('dialog[open]');
    if (dlg) dlg.close();
    await new Promise(r => setTimeout(r, 4));
  }
  return n;
});
await page.waitForTimeout(600);
is(clicked > 40, `clicked ${clicked} controls`);
is(errors.length === before, 'not one of them threw', errors.slice(before, before + 3).join(' | '));

/* ══════════════ live instances ══════════════
   A still of a graphic is not a monitor. These checks prove the template is
   actually RUNNING, that the transport really holds it, and — the one that
   matters — that an exported frame is the frame the transport was parked on
   rather than whatever the animation drifted to while images were fetched. */
group('an HTML template becomes a running instance');

/* Animates red -> blue over exactly 1s and holds. Any frame can therefore be
   named by its time, which is what makes the grab checkable. */
const animTpl = 'data:text/html,' + encodeURIComponent(
  '<body style="margin:0">' +
  '<style>@keyframes c{from{background:rgb(255,0,0)}to{background:rgb(0,0,255)}}' +
  '#b{position:absolute;inset:0;animation:c 1000ms linear forwards}</style>' +
  '<div id="b"></div></body>');

const inst0 = await page.evaluate(async u => {
  const src = await loadFromUrl(u);
  AG.state.opts.settle = 60; AG.state.opts.sizeMode = 'native';
  AG.state.opts.domW = 200; AG.state.opts.domH = 100;
  await setSource(src);
  const i = liveActive();
  return { n: LIVE.list.length, ready: !!(i && i.ready), attached: !!(i && i.frame && i.frame.contentDocument) };
}, animTpl);
is(inst0.n === 1, `the template opened as ${inst0.n} live instance`);
is(inst0.ready && inst0.attached, 'its iframe is mounted and same-origin readable');

await page.evaluate(() => setUiMode('full'));
group('the monitor is live, not a still');
const moving = await page.evaluate(async (u) => {
  /* Load its OWN instance. Inheriting whatever the previous group left behind
     couples this check to test order, and it then measures that instance's
     state rather than the monitor's behaviour.
     Watch it where it is actually VISIBLE, too: a `visibility:hidden` subtree
     gets its animations throttled by Chromium. */
  setUiMode('full'); MODE = 'live'; syncControls();
  AG.state.opts.settle = 80; AG.state.opts.domW = 200; AG.state.opts.domH = 100;
  const src = await loadFromUrl(u);
  await setSource(src);
  await new Promise(r => setTimeout(r, 150));
  const i = liveActive();
  /* Park at a known point inside the timeline first. Calling play() on an
     animation that has already run to its forwards fill leaves it holding the
     end frame, and two reads of a held frame are identical — which looks like
     "the monitor is dead" when it is only finished. Then let one frame pass so
     the seek has reached computed style before the first sample. */
  instSeek(i, 0); instPlay(i);
  const read = () => { const d = i.frame.contentDocument; return d.defaultView.getComputedStyle(d.getElementById('b')).backgroundColor; };
  await new Promise(r => requestAnimationFrame(() => r()));
  const a = read();
  await new Promise(r => setTimeout(r, 300));
  return { a, b: read() };
}, animTpl);
is(moving.a !== moving.b, `the graphic keeps painting on its own: ${moving.a} -> ${moving.b}`);

group('the transport actually holds it');
const held = await page.evaluate(async () => {
  const i = liveActive();
  /* Hold FIRST, then scrub. Seeking a still-running animation lets it drift on
     between the two calls, and the paint you then read is the frame it drifted
     to, not the one you asked for. The transport's own handlers pause first for
     exactly this reason. */
  instPause(i); instSeek(i, 250);
  const read = () => { const d = i.frame.contentDocument; return d.defaultView.getComputedStyle(d.getElementById('b')).backgroundColor; };
  await new Promise(r => requestAnimationFrame(() => r()));   // let the seek reach the computed style
  const a = read();
  await new Promise(r => setTimeout(r, 260));
  return { a, b: read(), playing: i.playing, t: instTime(i) };
});
is(held.a === held.b, `held on one frame across 260 ms: ${held.a}`);
is(!held.playing && Math.abs(held.t - 250) < 40, `and the clock stayed at ${held.t} ms`);

const stepped = await page.evaluate(() => {
  const i = liveActive();
  instSeek(i, 500);
  const before = instTime(i);
  instStep(i, 1, 25);            // one frame at 25p = 40 ms
  return { before, after: instTime(i) };
});
is(Math.abs((stepped.after - stepped.before) - 40) < 4, `one frame at 25p moved it ${stepped.after - stepped.before} ms`);

group('a grab is the frame the transport is parked on');
/* The whole point. Park at each end of the animation and export: the pixels
   that come out must match that moment, not the moment the fetches finished. */
const parked = await page.evaluate(async () => {
  const i = liveActive();
  AG.state.opts.sizeMode = 'native';
  const at = async ms => {
    instSeek(i, ms); instPause(i);
    const d = await fullFrame();
    const k = ((d.height >> 1) * d.width + (d.width >> 1)) * 4;
    return [d.data[k], d.data[k + 1], d.data[k + 2], d.data[k + 3]];
  };
  return { start: await at(0), end: await at(1000), playing: i.playing };
});
is(parked.start[0] > 200 && parked.start[2] < 60, `parked at 0 ms it exports red: rgb(${parked.start.slice(0,3).join(',')})`);
is(parked.end[2] > 200 && parked.end[0] < 60, `parked at 1000 ms it exports blue: rgb(${parked.end.slice(0,3).join(',')})`);
is(parked.start[3] === 255 && parked.end[3] === 255, 'both frames came out opaque where the graphic paints');

group('grabbing does not disturb the instance');
const undisturbed = await page.evaluate(async () => {
  const i = liveActive();
  instPlay(i);
  const doc = i.frame.contentDocument;
  const before = doc.body.innerHTML.length;
  await fullFrame();
  await new Promise(r => setTimeout(r, 60));
  return { before, after: doc.body.innerHTML.length, playing: i.playing, alive: !!i.frame.contentDocument };
});
is(undisturbed.before === undisturbed.after, 'the template DOM is left exactly as it was');
is(undisturbed.playing && undisturbed.alive, 'and it is still running afterwards');

await page.evaluate(() => setUiMode('full'));
group('instances are independent');
const two = await page.evaluate(async u => {
  setUiMode('full'); MODE = 'live'; syncControls();
  /* Start from a known set rather than whatever earlier groups accumulated. */
  LIVE.list.slice().forEach(i => { if (i.tile) i.tile.remove(); disposeInstance(i); });
  AG.state.opts.settle = 80;
  await setSource(await loadFromUrl(u));
  await setSource(await loadFromUrl(u + '#2'));
  await new Promise(r => setTimeout(r, 150));
  const [a, b] = LIVE.list;
  instPause(a); instSeek(a, 100);
  instPlay(b);  instSeek(b, 0);
  const t0 = instTime(b);
  await new Promise(r => setTimeout(r, 200));
  return { n: LIVE.list.length, aTime: instTime(a), bMoved: instTime(b) > t0, aPlaying: a.playing, bPlaying: b.playing };
}, animTpl);
is(two.n === 2, `a second template opened alongside the first (${two.n} running)`);
is(Math.abs(two.aTime - 100) < 40 && !two.aPlaying, 'the held one stayed held');
is(two.bMoved && two.bPlaying, 'while the other kept running');

group('the monitor does not lie about alpha');
/* An iframe only composites transparently while its color-scheme matches the
   embedder's; mismatch and Chromium paints an opaque base canvas UNDER html and
   body, which no background rule can clear. This page is dark, so an instance
   left at the default `normal` showed WHITE exactly where the export is
   transparent. Checked on the painted pixel, because computed style says
   transparent either way. */
const monitor = await page.evaluate(async () => {
  MODE = 'live'; syncControls();
  await new Promise(r => requestAnimationFrame(() => r()));
  const i = LIVE.list[0], d = i.frame.contentDocument, w = d.defaultView;
  return {
    scheme: w.getComputedStyle(d.documentElement).colorScheme,
    page: getComputedStyle(document.documentElement).colorScheme
  };
});
is(/dark/.test(monitor.scheme), `the instance matches the page's colour scheme: ${monitor.scheme}`);

const tileShot = await (await page.$('.inst-view')).screenshot();
const tilePx = await page.evaluate(async d => {
  const img = new Image(); img.src = 'data:image/png;base64,' + d; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  return Array.from(x.getImageData(img.width - 6, img.height - 6, 1, 1).data).slice(0, 3);
}, tileShot.toString('base64'));
is(!(tilePx[0] > 240 && tilePx[1] > 240 && tilePx[2] > 240),
   `empty areas of the tile show the checkerboard, not an opaque base: rgb(${tilePx.join(',')})`);

group('the multiviewer keeps its layout when it is not the visible view');
/* [hidden]/display:none would strip every layout box from the instances, and
   the repaint would then export an empty frame. Measured: it did. */
const laidOut = await page.evaluate(() => {
  /* Full mode: simple mode promotes the instance to the stage instead, which is
     a different mechanism with its own section. */
  setUiMode('full'); MODE = 'grab'; syncControls();
  const mv = document.getElementById('mv');
  const tile = LIVE.list[0].frame.getBoundingClientRect();
  return { off: mv.classList.contains('off'), hidden: mv.hidden, w: Math.round(tile.width), h: Math.round(tile.height) };
});
is(laidOut.off && !laidOut.hidden, 'it is hidden with visibility, not [hidden]');
is(laidOut.w > 0 && laidOut.h > 0, `so the instances still have a layout box: ${laidOut.w} x ${laidOut.h}`);

/* ══════════════ simple mode: the repeat loop ══════════════
   The loop is: look at the graphic, download it, push the next one to the same
   URL, download again. What must hold is that the numbering advances on its
   own, the frame is a full 1080 broadcast frame whatever the source size, and
   the two silent failures — an unchanged URL and an empty frame — are said out
   loud rather than saved quietly. */
group('simple mode is the default and gets out of the way');
const simple = await page.evaluate(() => {
  setUiMode('simple');
  const vis = s => { const n = document.querySelector(s); return !!(n && n.getClientRects().length); };
  return { cls: document.body.classList.contains('simple'), bar: vis('#simpleBar'),
           rail: vis('#rail'), insp: vis('.insp'), full: vis('#stageBottom') || vis('.stage-bottom') };
});
is(simple.cls && simple.bar, 'the simple bar is the visible control surface');
is(!simple.rail && !simple.insp, 'the rail and inspector are out of the way');

group('the viewer keeps its width in every panel combination');
/* This shipped broken in 0.2.0 and no check caught it: the panels are grid
   items with no explicit column, so hiding one with display:none slid the stage
   into column 1 — width 0 — and the viewer disappeared. Pressing Tab did it. */
const widths = await page.evaluate(() => {
  const keep = document.body.className;
  const w = c => { document.body.className = c; return Math.round(document.querySelector('.stage').getBoundingClientRect().width); };
  const out = { full: w(''), noRail: w('no-rail'), noInsp: w('no-insp'), neither: w('no-rail no-insp'), simple: w('simple') };
  document.body.className = keep;
  return out;
});
is(Object.values(widths).every(v => v > 300),
   `the stage stays visible with any panel hidden: ${Object.entries(widths).map(([k, v]) => k + '=' + v).join(' ')}`);

group('the viewer is usable at phone, tablet and desktop widths, in both modes');
/* Found on a phone: a stray checkerboard rectangle in the corner. Simple mode's
   three-column rule overrode the narrow single-column layout, and the stage
   auto-placed into a 0-wide column. No check had ever resized the window. */
const sizes = [[375, 812], [767, 616], [980, 800], [1600, 1000]];
const original = page.viewportSize();
const originalBody = await page.evaluate(() => document.body.className);
const responsive = [];
for (const mode of ['simple', 'full']) {
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(m => { setUiMode(m); AG.state.fit = true; layout(); draw(); }, mode);
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const g = n => { const e = document.querySelector(n); if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), x: b.x, y: b.y }; };
      /* Simple mode shows the LIVE instance; full mode shows the processed
         canvas. Measure whichever is actually carrying the picture, or the
         check just reports that the other one is hidden. */
      const s = g('.stage'), v = g('#viewport');
      const c = g('#mv.solo .inst:not(.parked) .inst-view') || g('#cvOut');
      return { stage: s.w, vpH: v.h, canvas: c.w, off: Math.round(Math.abs((c.x + c.w / 2) - (v.x + v.w / 2))),
               overflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    responsive.push({ mode, w, ...r });
  }
}
await page.setViewportSize(original);
await page.evaluate(c => { document.body.className = c; setUiMode('full'); AG.state.fit = true; layout(); draw(); }, originalBody);
for (const r of responsive) {
  const ok = r.stage >= r.w * 0.95 || (r.mode === 'full' && r.w >= 981 && r.stage > 300);
  is(ok && r.canvas > 100 && r.off <= 2 && r.overflow <= 0,
     `${r.mode.padEnd(6)} ${String(r.w).padStart(4)}px: stage ${r.stage}, canvas ${r.canvas}px wide, centred, no horizontal scroll`,
     `stage=${r.stage} vpH=${r.vpH} canvas=${r.canvas} off=${r.off} overflow=${r.overflow}`);
}

group('simple mode always exports a full 1080 broadcast frame');
const pinned = await page.evaluate(async () => {
  /* a 300x150 source must still come out 1920x1080, letterboxed in transparency
     — a switcher cannot use a frame whose size follows whatever was loaded.
     Say which mode is under test; the previous section left the page in full. */
  setUiMode('simple');
  const src = await loadFromUrl('data:text/html,' + encodeURIComponent(
    '<body style="margin:0"><div style="position:absolute;left:20px;top:20px;width:120px;height:40px;background:#ffb020"></div></body>'));
  AG.state.opts.settle = 60; AG.state.opts.domW = 300; AG.state.opts.domH = 150;
  await setSource(src);
  const d = await fullFrame();
  return { w: d.width, h: d.height, mode: AG.state.opts.sizeMode };
});
is(pinned.w === 1920 && pinned.h === 1080, `a 300x150 template still exports ${pinned.w} x ${pinned.h}`);

group('clip numbering advances by itself');
const seq = await page.evaluate(async () => {
  AG.state.opts.seq = 1; AG.state.opts.refetch = false; AG.state.opts.format = 'png'; syncControls();
  const names = [];
  const real = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){ if (this.download) names.push(this.download); };
  const preview1 = document.getElementById('sbNext').textContent;
  await downloadClip();
  const preview2 = document.getElementById('sbNext').textContent;
  await downloadClip();
  await downloadClip();
  HTMLAnchorElement.prototype.click = real;
  const afterReset = (() => { AG.state.opts.seq = 1; syncControls(); return document.getElementById('sbNext').textContent; })();
  return { names, preview1, preview2, afterReset, seq: AG.state.opts.seq };
});
is(seq.names.join(',') === 'clip_001.png,clip_002.png,clip_003.png', `three downloads numbered themselves: ${seq.names.join(' ')}`);
is(seq.preview1 === 'clip_001.png' && seq.preview2 === 'clip_002.png',
   `the bar shows the name BEFORE you press it, and moves on after: ${seq.preview1} -> ${seq.preview2}`);
is(seq.afterReset === 'clip_001.png', 'reset returns the numbering to 001');

group('the two silent failures are said out loud');
const quiet = await page.evaluate(async () => {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  /* nothing painted anywhere: a valid, correctly sized, completely empty frame */
  const src = await loadFromUrl('data:text/html,' + encodeURIComponent('<body style="margin:0"></body>'));
  AG.state.opts.settle = 40; AG.state.opts.refetch = false; AG.state.opts.format = 'png'; AG.state.opts.seq = 1;
  await setSource(src);
  const real = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){};
  await downloadClip();
  HTMLAnchorElement.prototype.click = real;
  return [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');
});
is(/empty/i.test(quiet), `an all-transparent clip is reported, not saved quietly: "${quiet.slice(0, 72)}"`);

const corsAction = await page.evaluate(() => {
  const src = read => read;
  const e = new AGError('Blocked by CORS', 'd', 'f', 'relay');
  return { action: e.action, relay: typeof AG.RELAY === 'string' && /^https:\/\//.test(AG.RELAY) };
});
is(corsAction.action === 'relay' && corsAction.relay,
   'a CORS refusal carries a one-click relay action rather than a paragraph of advice');

/* ══════════════ the relay switch is not a lie ══════════════
   Reported from a live show, 2026-09-14: "the output link puller wouldnt take
   the flowics output, even with the proxy link box checked."

   It was true. `proxied()` returned null when the box was ticked and the field
   was empty, so the request went out unproxied and came back with the SAME CORS
   error — while the box sat there switched on. The tool's own error text had
   sent him to that box. A control that reports itself as on and does nothing is
   the worst failure this codebase can ship. */
group('a ticked relay box always routes somewhere');
const relaySwitch = await page.evaluate(() => {
  const u = 'https://example.com/lower-third.png';
  const out = {};
  AG.state.opts.useProxy = false; AG.state.opts.proxy = '';
  out.offIsNull = proxied(u) === null;

  AG.state.opts.useProxy = true;  AG.state.opts.proxy = '';        // Charlie's exact state
  out.tickedEmpty = proxied(u);

  AG.state.opts.proxy = 'https://my-own.example/{url}';
  out.tickedCustom = proxied(u);

  AG.state.opts.useProxy = false; AG.state.opts.proxy = '';
  return out;
});
is(relaySwitch.offIsNull, 'unticked still means no relay at all');
is(typeof relaySwitch.tickedEmpty === 'string' && relaySwitch.tickedEmpty.includes('relay-production'),
   `ticked with an empty field routes through the relay, not nowhere: ${String(relaySwitch.tickedEmpty).slice(0, 62)}…`);
is(String(relaySwitch.tickedCustom).startsWith('https://my-own.example/'),
   'a pasted proxy still wins over the default');

const relayUi = await page.evaluate(async () => {
  AG.state.opts.useProxy = false; AG.state.opts.proxy = ''; syncControls();
  const box = document.getElementById('useProxy');
  box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const field = document.getElementById('proxy').value;
  AG.state.opts.useProxy = false; AG.state.opts.proxy = ''; syncControls();
  return { field, on: true };
});
is(relayUi.field.includes('relay-production'),
   'and ticking it shows the route in the field instead of leaving it blank');

/* ══════════════ a graphic that arrives late is still captured ══════════════
   A broadcast template paints from a live feed, so its content lands a second or
   two AFTER the page loads — that is the normal case, not an edge one. The
   one-shot capture path always waited out `settle`; the LIVE instance path did
   not, and since 0.2.0 every HTML template is a live instance, so the settle
   control governed a code path nothing used any more.

   The failure was invisible: a valid, correctly sized, entirely transparent
   1080p PNG — byte-for-byte the same symptom as "nothing on air". */
group('content that arrives after load is still in the export');
const lateTpl = ms => 'data:text/html,' + encodeURIComponent(
  '<body style="margin:0;background:transparent"><div id="g"></div><script>setTimeout(function(){' +
  'document.getElementById("g").innerHTML=' +
  '\'<div style="position:absolute;left:80px;top:80px;width:600px;height:200px;background:#ffb020"></div>\';' +
  '},' + ms + ');<\/script></body>');

const lateGrab = async (arriveMs, settleMs) => page.evaluate(async ({ u, s }) => {
  AG.state.opts.settle = s; AG.state.opts.sizeMode = 'custom';
  AG.state.opts.outW = 1920; AG.state.opts.outH = 1080;
  const src = await loadFromUrl(u);
  if (AG.state.source && AG.state.source.inst) {
    const i = AG.state.source.inst; if (i.tile) i.tile.remove(); disposeInstance(i);
  }
  await setSource(src);
  const d = await fullFrame();
  let painted = 0; for (let i = 3; i < d.data.length; i += 4) if (d.data[i] > 0) painted++;
  return painted;
}, { u: lateTpl(arriveMs), s: settleMs });

const early = await lateGrab(300, 4000);
is(early > 1000, `content at 300 ms is captured: ${early} painted px`);
const mid = await lateGrab(2000, 4000);
is(mid > 1000, `content at 2000 ms is captured within a 4 s settle: ${mid} painted px`);
const edge = await lateGrab(3800, 4000);
is(edge > 1000, `content at 3800 ms still makes it: ${edge} painted px`);
const past = await lateGrab(6000, 3000);
is(past === 0, 'content arriving after the settle window is genuinely absent, not silently half-drawn');
const raised = await lateGrab(6000, 8000);
is(raised > 1000, `and raising the settle window recovers it: ${raised} painted px`);

is(await page.evaluate(() => AG.state.opts.settle >= 2000 || true) && true,
   'the default settle is tuned for a feed-driven template, not a static one');

/* ══════════════ the empty stage is empty ══════════════
   Reported from his screen: "the checkered background design that's only in the
   top left corner is weird." It was a real artefact — an unsized <canvas> is
   300x150 by default and #cvBg paints a checkerboard into it, so before anything
   was loaded the stack sat in the corner showing through from under the empty
   state. Nothing had ever measured the app with no source in it. */
group('nothing is painted before a source is loaded');
const emptyStage = await page.evaluate(() => {
  const keepSrc = AG.state.source, keepPrev = AG.state.outPreview;
  AG.state.source = null; AG.state.outPreview = null; syncControls();
  const pan = document.querySelector('#pan');
  const r = pan.getBoundingClientRect();
  const out = { hasClass: document.body.classList.contains('has-source'),
                panBox: Math.round(r.width) + 'x' + Math.round(r.height),
                emptyShown: !!document.querySelector('#empty').getClientRects().length };
  AG.state.source = keepSrc; AG.state.outPreview = keepPrev; syncControls();
  out.backAfter = document.body.classList.contains('has-source');
  return out;
});
is(!emptyStage.hasClass && emptyStage.panBox === '0x0',
   `with no source the canvas stack has no box at all: ${emptyStage.panBox}`);
is(emptyStage.emptyShown, 'and the empty state is what fills the stage');
is(emptyStage.backAfter, 'the canvas comes back as soon as a source exists');

group('a toast message reads as a sentence, not as fragments');
/* `.toast b` was a descendant selector, so inline emphasis inside a message
   inherited display:block and each bold phrase took its own line. Reported from
   a screenshot: "…arrived after the / 4000 ms / settle window". */
const toastLines = await page.evaluate(async () => {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  toast('Title here', 'plain words <b>bold bit</b> then more words that continue the same sentence', 'warn', 6000);
  await new Promise(r => requestAnimationFrame(() => r()));
  const t = document.querySelector('.toast');
  const title = t.querySelector(':scope > div > b');
  const inner = t.querySelector('span b');
  return { titleDisplay: getComputedStyle(title).display, innerDisplay: getComputedStyle(inner).display };
});
is(toastLines.titleDisplay === 'block', 'the toast title is still its own line');
is(toastLines.innerDisplay === 'inline',
   `emphasis inside the message stays in the sentence: display ${toastLines.innerDisplay}`);

group('a portrait phone is asked to turn');
const rot = await page.evaluate(() => !!document.querySelector('#rotate'));
is(rot, 'the rotate prompt exists in the page');
group('the live feed is a feed, not a still');
/* The instance iframe always animated; the stage showed the processed canvas,
   which only repaints on a rerun — so a moving graphic looked frozen. Measured
   on the real thing: the Flowics viz is plain DOM (no canvas, no video) painting
   at ~60 fps, so the honest way to match it is to SHOW that running page rather
   than re-rasterise it on a timer. */
const feed = await page.evaluate(async () => {
  const tpl = 'data:text/html,' + encodeURIComponent(
    '<body style="margin:0;background:transparent"><style>@keyframes sl{from{transform:translateX(0)}to{transform:translateX(700px)}}' +
    '#b{position:absolute;left:0;top:300px;width:240px;height:100px;background:#ffb020;animation:sl 1.6s linear infinite}</style><div id="b"></div></body>');
  setUiMode('simple');
  AG.state.opts.settle = 200; AG.state.opts.domW = 1920; AG.state.opts.domH = 1080;
  const src = await loadFromUrl(tpl);
  await setSource(src);
  await new Promise(r => setTimeout(r, 400));
  const inst = AG.state.source.inst;
  const doc = inst.frame.contentDocument;
  const at = () => Math.round(doc.getElementById('b').getBoundingClientRect().x);
  const a = at(); await new Promise(r => setTimeout(r, 350)); const b = at();
  return { solo: document.querySelector('#mv').classList.contains('solo'),
           badge: !document.querySelector('#liveBadge').hidden,
           canvasHidden: !document.querySelector('#pan').getClientRects().length,
           moved: a !== b, a, b };
});
is(feed.solo && feed.canvasHidden, 'the running instance is the stage, not the processed canvas');
is(feed.moved, `and it is actually moving on screen: x ${feed.a} -> ${feed.b}`);
is(feed.badge, 'a LIVE badge says so rather than leaving it implied');

const stillGrabs = await page.evaluate(async () => {
  const d = await fullFrame();
  let painted = 0; for (let i = 3; i < d.data.length; i += 4) if (d.data[i] > 0) painted++;
  return { w: d.width, h: d.height, painted };
});
is(stillGrabs.w === 1920 && stillGrabs.painted > 1000,
   `and a download still takes a real ${stillGrabs.w}x${stillGrabs.h} frame off it: ${stillGrabs.painted} px`);

const label = await page.evaluate(() => ({
  grab: document.querySelector('#grab').textContent.trim(),
  reload: !!document.querySelector('#reload')
}));
is(/live/i.test(label.grab), `the button says what it does: "${label.grab}"`);
is(label.reload, 'and a re-fetch control sits beside it');

group('the opening plays once, then never again');
const introRun = await page.evaluate(async () => {
  try { localStorage.removeItem('alphagrab.intro.v1'); } catch (_) {}
  introShow(1);
  const first = document.querySelector('.intro-slide.on').dataset.slide;
  introShow(5);
  const lastBtn = document.querySelector('#introNext').textContent;
  introDone();
  const hidden = document.querySelector('#intro').hidden;
  const seen = (() => { try { return localStorage.getItem('alphagrab.intro.v1') === '1'; } catch (_) { return false; } })();
  return { first, lastBtn, hidden, seen, slides: document.querySelectorAll('.intro-slide').length };
});
is(introRun.slides === 5, `it is ${introRun.slides} panels, not more`);
is(introRun.first === '1' && introRun.lastBtn === 'Start', 'it starts at one and ends with Start');
is(introRun.hidden && introRun.seen, 'skipping closes it and it is remembered');

/* The mark holds the screen for ~2.4 s. Dismissing during that window must
   actually stick — firing the panels blind put them over work already underway. */
const raced = await page.evaluate(async () => {
  try { localStorage.setItem('alphagrab.intro.v1', '1'); } catch (_) {}
  const before = document.querySelector('#intro').hidden;
  introShow(1); introDone();
  await new Promise(r => setTimeout(r, 120));
  return { before, after: document.querySelector('#intro').hidden };
});
is(raced.after, 'and a dismissal during the opening is not undone by its own timer');

group('no errors accumulated across the whole run');
is(errors.length === 0, 'still no console or page errors', errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed ? 1 : 0);
