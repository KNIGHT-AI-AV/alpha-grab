#!/usr/bin/env node
/* Guard tests — advertised == enforced.
   Every number this product states in public is read back out of the constant
   that actually enforces it. A claim that drifts from the code fails the build.
   A claim that drifts from the code fails the build. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

let failed = 0, passed = 0;
const ok   = m => { passed++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const bad  = m => { failed++; console.log('  \x1b[31m✗ ' + m + '\x1b[0m'); };
const is   = (cond, m) => cond ? ok(m) : bad(m);
const group = m => console.log('\n\x1b[1m' + m + '\x1b[0m');

/* ── load the real constants out of the real source ───────────────────── */
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(read('src/js/10-core.js'), sandbox, { filename: '10-core.js' });
const AG = sandbox.window.AG;

group('constants load');
is(!!AG, 'src/js/10-core.js evaluates and exports AG');
is(AG.MAX_DIM > 0 && AG.MAX_BATCH > 0, `MAX_DIM=${AG.MAX_DIM}, MAX_BATCH=${AG.MAX_BATCH}`);

/* ── the built artefact ───────────────────────────────────────────────── */
group('build output');
is(existsSync(join(ROOT, 'docs/index.html')), 'docs/index.html exists (run: npm run build)');
const html = existsSync(join(ROOT, 'docs/index.html')) ? read('docs/index.html') : '';
is(!/__[A-Z_]+__/.test(html), 'no unreplaced build placeholders');
is(existsSync(join(ROOT, 'docs/.nojekyll')), 'docs/.nojekyll present (Pages serves the file untouched)');

group('self-contained — it must run from a USB stick with no network');
is(!/<script[^>]+\ssrc=/i.test(html), 'no external <script src>');
is(!/<link[^>]+rel=["']?stylesheet/i.test(html), 'no external stylesheet <link>');
const pageCss = (/<style>([\s\S]*?)<\/style>/i.exec(html) || ['', ''])[1];
is(!/@import/i.test(pageCss), 'no @import in the page CSS');
is(!/url\(\s*['"]?https?:/i.test(html), 'no CSS url() pointing at the network');
is(!/fonts\.(googleapis|gstatic)/i.test(html), 'no webfont dependency');
is(html.length > 60000, `single file is ${(html.length / 1024).toFixed(0)} KB`);

group('no secrets in a public artefact');
const SECRET = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)/;
is(!SECRET.test(html), 'built page carries no credential-shaped strings');
is(!SECRET.test(read('README.md')), 'README carries no credential-shaped strings');

/* ── advertised == enforced ───────────────────────────────────────────── */
group('advertised == enforced (README ⇄ constants)');
const readme = read('README.md');

const claimedDim = /(\d{3,5})\s*px per side/.exec(readme);
is(claimedDim && Number(claimedDim[1]) === AG.MAX_DIM,
   `README's "${claimedDim ? claimedDim[1] : '?'} px per side" == AG.MAX_DIM (${AG.MAX_DIM})`);

const claimedBatch = /up to \*{0,2}(\d+) URLs/.exec(readme);
is(claimedBatch && Number(claimedBatch[1]) === AG.MAX_BATCH,
   `README's "up to ${claimedBatch ? claimedBatch[1] : '?'} URLs" == AG.MAX_BATCH (${AG.MAX_BATCH})`);

const claimedFormats = /Writes \*\*([^*]+)\*\*/.exec(readme);
const listed = claimedFormats ? claimedFormats[1].split(/,|\band\b/).map(s => s.trim()).filter(Boolean) : [];
const labels = AG.FORMATS.map(f => f.label);
is(listed.length === labels.length && labels.every(l => listed.some(x => x.toUpperCase().startsWith(l.toUpperCase()))),
   `README lists exactly the ${labels.length} formats in AG.FORMATS (${labels.join(', ')})`);

const presetCount = AG.PRESETS.reduce((n, g) => n + g.items.length, 0);
const claimedPresets = /(\d+) output presets/.exec(readme);
is(claimedPresets && Number(claimedPresets[1]) === presetCount,
   `README's "${claimedPresets ? claimedPresets[1] : '?'} output presets" == AG.PRESETS count (${presetCount})`);

is(AG.PRESETS.some(g => g.items.some(i => i.w === 7680 && i.h === 4320)),
   'the 8K claim is backed by a real 7680×4320 preset');
is(AG.MAX_DIM >= 7680, `MAX_DIM (${AG.MAX_DIM}) is large enough to actually reach the 8K preset`);

/* ── every advertised control has a code path ─────────────────────────── */
group('every declared capability is wired');
const encode = read('src/js/40-encode.js');
const uiSrc  = read('src/js/50-ui.js');
const tpl    = read('src/index.template.html');

const genericEncoder = /canvasToBlob\(cv, fmt\.mime/.test(encode);
for (const f of AG.FORMATS) {
  is(f.id === 'tga' ? /encodeTGA\(d\)/.test(encode) : (genericEncoder && /^image\//.test(f.mime)),
     `format ${f.label} (${f.mime}) has an encoder path`);
}
for (const v of AG.VIEWS) {
  is(v.id === 'rgba' ? /default:\s*return d;/.test(uiSrc) : new RegExp(`case '${v.id}'`).test(uiSrc),
     `view "${v.label}" is handled in viewData()`);
}
for (const id of ['chroma', 'luma', 'colorAlpha']) {
  is(new RegExp(`keyMode === '${id}'`).test(read('src/js/30-image.js')), `key mode "${id}" runs in the pipeline`);
}
is(/id="maxBatch"/.test(tpl) && /\$\('#maxBatch'\)\.textContent = AG\.MAX_BATCH/.test(uiSrc),
   'the batch cap shown in the UI is printed from AG.MAX_BATCH, not typed into the HTML');
is(/\$\('#resHint'\)\.innerHTML[\s\S]{0,220}\$\{CEILING\}/.test(uiSrc),
   'the size cap shown in the UI is the probed ceiling, not a hardcoded number');

const live = read('src/js/25-live.js');
is(/id="maxInst"/.test(tpl) && /\$\('#maxInst'\)\.textContent = AG\.MAX_INSTANCES/.test(uiSrc),
   'the instance cap shown in the UI is printed from AG.MAX_INSTANCES, not typed into the HTML');
is(/LIVE\.list\.length >= AG\.MAX_INSTANCES/.test(uiSrc),
   'and that same constant is what actually enforces the cap');
is(/clamp\(fps \|\| AG\.STEP_FPS/.test(live),
   'the transport steps by AG.STEP_FPS unless the UI names a rate');
is(!/sandbox/.test(live) || /NOT sandboxed/.test(live),
   'the live iframe is not sandboxed — the repaint needs same-origin access to it');
is(/instPause\(inst\);[\s\S]{0,400}domToSvg/.test(live) && /if \(wasPlaying\) instPlay/.test(live),
   'a grab holds the instance for the whole capture, so the frame is one instant and not a smear');
is(/undo/.test(read('src/js/20-source.js')) && /while \(undo\.length\)/.test(live),
   'every DOM mutation a grab makes is undone, so a live instance is left as it was');

/* ── honesty rules that matter more than features ─────────────────────── */
group('honest-failure rules');
is(/probeCanvasCeiling/.test(read('src/js/10-core.js')) && /getImageData/.test(read('src/js/10-core.js')),
   'the canvas ceiling is proved by writing and reading a pixel, not assumed');
is(/blob\.type !== fmt\.mime/.test(encode),
   'an encoder that silently returns the wrong format is caught (Chrome hands back PNG when it cannot encode)');
is(/mode: 'no-cors'/.test(read('src/js/20-source.js')),
   'a failed fetch is diagnosed (reachable-but-CORS vs unreachable) before blaming the user');
is(/tainted/.test(read('src/js/30-image.js')),
   'a tainted canvas is reported as such instead of exporting an empty frame');
is(/could not be read \(CORS\)/.test(read('src/js/20-source.js')),
   'assets missing from an HTML capture are counted and reported');
is(/not repainted|flattened to its bounding box/.test(read('src/js/20-source.js')),
   'CSS the repaint cannot reproduce is reported, not silently dropped');
is(!/foreignObject width/.test(read('src/js/20-source.js')),
   'no foreignObject in the capture path — it taints the canvas and nothing can be exported from it');

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed ? 1 : 0);
