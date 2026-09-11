/* ═══════════════════════════════════════════════════════════════════════════
   UI: wiring, preview pipeline, export, batch, presets.
   ═══════════════════════════════════════════════════════════════════════════ */

const UI = {};
/* PROBED is what this browser proved it can write and read back; CEILING is what
   the product offers. The probe exists to LOWER the cap on a browser that cannot
   reach it — never to advertise past AG.MAX_DIM, which is the number the README
   and the guard tests are pinned to. */
let PROBED = AG.MAX_DIM, CEILING = AG.MAX_DIM;

/* ─────────────────────────── demo sources ───────────────────────────
   Bundled so the first click always works, with no network and no third
   party to depend on. */
const DEMOS = {
  lower3: { name:'demo-lower-third', svg:
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 400" width="1920" height="400">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0b0f14" stop-opacity=".97"/><stop offset="1" stop-color="#0b0f14" stop-opacity=".62"/>
    </linearGradient>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffc94a"/><stop offset="1" stop-color="#e39a06"/>
    </linearGradient>
  </defs>
  <rect x="120" y="120" width="1180" height="112" rx="8" fill="url(#b)"/>
  <rect x="120" y="120" width="13" height="112" fill="url(#g)"/>
  <rect x="120" y="240" width="880" height="56" rx="6" fill="#0b0f14" opacity=".84"/>
  <rect x="120" y="240" width="13" height="56" fill="#3ddbd9"/>
  <text x="168" y="196" font-family="Helvetica,Arial,sans-serif" font-size="60" font-weight="700" fill="#f2f6fb">ALEXANDRA OKONKWO</text>
  <text x="168" y="279" font-family="Helvetica,Arial,sans-serif" font-size="30" letter-spacing="4" fill="#9fb0c2">TECHNICAL DIRECTOR · STUDIO 2</text>
</svg>` },
  green: { name:'demo-green-screen', svg:
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <rect width="1920" height="1080" fill="#00b140"/>
  <rect width="1920" height="1080" fill="url(#v)"/>
  <defs><radialGradient id="v" cx=".5" cy=".42" r=".78">
    <stop offset="0" stop-color="#12c957" stop-opacity=".55"/><stop offset="1" stop-color="#008c33" stop-opacity=".55"/>
  </radialGradient></defs>
  <g>
    <ellipse cx="960" cy="430" rx="156" ry="188" fill="#c98d63"/>
    <path d="M700 1080c0-190 116-322 260-322s260 132 260 322z" fill="#1f3a6d"/>
    <path d="M866 600q94 46 188 0l-14 96q-80 34-160 0z" fill="#e8eef6"/>
    <ellipse cx="960" cy="360" rx="160" ry="120" fill="#2b1d15"/>
    <circle cx="905" cy="430" r="13" fill="#20140e"/><circle cx="1015" cy="430" r="13" fill="#20140e"/>
    <path d="M918 505q42 26 84 0" stroke="#7d4a35" stroke-width="9" fill="none" stroke-linecap="round"/>
  </g>
</svg>` }
};

/* ═══════════════════════════ boot ═══════════════════════════ */
function boot(){
  loadOpts();
  PROBED = probeCanvasCeiling();
  CEILING = Math.min(PROBED, AG.MAX_DIM);
  const cv = $('#ceilVal');
  if (cv) cv.textContent = `${PROBED} × ${PROBED} px probed · ${CEILING} offered`;
  $('#maxBatch').textContent = AG.MAX_BATCH;

  $('#maxInst').textContent = AG.MAX_INSTANCES;

  buildDynamicUI();
  bindControls();
  bindStage();
  bindKeys();
  bindDropAndPaste();
  bindLive();
  bindSimple();
  renderRecent();
  renderUserPresets();
  setUiMode(S.opts.ui || 'simple');
  syncControls();

  if (!readPermalink()) {
    const q = new URLSearchParams(location.search).get('url');
    if (q) { $('#url').value = q; grabUrl(q); }
  }
  layout();
}

/* ─────────────── dynamic control construction ─────────────── */
function buildDynamicUI(){
  /* resolution presets */
  const sel = $('#preset');
  AG.PRESETS.forEach((grp, gi) => {
    const og = el('optgroup', { label: grp.g });
    grp.items.forEach((it, ii) => og.append(el('option', { value: `${gi}|${ii}`, textContent: it.n })));
    sel.append(og);
  });

  /* view modes */
  const sv = $('#segView');
  AG.VIEWS.forEach(v => sv.append(el('button', { dataset:{ v: v.id }, textContent: v.label, title: `${v.label}  (${v.key})` })));

  /* formats */
  const sf = $('#segFormat');
  AG.FORMATS.forEach(f => sf.append(el('button', { dataset:{ v: f.id }, textContent: f.label, title: f.note })));

  /* backdrops */
  const bd = $('#backdrops');
  AG.BACKDROPS.forEach(b => {
    const btn = el('button', { className:'chip', dataset:{ v: b.id }, title: b.label });
    if (b.css) { btn.classList.add('swatch'); btn.style.background = b.css; btn.style.width = '22px'; btn.style.height = '22px'; btn.style.padding = '0'; }
    else btn.textContent = 'α';
    bd.append(btn);
  });

  /* key colour quick picks */
  const kp = $('#keyPresets');
  [['#00b140','Chroma green'],['#0047bb','Chroma blue'],['#ffffff','White'],['#000000','Black'],['#ff00ff','Magenta']]
    .forEach(([hex, label]) => {
      const b = el('button', { className:'chip swatch', title:label, dataset:{ hex } });
      b.style.background = hex; b.style.width = '22px'; b.style.height = '22px';
      kp.append(b);
    });
  on(kp, 'click', e => {
    const b = e.target.closest('[data-hex]'); if (!b) return;
    S.opts.keyColor = b.dataset.hex;
    if (S.opts.keyMode === 'none') S.opts.keyMode = b.dataset.hex === '#ffffff' || b.dataset.hex === '#000000' ? 'colorAlpha' : 'chroma';
    syncControls(); rerun();
  });
}

/* ─────────────── segmented-control helper ─────────────── */
function seg(id, get, set){
  const box = $(id);
  on(box, 'click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    set(b.dataset.v); syncControls(); rerun();
  });
  return () => $$('button[data-v]', box).forEach(b => b.classList.toggle('on', b.dataset.v === String(get())));
}
const segSyncs = [];

function bindControls(){
  const o = S.opts;
  segSyncs.push(seg('#segSize',     () => o.sizeMode, v => o.sizeMode = v));
  segSyncs.push(seg('#segFit',      () => o.fitMode,  v => o.fitMode = v));
  segSyncs.push(seg('#segResample', () => o.resample, v => o.resample = v));
  segSyncs.push(seg('#segKey',      () => o.keyMode,  v => o.keyMode = v));
  segSyncs.push(seg('#segView',     () => S.view,     v => S.view = v));
  segSyncs.push(seg('#segFormat',   () => o.format,   v => o.format = v));

  /* live sliders / inputs: key + matte only re-run the cheap half */
  const live = [
    ['#tolerance','tolerance',1],['#softness','softness',1],['#spill','spill',1],
    ['#lumaLo','lumaLo',1],['#lumaHi','lumaHi',1],
    ['#choke','choke',1],['#feather','feather',1],['#alphaGamma','alphaGamma',1],
    ['#alphaGain','alphaGain',1],['#trimPad','trimPad',1]
  ];
  live.forEach(([sel, key]) => on($(sel), 'input', e => { S.opts[key] = parseFloat(e.target.value); syncLabels(); rerun(); }));

  on($('#keyColor'), 'input', e => { S.opts.keyColor = e.target.value; rerun(); });
  on($('#lumaInvert'), 'change', e => { S.opts.lumaInvert = e.target.checked; rerun(); });
  on($('#trim'), 'change', e => { S.opts.trim = e.target.checked; syncControls(); rerun(); });
  on($('#premul'), 'change', e => { S.opts.premul = e.target.checked; rerun(); });
  on($('#unpremul'), 'change', e => { S.opts.unpremul = e.target.checked; rerun(); });

  /* resolution: these DO need a re-rasterise */
  on($('#preset'), 'change', e => { S.opts.presetIdx = e.target.value; S.opts.sizeMode = 'preset'; syncControls(); rerun(true); });
  on($('#scale'),  'input',  e => { S.opts.scale = parseFloat(e.target.value); syncLabels(); rerun(true); });
  let lock = true;
  on($('#lockAspect'), 'click', () => { lock = !lock; $('#lockAspect').classList.toggle('on', lock); });
  $('#lockAspect').classList.add('on');
  on($('#outW'), 'change', e => {
    const v = clamp(parseInt(e.target.value, 10) || 16, AG.MIN_DIM, CEILING);
    if (lock && S.source) S.opts.outH = clamp(Math.round(v * S.source.h / S.source.w), AG.MIN_DIM, CEILING);
    S.opts.outW = v; syncControls(); rerun(true);
  });
  on($('#outH'), 'change', e => {
    const v = clamp(parseInt(e.target.value, 10) || 16, AG.MIN_DIM, CEILING);
    if (lock && S.source) S.opts.outW = clamp(Math.round(v * S.source.w / S.source.h), AG.MIN_DIM, CEILING);
    S.opts.outH = v; syncControls(); rerun(true);
  });
  on($('#swapWH'), 'click', () => {
    const w = S.opts.outW; S.opts.outW = S.opts.outH; S.opts.outH = w;
    S.opts.sizeMode = 'custom'; syncControls(); rerun(true);
  });
  on($('#settle'), 'input', e => { S.opts.settle = parseInt(e.target.value, 10); syncLabels(); });
  on($('#settle'), 'change', () => { if (S.source && S.source.kind === 'dom') rerun(true); });
  on($('#domW'), 'change', e => { S.opts.domW = clamp(parseInt(e.target.value, 10) || 1920, 16, 16384); syncControls(); rerun(true); });
  on($('#domH'), 'change', e => { S.opts.domH = clamp(parseInt(e.target.value, 10) || 1080, 16, 16384); syncControls(); rerun(true); });

  on($('#quality'), 'input', e => { S.opts.quality = parseInt(e.target.value, 10) / 100; syncLabels(); saveOpts(); });
  on($('#filename'), 'change', e => { S.opts.filename = e.target.value.trim() || '{name}_{w}x{h}'; saveOpts(); });
  on($('#useProxy'), 'change', e => { S.opts.useProxy = e.target.checked; saveOpts(); });
  on($('#proxy'), 'change', e => { S.opts.proxy = e.target.value.trim(); saveOpts(); });

  on($('#resetKey'), 'click', () => {
    Object.assign(S.opts, { keyMode:'none', tolerance:22, softness:14, spill:60, lumaLo:6, lumaHi:30,
      lumaInvert:false, choke:0, feather:0, alphaGamma:1, alphaGain:1, trim:false, trimPad:0, premul:false, unpremul:false });
    syncControls(); rerun();
  });

  /* grab / files */
  on($('#grab'), 'click', () => grabUrl($('#url').value));
  on($('#url'), 'keydown', e => { if (e.key === 'Enter') grabUrl($('#url').value); });
  const openFile = () => $('#fileInput').click();
  on($('#btnFile'), 'click', openFile);
  on($('#btnFile2'), 'click', openFile);
  on($('#fileInput'), 'change', e => { const fs = Array.from(e.target.files || []); if (fs.length) takeFiles(fs); e.target.value = ''; });
  on($('#btnPaste'), 'click', pasteFromClipboard);

  /* export */
  on($('#btnSave'), 'click', () => exportFrame().catch(showError));
  on($('#btnFillKey'), 'click', () => exportFillKey().catch(showError));
  on($('#btnCopy'), 'click', () => doCopy().catch(showError));

  /* batch + presets */
  on($('#btnBatch'), 'click', () => runBatch().catch(showError));
  on($('#btnBatchClear'), 'click', () => { S.queue = []; renderQueue(); });
  on($('#btnSavePreset'), 'click', saveUserPreset);
  on($('#btnPermalink'), 'click', copyPermalink);

  /* panels + help */
  on($('#btnRail'), 'click', () => { document.body.classList.toggle('no-rail'); layout(); });
  on($('#btnInsp'), 'click', () => { document.body.classList.toggle('no-insp'); layout(); });
  on($('#btnHelp'), 'click', () => $('#help').showModal());
  on($('#helpClose'), 'click', () => $('#help').close());
  $$('[data-demo]').forEach(b => on(b, 'click', () => loadDemo(b.dataset.demo)));
}

/* ─────────────── control ⇄ state sync ─────────────── */
function syncLabels(){
  const o = S.opts;
  const set = (id, v) => { const n = $(id); if (n) n.textContent = v; };
  set('#vTol', o.tolerance); set('#vSoft', o.softness); set('#vSpill', o.spill + '%');
  set('#vLumaLo', o.lumaLo + '%'); set('#vLumaHi', o.lumaHi + '%');
  set('#vChoke', (o.choke > 0 ? '+' : '') + o.choke + ' px');
  set('#vFeather', o.feather + ' px'); set('#vGamma', round(o.alphaGamma, 2));
  set('#vGain', round(o.alphaGain, 2)); set('#vPad', o.trimPad + ' px');
  set('#vScale', round(o.scale, 1) + '×'); set('#vSettle', o.settle + ' ms');
  set('#vQuality', Math.round(o.quality * 100));
  if (S.source) {
    const t = targetSize(S.source, o, CEILING);
    const g = gcd(t.w, t.h);
    set('#vAspect', `${t.w/g}:${t.h/g}`);
  }
  saveOpts();
}
const gcd = (a, b) => b ? gcd(b, a % b) : (a || 1);

function syncControls(){
  const o = S.opts;
  segSyncs.forEach(f => f());
  if ($('#mv')) syncLiveView();
  if ($('#simpleBar')) syncSimple();
  const v = (id, val) => { const n = $(id); if (n && document.activeElement !== n) n.value = val; };
  v('#tolerance', o.tolerance); v('#softness', o.softness); v('#spill', o.spill);
  v('#lumaLo', o.lumaLo); v('#lumaHi', o.lumaHi);
  v('#choke', o.choke); v('#feather', o.feather); v('#alphaGamma', o.alphaGamma);
  v('#alphaGain', o.alphaGain); v('#trimPad', o.trimPad); v('#scale', o.scale);
  v('#settle', o.settle); v('#quality', Math.round(o.quality * 100));
  v('#keyColor', o.keyColor); v('#preset', o.presetIdx);
  v('#outW', o.outW); v('#outH', o.outH);
  v('#proxy', o.proxy); v('#filename', o.filename);
  v('#domW', o.domW); v('#domH', o.domH);
  $('#domOnly').hidden = !(S.source && S.source.kind === 'dom');
  const vd = $('#vDom'); if (vd) vd.textContent = `${o.domW} × ${o.domH}`;
  $('#lumaInvert').checked = o.lumaInvert; $('#trim').checked = o.trim;
  $('#premul').checked = o.premul; $('#unpremul').checked = o.unpremul;
  $('#useProxy').checked = o.useProxy;

  /* show only the fields that matter for the current mode */
  $$('[data-when]').forEach(n => { n.hidden = n.dataset.when !== o.sizeMode; });
  $$('[data-key]').forEach(n => { n.hidden = !n.dataset.key.split(' ').includes(o.keyMode); });
  $$('[data-when-trim]').forEach(n => { n.hidden = !o.trim; });
  $('#qualityWrap').hidden = o.format === 'png' || o.format === 'tga';

  $('#pKey').classList.toggle('active', o.keyMode !== 'none');
  $('#pMatte').classList.toggle('active', !!(o.choke || o.feather || o.trim || o.premul || o.unpremul || o.alphaGamma !== 1 || o.alphaGain !== 1));
  $('#pRes').classList.toggle('active', o.sizeMode !== 'native');
  $('#pSource').classList.toggle('active', !!S.source);

  const kh = { none:'No key. Whatever alpha the source already carries is kept exactly as it is.',
    chroma:'Keys on hue, so an unevenly lit backdrop still keys clean. Raise tolerance until the backdrop is gone, then soften the edge.',
    luma:'Keys on brightness alone. For graphics delivered on flat black or flat white.',
    colorAlpha:'Removes the colour and unmixes it out of anti-aliased edges — the right tool for a logo on a flat background.' }[o.keyMode];
  $('#keyHint').textContent = kh;

  const fmt = AG.FORMATS.find(f => f.id === o.format);
  $('#resHint').innerHTML = `Sizes are capped at <b>${CEILING}</b> px per side — the real ceiling this browser proved it can read back.`
    + (fmt && !fmt.alpha ? ' <b style="color:var(--amber)">JPEG has no alpha; the frame is flattened onto the matte colour.</b>' : '');
  syncLabels();
}

/* ═══════════════════════════ loading ═══════════════════════════ */
async function grabUrl(raw){
  if (!String(raw || '').trim()) { $('#url').focus(); return; }
  const done = busy('Fetching…');
  $('#grab').disabled = true;
  try {
    const src = await loadFromUrl(raw);
    pushRecent(src.url || raw);
    await setSource(src);
    toast('Grabbed', `${src.kind === 'dom' ? 'HTML template' : src.kind === 'vector' ? 'Vector' : 'Bitmap'} · ${bytes(src.bytes)}${src.via === 'proxy' ? ' · via proxy' : ''}`, 'ok');
  } catch (e) { showError(e); }
  finally { done(); $('#grab').disabled = false; }
}

async function takeFiles(files){
  if (files.length > 1) { S.queue = []; renderQueue(); }
  const done = busy('Reading…');
  try {
    for (const f of files.slice(0, AG.MAX_BATCH)) {
      const src = await loadFromFile(f);
      if (files.length === 1) { await setSource(src); }
      else { S.queue.push({ name: src.name, status: 'queued', src }); }
    }
    if (files.length > 1) {
      renderQueue();
      await setSource(S.queue[0].src);
      toast('Queued', `${S.queue.length} files ready — run the batch from the inspector.`, 'ok');
    }
  } catch (e) { showError(e); }
  finally { done(); }
}

async function loadDemo(id){
  const d = DEMOS[id]; if (!d) return;
  const buf = new TextEncoder().encode(d.svg);
  const dims = svgIntrinsicSize(d.svg);
  await setSource({ kind:'vector', name:d.name, url:'', bytes:buf.byteLength, mime:'image/svg+xml',
    svgText:d.svg, w:dims.w, h:dims.h, vector:true, via:'built-in' });
  if (id === 'green') { S.opts.keyMode = 'chroma'; S.opts.keyColor = '#00b140'; syncControls(); await rerun(); }
}

async function setSource(src){
  S.source = src;
  if (src.kind === 'dom') { src.w = S.opts.domW; src.h = S.opts.domH; }
  /* Simple mode owns the output frame (1920x1080) — a new source adopting its
     own size would silently change what a switcher receives mid-session. */
  if (S.opts.ui !== 'simple' && (S.opts.sizeMode === 'custom' || S.opts.sizeMode === 'native')) { S.opts.outW = src.w; S.opts.outH = src.h; }
  $('#empty').style.display = 'none';
  S.fit = true;

  /* An HTML template becomes a running instance the first time it is seen, and
     every later grab reads that same instance rather than reloading it. A
     still image has nothing to run, so it never becomes one. */
  if (src.kind === 'dom' && !src.inst) {
    try { await addInstance(src); }
    catch (e) { showError(e); }
  } else if (src.inst) {
    LIVE.selected = src.inst.id;
  }

  syncControls();
  await rerun(true);
}

/* ═══════════════════════ preview pipeline ═══════════════════════ */
let runToken = 0, pending = null;

function previewDims(w, h){
  const n = w * h;
  if (n <= PREVIEW_BUDGET) return { w, h, scale: 1 };
  const s = Math.sqrt(PREVIEW_BUDGET / n);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
}

/* rerun(true) re-rasterises the source; rerun() only re-applies key + matte. */
function rerun(reraster){
  if (pending) clearTimeout(pending);
  return new Promise(res => {
    pending = setTimeout(() => { pending = null; doRun(reraster).then(res).catch(e => { showError(e); res(); }); }, reraster ? 0 : 60);
  });
}

async function doRun(reraster){
  if (!S.source) return;
  const token = ++runToken;
  const full = targetSize(S.source, S.opts, CEILING);
  const pv = previewDims(full.w, full.h);
  S.full = full; S.previewScale = pv.scale;

  if (reraster || !S.rawPreview || S.rawPreview.width !== pv.w || S.rawPreview.height !== pv.h) {
    const heavy = S.source.kind === 'dom' || pv.w * pv.h > 2e6;
    const done = heavy ? busy(S.source.kind === 'dom' ? 'Running the template…' : 'Rendering…') : null;
    try {
      await raf();
      const opts = Object.assign({}, S.opts, { _refW: full.w });
      S.rawPreview = await rasterise(S.source, pv.w, pv.h, opts, n => toast('Heads up', n, 'err', 12000));
    } finally { if (done) done(); }
    if (token !== runToken) return;
  }

  const opts = Object.assign({}, S.opts, { _refW: full.w });
  S.outPreview = applyPipeline(S.rawPreview, opts, pv.scale);
  if (token !== runToken) return;

  S.stats = analyse(S.outPreview);
  draw();
  renderInfo();
}

/* ═══════════════════════════ drawing ═══════════════════════════ */
function viewData(){
  const d = S.outPreview;
  if (!d) return null;
  switch (S.view) {
    case 'fill': return makeFill(d, S.opts.fillMode, S.opts.matteColor);
    case 'key':  return makeKey(d);
    case 'src':  return S.rawPreview;
    case 'split': {
      const f = makeFill(d, 'overBlack', '#000000'), k = makeKey(d);
      const out = new ImageData(d.width * 2, d.height);
      const w2 = d.width * 2;
      for (let y = 0; y < d.height; y++) {
        out.data.set(f.data.subarray(y * d.width * 4, (y + 1) * d.width * 4), y * w2 * 4);
        out.data.set(k.data.subarray(y * d.width * 4, (y + 1) * d.width * 4), (y * w2 + d.width) * 4);
      }
      return out;
    }
    default: return d;
  }
}

function draw(){
  const d = viewData(); if (!d) return;
  const cv = $('#cvOut');
  cv.width = d.width; cv.height = d.height;
  cv.getContext('2d').putImageData(d, 0, 0);

  const trimmed = S.outPreview && (S.outPreview.width !== Math.round(S.full.w * S.previewScale) ||
                                   S.outPreview.height !== Math.round(S.full.h * S.previewScale));
  const outW = trimmed ? Math.round(S.outPreview.width / S.previewScale) : S.full.w;
  const outH = trimmed ? Math.round(S.outPreview.height / S.previewScale) : S.full.h;
  S.outDims = { w: outW, h: outH };
  const dispW = S.view === 'split' ? outW * 2 : outW;

  const bd = AG.BACKDROPS.find(b => b.id === S.backdrop);
  const bg = $('#cvBg');
  bg.className = bd.css ? '' : 'checker';
  bg.style.background = bd.css || '';
  $$('#backdrops .chip').forEach(c => c.classList.toggle('on', c.dataset.v === S.backdrop));

  if (S.fit) fitZoom(dispW, outH);
  const st = $('#stack');
  st.style.width  = Math.max(1, dispW * S.zoom) + 'px';
  st.style.height = Math.max(1, outH  * S.zoom) + 'px';
  $$('#stack canvas').forEach(c => { c.style.width = '100%'; c.style.height = '100%'; });
  $('#cvOut').style.imageRendering = (S.zoom > 2.2 && S.opts.resample === 'pixel') ? 'pixelated' : 'auto';
  applyPan();
  drawGuides(d.width, d.height, S.view === 'split');
  $('#zoomLbl').textContent = S.fit ? 'Fit' : Math.round(S.zoom * 100) + '%';
  $('#outsize').innerHTML = `<b>${outW}</b> × <b>${outH}</b>` + (S.previewScale < 1 ? ` <span style="color:var(--ink-3)">· preview ${Math.round(S.previewScale*100)}%</span>` : '');
}

function drawGuides(w, h, split){
  const c = $('#cvGuide');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.clearRect(0, 0, w, h);
  if (!S.guides) return;
  const unit = split ? w / 2 : w;
  const draws = split ? [0, w / 2] : [0];
  x.lineWidth = Math.max(1, Math.round(w / 900));
  for (const ox of draws) {
    x.strokeStyle = '#ffb02099';
    for (const f of [0.9, 0.8]) {
      const iw = unit * f, ih = h * f;
      x.strokeRect(ox + (unit - iw) / 2, (h - ih) / 2, iw, ih);
    }
    x.strokeStyle = '#3ddbd955';
    x.beginPath();
    for (let i = 1; i < 3; i++) {
      x.moveTo(ox + unit * i / 3, 0); x.lineTo(ox + unit * i / 3, h);
      x.moveTo(ox, h * i / 3);        x.lineTo(ox + unit, h * i / 3);
    }
    x.stroke();
    x.strokeStyle = '#ffffffaa';
    const cx = ox + unit / 2, cy = h / 2, s = Math.min(unit, h) * 0.03;
    x.beginPath(); x.moveTo(cx - s, cy); x.lineTo(cx + s, cy); x.moveTo(cx, cy - s); x.lineTo(cx, cy + s); x.stroke();
  }
}

/* ─────────────── zoom & pan ─────────────── */
function fitZoom(w, h){
  const vp = $('#viewport').getBoundingClientRect();
  const pad = 48;
  S.zoom = clamp(Math.min((vp.width - pad) / w, (vp.height - pad) / h), 0.01, 8);
  S.panX = S.panY = 0;
}
function applyPan(){
  const vp = $('#viewport').getBoundingClientRect();
  const st = $('#stack').getBoundingClientRect();
  const w = parseFloat($('#stack').style.width) || st.width;
  const h = parseFloat($('#stack').style.height) || st.height;
  $('#pan').style.transform = `translate(${(vp.width - w) / 2 + S.panX}px,${(vp.height - h) / 2 + S.panY}px)`;
}
function setZoom(z, cx, cy){
  const old = S.zoom;
  S.zoom = clamp(z, 0.02, 16);
  S.fit = false;
  if (cx != null) { const k = S.zoom / old; S.panX = (S.panX - cx) * k + cx; S.panY = (S.panY - cy) * k + cy; }
  draw();
}
function layout(){ if (S.source) { if (S.fit) draw(); else applyPan(); } }

function bindStage(){
  const vp = $('#viewport');
  on($('#zoomIn'),  'click', () => setZoom(S.zoom * 1.25));
  on($('#zoomOut'), 'click', () => setZoom(S.zoom / 1.25));
  on($('#zoomFit'), 'click', () => { S.fit = true; draw(); });
  on($('#zoom100'), 'click', () => { S.fit = false; S.panX = S.panY = 0; setZoom(1); });
  on($('#btnGuides'), 'click', () => { S.guides = !S.guides; $('#btnGuides').classList.toggle('on', S.guides); draw(); });
  on($('#backdrops'), 'click', e => { const b = e.target.closest('.chip'); if (b) { S.backdrop = b.dataset.v; draw(); } });
  on($('#pickColor'), 'click', togglePick);

  on(vp, 'wheel', e => {
    if (!S.source) return;
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    setZoom(S.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
  }, { passive: false });

  let drag = null;
  on(vp, 'pointerdown', e => {
    if (!S.source) return;
    if (S.picking) { pickAt(e); return; }
    drag = { x: e.clientX, y: e.clientY, px: S.panX, py: S.panY };
    vp.classList.add('grabbing'); vp.setPointerCapture(e.pointerId);
  });
  on(vp, 'pointermove', e => {
    if (!drag) return;
    S.panX = drag.px + (e.clientX - drag.x); S.panY = drag.py + (e.clientY - drag.y);
    S.fit = false; applyPan();
  });
  const end = () => { drag = null; vp.classList.remove('grabbing'); };
  on(vp, 'pointerup', end); on(vp, 'pointercancel', end);
  on(window, 'resize', () => layout());
}

function togglePick(){
  S.picking = !S.picking;
  $('#viewport').classList.toggle('pick', S.picking);
  $('#pickColor').classList.toggle('on', S.picking);
  if (S.picking) toast('Eyedropper', 'Click the frame to take the key colour from it.');
}
function pickAt(e){
  const r = $('#cvOut').getBoundingClientRect();
  const d = S.rawPreview; if (!d) return;
  const x = Math.floor((e.clientX - r.left) / r.width * d.width);
  const y = Math.floor((e.clientY - r.top) / r.height * d.height);
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
  const i = (y * d.width + x) * 4;
  S.opts.keyColor = rgbToHex(d.data[i], d.data[i+1], d.data[i+2]);
  if (S.opts.keyMode === 'none') S.opts.keyMode = 'chroma';
  togglePick(); syncControls(); rerun();
}

/* ═══════════════════════════ inspector ═══════════════════════════ */
function renderInfo(){
  const s = S.source, st = S.stats;
  if (!s || !st) return;
  const kind = { raster:'Bitmap', vector:'Vector (SVG)', dom:'HTML template' }[s.kind];
  const upscale = s.kind === 'raster' && S.outDims && (S.outDims.w > s.w || S.outDims.h > s.h);
  const rows = [
    ['Kind', kind], ['Source', `${s.w} × ${s.h}`], ['Output', `${S.outDims.w} × ${S.outDims.h}`],
    ['Fetched', s.via === 'local' ? 'local file' : s.via === 'built-in' ? 'built in' : s.via || '—'],
    ['Payload', bytes(s.bytes)], ['Type', s.mime || '—']
  ];
  $('#kvFrame').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  /* QC — every line is counted, none inferred */
  const q = [];
  const add = (cls, title, body) => q.push(
    `<div class="qc-item ${cls}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">${
      cls === 'ok' ? '<path d="M20 6 9 17l-5-5"/>' : cls === 'warn' ? '<path d="M12 8v5M12 17h.01"/><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/>' : '<path d="M18 6 6 18M6 6l12 12"/>'
    }</svg><div><b>${title}</b><span>${body}</span></div></div>`);

  if (!st.hasAlpha && st.allOpaque)
    add('bad', 'No transparency in this frame', 'Every pixel is fully opaque. If this was meant to be a transparent asset, it is not one — turn on a key, or the source itself is flat.');
  else if (st.clearRatio < 0.001)
    add('warn', 'Almost nothing is transparent', `Only ${pct(st.clearRatio)} of pixels are clear. Check that the key is doing what you think.`);
  else
    add('ok', 'Real alpha channel', `${pct(st.clearRatio)} fully clear, ${pct(st.semiRatio)} soft edge, ${pct(st.opaque / st.n)} solid.`);

  if (st.semi === 0 && st.clear > 0)
    add('warn', 'Hard-edged matte', 'No partially transparent pixels at all — edges will alias against a moving background. A little feather usually fixes it.');
  else if (st.semiRatio > 0.0002)
    add('ok', 'Soft edges present', `${st.semi.toLocaleString()} partially transparent pixels carry the anti-aliasing.`);

  if (st.likelyPremultiplied && !S.opts.premul)
    add('warn', 'Looks premultiplied already', 'No pixel is brighter than its own alpha, which straight alpha normally produces somewhere. If edges look dark over a light background, switch on <b>Un-premultiply input</b>.');

  if (S.opts.keyMode === 'chroma' && st.spillHint > 6)
    add('warn', 'Green still in the edges', `Soft pixels average ${round(st.spillHint,1)} above neutral on green. Raise spill suppression.`);

  if (upscale)
    add('warn', 'Enlarged past the source', `The source is ${s.w} × ${s.h}. Anything above that is interpolation, not detail. Vectors and HTML templates do not have this limit.`);
  else if (s.kind !== 'raster')
    add('ok', 'Rendered natively at output size', 'A vector source is rasterised at the size you asked for, so there is no upscaling at all.');

  if (st.box && st.box.w && (st.box.w < st.w * 0.92 || st.box.h < st.h * 0.92) && !S.opts.trim)
    add('warn', 'Empty margins', `Content occupies ${st.box.w} × ${st.box.h} of ${st.w} × ${st.h}. <b>Trim to content</b> would drop the rest.`);

  if (S.previewScale < 1)
    add('ok', 'Measured on the preview', `Counted at ${Math.round(S.previewScale * 100)}% scale for speed. The exported file is rebuilt at full size.`);

  $('#qc').innerHTML = q.join('');
  $('#covWrap').hidden = false;
  $('#vCov').textContent = pct(st.coverage);
  $('#covBar').style.width = clamp(st.coverage * 100, 0, 100) + '%';
  drawHisto(st.hist, st.n);
}

function drawHisto(hist, n){
  const c = $('#histo'); c.hidden = false;
  const x = c.getContext('2d');
  const w = c.width, h = c.height;
  x.clearRect(0, 0, w, h);
  const max = Math.max(1, ...hist);
  const bw = w / hist.length;
  for (let i = 0; i < hist.length; i++) {
    const v = Math.pow(hist[i] / max, 0.42) * (h - 8);
    const t = i / (hist.length - 1);
    x.fillStyle = `rgb(${Math.round(lerp(61,255,t))},${Math.round(lerp(219,176,t))},${Math.round(lerp(217,32,t))})`;
    x.fillRect(i * bw, h - v, Math.max(1, bw - 0.6), v);
  }
  x.fillStyle = '#6c7a8c'; x.font = '9px ui-monospace,monospace';
  x.fillText('α 0', 3, 10); x.textAlign = 'right'; x.fillText('255', w - 3, 10);
}

/* ═══════════════════════════ export ═══════════════════════════ */
async function fullFrame(onNote){
  if (!S.source) throw new AGError('Nothing to export', 'Grab a URL or open a file first.');
  const t = targetSize(S.source, S.opts, CEILING);
  const opts = Object.assign({}, S.opts, { _refW: t.w });
  const raw = await rasterise(S.source, t.w, t.h, opts, onNote);
  return applyPipeline(raw, opts, 1);
}

function nameFor(d, ext, extra){
  return renderTemplate(S.opts.filename, Object.assign({
    name: S.source.name, w: d.width, h: d.height, ext,
    host: (() => { try { return new URL(S.source.url).hostname.replace(/^www\./, ''); } catch (_) { return 'local'; } })()
  }, extra || {}));
}

async function exportFrame(){
  const done = busy('Rendering at full size…');
  try {
    await raf();
    const d = await fullFrame();
    const { blob, fmt } = await encodeFrame(d, S.opts.format, S.opts);
    const fn = nameFor(d, fmt.ext);
    saveBlob(blob, fn);
    toast('Saved', `<code>${fn}</code> · ${d.width} × ${d.height} · ${bytes(blob.size)}`, 'ok');
  } finally { done(); }
}

async function exportFillKey(){
  const done = busy('Building fill and key…');
  try {
    await raf();
    const d = await fullFrame();
    const fmt = AG.FORMATS.find(f => f.id === S.opts.format) || AG.FORMATS[0];
    const useFmt = fmt.id === 'tga' ? 'tga' : (fmt.alpha ? fmt.id : 'png');
    const pair = [
      { d: makeFill(d, 'overBlack', S.opts.matteColor), key: 'fill' },
      { d: makeKey(d), key: 'key' }
    ];
    for (const p of pair) {
      const { blob, fmt: f } = await encodeFrame(p.d, useFmt, S.opts);
      saveBlob(blob, nameFor(p.d, f.ext, { key: p.key, name: S.source.name + '_' + p.key }));
    }
    toast('Saved the pair', `Fill and key at ${d.width} × ${d.height}. The fill is composited over black — that is what a downstream keyer expects.`, 'ok');
  } finally { done(); }
}

async function doCopy(){
  const done = busy('Copying…');
  try { await raf(); await copyToClipboard(await fullFrame()); toast('Copied', 'PNG with alpha is on the clipboard.', 'ok'); }
  finally { done(); }
}

/* ═══════════════════════════ batch ═══════════════════════════ */
async function runBatch(){
  const typed = $('#batchUrls').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (typed.length) S.queue = typed.slice(0, AG.MAX_BATCH).map(u => ({ name: slugName(u), url: u, status: 'queued' }));
  if (!S.queue.length) { toast('Nothing queued', 'Paste one URL per line, or drop several files in.'); return; }
  if (typed.length > AG.MAX_BATCH) toast('Trimmed the list', `A batch is capped at ${AG.MAX_BATCH} URLs; the rest were left out.`);

  const done = busy('Batch…');
  const files = [];
  let failed = 0;
  try {
    for (let i = 0; i < S.queue.length; i++) {
      const row = S.queue[i];
      row.status = 'run'; renderQueue();
      $('#busyMsg').textContent = `Batch ${i + 1} of ${S.queue.length} — ${row.name}`;
      await raf();
      try {
        const src = row.src || await loadFromUrl(row.url);
        const t = targetSize(src, S.opts, CEILING);
        const opts = Object.assign({}, S.opts, { _refW: t.w });
        const d = applyPipeline(await rasterise(src, t.w, t.h, opts), opts, 1);
        const { blob, fmt } = await encodeFrame(d, S.opts.format, S.opts);
        files.push({ name: renderTemplate(S.opts.filename, { name: src.name, w: d.width, h: d.height, ext: fmt.ext, n: i + 1, host: 'batch' }), blob });
        row.status = 'done'; row.out = `${d.width}×${d.height}`;
      } catch (e) {
        row.status = 'err'; row.err = e.message || String(e); failed++;
      }
      renderQueue();
    }
    if (!files.length) { toast('Batch produced nothing', `All ${S.queue.length} sources failed. Open one on its own to see why.`, 'err'); return; }
    const seen = new Set();
    files.forEach(f => { let n = f.name, i = 2; while (seen.has(n)) n = f.name.replace(/(\.[^.]+)$/, `-${i++}$1`); seen.add(n); f.name = n; });
    const zip = await makeZip(files);
    saveBlob(zip, `alphagrab-batch-${files.length}.zip`);
    toast(failed ? 'Batch finished with failures' : 'Batch finished',
      `${files.length} frame${files.length > 1 ? 's' : ''} zipped${failed ? `, ${failed} failed — see the queue` : ''}. ${bytes(zip.size)}`, failed ? 'err' : 'ok');
  } finally { done(); }
}

function renderQueue(){
  $('#queue').innerHTML = S.queue.map(r =>
    `<div class="qrow ${r.status}"><span class="nm" title="${(r.url || r.name).replace(/"/g,'&quot;')}">${r.name}</span>` +
    `<span class="st">${r.status === 'err' ? 'failed' : r.status === 'done' ? (r.out || 'done') : r.status}</span></div>`).join('');
}

/* ═══════════════════════ presets & permalink ═══════════════════════ */
const PRESET_KEY = 'alphagrab.presets.v1';
const readPresets  = () => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); } catch (_) { return {}; } };
const writePresets = p => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch (_) {} };

function saveUserPreset(){
  const name = ($('#presetName').value || '').trim();
  if (!name) { toast('Name it first', 'Give the look a name so you can find it again.'); return; }
  const p = readPresets(); p[name] = Object.assign({}, S.opts); writePresets(p);
  $('#presetName').value = ''; renderUserPresets();
  toast('Preset saved', `<b>${name}</b> — stored in this browser only.`, 'ok');
}
function renderUserPresets(){
  const p = readPresets(), box = $('#userPresets');
  const names = Object.keys(p);
  box.innerHTML = names.length ? '' : '<span class="hint">No presets yet.</span>';
  names.forEach(n => {
    const c = el('button', { className:'chip', textContent:n, title:'Apply — shift-click to delete' });
    on(c, 'click', e => {
      if (e.shiftKey) { const all = readPresets(); delete all[n]; writePresets(all); renderUserPresets(); return; }
      Object.assign(S.opts, p[n]); syncControls(); rerun(true);
      toast('Applied', n, 'ok');
    });
    box.append(c);
  });
}

function copyPermalink(){
  const payload = { u: S.source && S.source.url ? S.source.url : ($('#url').value || ''), o: S.opts };
  const hash = '#s=' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const link = location.origin + location.pathname + hash;
  history.replaceState(null, '', hash);
  const fallback = () => { toast('Link ready', `Copy it from the address bar — the clipboard was refused.<br><code>${link.slice(0, 90)}…</code>`); };
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(link).then(() => toast('Link copied', 'It carries the source and every setting.', 'ok'), fallback);
  else fallback();
}

function readPermalink(){
  const m = /[#&]s=([^&]+)/.exec(location.hash);
  if (!m) return false;
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (p.o) Object.assign(S.opts, p.o);
    syncControls();
    if (p.u) { $('#url').value = p.u; grabUrl(p.u); return true; }
  } catch (_) { toast('That link is damaged', 'The settings in the address could not be read.', 'err'); }
  return false;
}

/* ═══════════════════════ recent URLs ═══════════════════════ */
const RECENT_KEY = 'alphagrab.recent.v1';
function pushRecent(u){
  if (!u) return;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) {}
  list = [u, ...list.filter(x => x !== u)].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (_) {}
  renderRecent();
}
function renderRecent(){
  let list = [];
  try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) {}
  $('#recentWrap').hidden = !list.length;
  const box = $('#recent'); box.innerHTML = '';
  list.forEach(u => {
    let label = u; try { const x = new URL(u); label = (x.pathname.split('/').filter(Boolean).pop() || x.hostname); } catch (_) {}
    const c = el('button', { className:'chip', textContent: label.slice(0, 26), title: u });
    on(c, 'click', () => { $('#url').value = u; grabUrl(u); });
    box.append(c);
  });
}

/* ═══════════════════════ drop, paste, keys ═══════════════════════ */
function bindDropAndPaste(){
  let depth = 0;
  on(window, 'dragenter', e => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
  on(window, 'dragover', e => e.preventDefault());
  on(window, 'dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
  on(window, 'drop', e => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) return takeFiles(files);
    const t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (t) { $('#url').value = t.trim(); grabUrl(t); }
  });
  on(window, 'paste', e => {
    if (/^(INPUT|TEXTAREA)$/.test((e.target.tagName || '')) && e.target.id !== 'url') return;
    const items = Array.from((e.clipboardData || {}).items || []);
    const img = items.find(i => i.type.startsWith('image/'));
    if (img) { e.preventDefault(); const f = img.getAsFile(); if (f) takeFiles([f]); return; }
    const txt = (e.clipboardData || {}).getData ? e.clipboardData.getData('text') : '';
    if (txt && /^https?:\/\//i.test(txt.trim())) { e.preventDefault(); $('#url').value = txt.trim(); grabUrl(txt); }
  });
}

async function pasteFromClipboard(){
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) { const b = await it.getType(type); return takeFiles([new File([b], 'clipboard.png', { type })]); }
      }
    }
    const t = navigator.clipboard && navigator.clipboard.readText ? await navigator.clipboard.readText() : '';
    if (t && /^https?:\/\//i.test(t.trim())) { $('#url').value = t.trim(); return grabUrl(t); }
    toast('Nothing usable on the clipboard', 'Copy an image or a URL first.');
  } catch (e) {
    toast('The clipboard was not readable', 'The browser refused permission. <kbd>Ctrl</kbd>+<kbd>V</kbd> into the page works without it.', 'err');
  }
}

function bindKeys(){
  on(window, 'keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName || '');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return exportFrame().catch(showError); }
    if (mod && e.key.toLowerCase() === 'c' && !typing && S.source) { e.preventDefault(); return doCopy().catch(showError); }
    if (typing) return;
    const k = e.key.toLowerCase();
    if (k === '?' || (e.shiftKey && k === '/')) { e.preventDefault(); $('#help').showModal(); }
    else if (k === 'o') { e.preventDefault(); $('#fileInput').click(); }
    else if (k === 'g') { $('#btnGuides').click(); }
    else if (k === 'k') { togglePick(); }
    else if (k === 'i') { document.body.classList.toggle('no-insp'); layout(); }
    else if (k === 's') { setUiMode(S.opts.ui === 'simple' ? 'full' : 'simple'); }
    else if (e.key === 'Enter' && S.opts.ui === 'simple' && S.source && document.activeElement !== $('#url')) {
      e.preventDefault(); downloadClip().catch(showError);
    }
    else if (k === 'r' && S.opts.ui === 'simple') { refreshSource(true).catch(showError); }
    else if (k === 'l') { MODE = MODE === 'live' ? 'grab' : 'live'; syncControls(); }
    else if (e.key === ' ' && MODE === 'live') {
      const i = liveActive(); if (i) { e.preventDefault(); i.playing ? instPause(i) : instPlay(i); syncTransport(); }
    }
    else if ((e.key === '[' || e.key === ']') && MODE === 'live') {
      const i = liveActive(); if (i) { instStep(i, e.key === '[' ? -1 : 1, stepFps()); syncTransport(); }
    }
    else if (e.key === 'Tab') { e.preventDefault(); document.body.classList.toggle('no-rail'); layout(); }
    else if (k === '0') { S.fit = true; draw(); }
    else if (k === '+' || k === '=') { setZoom(S.zoom * 1.25); }
    else if (k === '-') { setZoom(S.zoom / 1.25); }
    else {
      const v = AG.VIEWS.find(x => x.key === e.key);
      if (v && S.source) { S.view = v.id; syncControls(); draw(); }
    }
  });
}

/* ═══════════════════════════ errors ═══════════════════════════ */
function showError(e){
  if (!e) return;
  const detail = (e.detail || '') + (e.fix ? `<br><b style="color:var(--gold)">${e.fix}</b>` : '');
  const t = toast(e.message || 'Something went wrong', detail || (e.stack ? '' : String(e)), 'err');
  if (t && e.action === 'relay') addRelayAction(t);
  if (!(e instanceof AGError)) console.error('[AlphaGrab]', e);
}
window.addEventListener('error', ev => { if (ev.error) console.error('[AlphaGrab]', ev.error); });

/* ═══════════════════ multiviewer + transport ═══════════════════
   "Grab" is the processed frame you are about to export. "Live" is every
   instance running at once. They are two views of the same instances, not two
   modes with separate state — the selected tile IS the current source, so
   anything you do in the inspector applies to the graphic you are watching. */
let MODE = 'grab';
let mvTimer = null;

function bindLive(){
  const sm = $('#segMode');
  sm.append(el('button', { dataset:{ v:'grab' }, textContent:'Grab',
    title:'The processed frame you are exporting  (L)' }));
  sm.append(el('button', { dataset:{ v:'live' }, textContent:'Live',
    title:'Every graphic running at once, switcher-style  (L)' }));
  segSyncs.push(seg('#segMode', () => MODE, v => { MODE = v; }));

  on($('#tPlay'),    'click', () => { const i = liveActive(); if (!i) return; i.playing ? instPause(i) : instPlay(i); syncTransport(); });
  on($('#tStepB'),   'click', () => { const i = liveActive(); if (i) { instStep(i, -1, stepFps()); syncTransport(); } });
  on($('#tStepF'),   'click', () => { const i = liveActive(); if (i) { instStep(i,  1, stepFps()); syncTransport(); } });
  on($('#tScrub'),   'input', e => { const i = liveActive(); if (!i) return; instPause(i); instSeek(i, +e.target.value); syncTransport(); });
  on($('#tGrab'),    'click', () => rerun(true));
  on($('#tGrabAll'), 'click', () => grabAll().catch(showError));
  on($('#tFps'),     'change', syncTransport);

  /* The scrubber has to follow a running instance, but only while anyone can
     see it — a timer behind a hidden panel is pure waste on a show laptop. */
  mvTimer = setInterval(() => { if (MODE === 'live' && !document.hidden) syncTransport(true); }, 120);
  addEventListener('resize', () => { if (MODE === 'live') LIVE.list.forEach(fitTile); });
}

const stepFps = () => +($('#tFps') || {}).value || AG.STEP_FPS;

function setMode(v){ MODE = v; syncControls(); }

/* Called from syncControls so the two views never disagree about what is shown. */
function syncLiveView(){
  const live = MODE === 'live';
  /* .off, not [hidden]: the running instances are inside #mv, and an element
     with no layout box has no computed geometry for the repaint to read. */
  $('#mv').classList.toggle('off', !live);
  $('#transport').hidden = !live;
  $('#mvNone').style.display = LIVE.list.length ? 'none' : '';
  const empty = $('#empty');
  if (live) empty.style.display = 'none';
  else if (!S.source) empty.style.display = '';
  if (live) { renderMV(); syncTransport(); }
}

/* ── tiles ───────────────────────────────────────────────────────────── */

/* The iframe keeps its design size and is scaled by transform. Sizing the
   iframe to the tile instead would reflow the template, so you would be
   monitoring a layout you are not going to export. */
function fitTile(inst){
  if (!inst.frame || !inst.frame.parentElement) return;
  const view = inst.frame.parentElement;
  const w = view.clientWidth || 320;
  const s = w / inst.w;
  inst.frame.style.transform = `scale(${s})`;
  view.style.height = Math.round(inst.h * s) + 'px';
}

function renderMV(){
  const grid = $('#mvGrid');
  for (const inst of LIVE.list) {
    if (inst.tile && inst.tile.isConnected) { paintTileState(inst); continue; }

    const view = el('div', { className:'inst-view' });
    const badge = el('div', { className:'inst-badge' });
    view.append(badge);
    if (inst.frame) view.append(inst.frame);

    const head = el('div', { className:'inst-head' }, [
      el('span', { className:'inst-name', textContent: inst.name, title: inst.src.url || inst.name }),
      el('span', { className:'inst-dim',  textContent: `${inst.w}×${inst.h}` }),
      el('button', { className:'inst-x', textContent:'×', title:'Close this instance', ariaLabel:'Close instance' })
    ]);
    const tile = el('div', { className:'inst' }, [head, view]);

    on(head.querySelector('.inst-x'), 'click', e => {
      e.stopPropagation();
      tile.remove(); inst.tile = null; disposeInstance(inst); syncControls();
    });
    on(view, 'click', () => selectInstance(inst.id));

    inst.tile = tile; inst.badge = badge;
    grid.append(tile);
    fitTile(inst);
    paintTileState(inst);
  }
  /* drop tiles whose instance is gone */
  for (const t of Array.from(grid.children)) if (!LIVE.list.some(i => i.tile === t)) t.remove();
  $('#mvNone').style.display = LIVE.list.length ? 'none' : '';
  /* Measure AFTER the grid has laid out. A tile measured in the same frame it
     was appended reports the width it will have in a one-column grid, so the
     iframe ends up scaled for a tile that never existed. */
  requestAnimationFrame(() => LIVE.list.forEach(fitTile));
}

function paintTileState(inst){
  if (inst.tile) inst.tile.classList.toggle('sel', inst.id === LIVE.selected);
  if (!inst.badge) return;
  const b = inst.badge;
  b.className = 'inst-badge ' + (inst.scripted ? 'scripted' : inst.playing ? 'live' : 'held');
  b.textContent = inst.scripted ? 'SCRIPTED' : inst.playing ? 'LIVE' : 'HELD';
  b.title = inst.scripted
    ? 'This template animates from script, so the transport cannot hold it. A grab may not be the frame you saw.'
    : inst.playing ? 'Running' : 'Held on a frame';
}

/* Selecting a tile makes it the current source, so the inspector, the preview
   and the export bar all point at the graphic you just clicked. */
function selectInstance(id){
  const inst = liveById(id); if (!inst) return;
  LIVE.selected = id;
  LIVE.list.forEach(paintTileState);
  if (S.source !== inst.src) setSource(inst.src).catch(showError);
  else syncControls();
}

function syncTransport(quiet){
  const i = liveActive();
  const has = !!i;
  ['#tPlay','#tStepB','#tStepF','#tScrub','#tGrab','#tGrabAll','#tFps'].forEach(s => { const n = $(s); if (n) n.disabled = !has; });
  $('#tName').textContent = has ? i.name : '—';
  if (!has) { $('#tTime').textContent = '0.00s'; return; }

  const dur = instDuration(i), t = instTime(i);
  const scrub = $('#tScrub');
  scrub.max = Math.max(1, dur);
  if (document.activeElement !== scrub) scrub.value = Math.min(t, scrub.max);
  $('#tTime').textContent = (t / 1000).toFixed(2) + 's' + (dur ? ` / ${(dur / 1000).toFixed(2)}s` : '');
  $('#tPlay').textContent = i.playing ? 'Hold' : 'Run';
  if (!quiet) LIVE.list.forEach(paintTileState); else paintTileState(i);
}

/* ── adding + grabbing ───────────────────────────────────────────────── */

/* Every HTML template that loads becomes an instance. That is the whole point:
   a switcher does not reload a graphic to look at it twice. */
async function addInstance(src){
  if (LIVE.list.length >= AG.MAX_INSTANCES) {
    const oldest = LIVE.list.find(i => i.id !== LIVE.selected) || LIVE.list[0];
    if (oldest) { if (oldest.tile) oldest.tile.remove(); oldest.tile = null; disposeInstance(oldest); }
    toast('Instance limit', `Holding ${AG.MAX_INSTANCES} graphics; the oldest was closed.`, 'warn');
  }
  const inst = newInstance(src);
  LIVE.list.push(inst);
  LIVE.selected = inst.id;
  src.inst = inst;

  renderMV();                           // tile first, so the iframe mounts visible
  const view = inst.tile.querySelector('.inst-view');
  try {
    await mountInstance(inst, view);
    fitTile(inst);
  } catch (e) {
    inst.error = e; disposeInstance(inst); if (inst.tile) inst.tile.remove();
    throw e;
  }
  paintTileState(inst);
  syncTransport();
  return inst;
}

async function grabAll(){
  if (!LIVE.list.length) return;
  const keep = S.source, keepSel = LIVE.selected;
  const done = busy(`Grabbing ${LIVE.list.length} frames…`);
  let ok = 0;
  try {
    for (const inst of LIVE.list.slice()) {
      if (!inst.ready) continue;
      S.source = inst.src;
      try { await exportFrame(); ok++; } catch (e) { showError(e); }
    }
  } finally {
    S.source = keep; LIVE.selected = keepSel; done();
    syncControls();
  }
  toast('Grabbed', `${ok} of ${LIVE.list.length} instances exported.`, ok ? 'ok' : 'warn');
}

/* The one-click way out of a CORS refusal. Turning the relay on is a real
   decision — it routes the URL through a server we run — so it is offered here,
   in the moment it would help, with what it means said in the same breath, and
   never switched on quietly. */
function addRelayAction(t){
  if (!t) return;
  const row = el('div', { style: { marginTop: '9px', display: 'flex', gap: '8px', alignItems: 'center' } });
  const go = el('button', { className: 'btn primary sm', textContent: 'Use the relay' });
  const why = el('span', { style: { fontSize: '11px', color: 'var(--ink-3)' }, textContent: 'routes this URL through our server' });
  on(go, 'click', async () => {
    S.opts.proxy = AG.RELAY; S.opts.useProxy = true; saveOpts(); syncControls();
    t.remove();
    const url = ($('#url').value || '').trim() || (S.source && S.source.url);
    if (url) { try { await grabUrl(url); } catch (err) { showError(err); } }
    else toast('Relay on', 'Press Grab again.', 'ok');
  });
  row.append(go, why);
  t.append(row);
}

/* ═══════════════════ simple mode: the repeat loop ═══════════════════
   One job, done over and over: look at the graphic, download it, push the next
   one to the same URL, download again. Simple mode is that loop and nothing
   else — 1920x1080 out, alpha intact, the clip number doing the remembering.  */

function bindSimple(){
  on($('#btnSimple'), 'click', () => setUiMode(S.opts.ui === 'simple' ? 'full' : 'simple'));
  on($('#sbFile'),    'click', () => $('#fileInput').click());
  on($('#sbReset'),   'click', () => { S.opts.seq = 1; saveOpts(); syncSimple(); toast('Numbering reset', 'The next clip is 001.', 'ok'); });
  on($('#sbRefresh'), 'click', () => refreshSource(true).catch(showError));
  on($('#sbRefetch'), 'change', e => { S.opts.refetch = e.target.checked; saveOpts(); syncSimple(); });
  on($('#sbDownload'),'click', () => downloadClip().catch(showError));
}

function setUiMode(mode){
  S.opts.ui = mode === 'full' ? 'full' : 'simple';
  document.body.classList.toggle('simple', S.opts.ui === 'simple');
  /* The panel toggles mean nothing in simple mode and their classes carry
     enough specificity to fight its layout; drop them on the way in. */
  if (S.opts.ui === 'simple') document.body.classList.remove('no-rail', 'no-insp');
  $('#btnSimple').textContent = S.opts.ui === 'simple' ? 'Full controls' : 'Simple';
  /* Simple mode is a broadcast frame, not "whatever the source happened to be":
     1920x1080, contained, transparent where the graphic does not paint. A
     lower third that lays out at 1280x720 still lands in a 1080 frame in its
     own position, which is the only form a switcher can use. */
  if (S.opts.ui === 'simple') {
    S.opts.sizeMode = 'custom'; S.opts.outW = 1920; S.opts.outH = 1080;
    S.opts.fitMode = 'contain'; S.opts.padColor = '#00000000';
    S.fit = true;
  }
  saveOpts(); syncControls(); layout();
  if (S.source) rerun(true);
}

const clipName = (ext, d) => renderTemplate(S.opts.clipName || 'clip_{n}', {
  name: (S.source && S.source.name) || 'clip', w: d ? d.width : S.opts.outW, h: d ? d.height : S.opts.outH,
  ext, n: S.opts.seq,
  host: (() => { try { return new URL(S.source.url).hostname.replace(/^www\./, ''); } catch (_) { return 'local'; } })()
});

function syncSimple(){
  const n = $('#sbNext');
  if (n) {
    const fmt = AG.FORMATS.find(f => f.id === S.opts.format) || AG.FORMATS[0];
    n.textContent = clipName(fmt.ext, null);
  }
  const s = $('#sbSize'); if (s) s.textContent = `${S.opts.outW} × ${S.opts.outH}`;
  const r = $('#sbRefetch'); if (r && document.activeElement !== r) r.checked = !!S.opts.refetch;
  const d = $('#sbDownload'); if (d) d.disabled = !S.source;
  const rf = $('#sbRefresh');
  if (rf) rf.disabled = !(S.source && S.source.url);
}

/* Re-fetch the source URL and rebuild from it. This is the whole reason the
   loop works: without it Download would re-encode the frame already in memory
   and hand back the graphic from three pushes ago under a brand new number. */
async function refreshSource(announce){
  const url = S.source && S.source.url;
  if (!url) { if (announce) toast('Nothing to re-fetch', 'This came from a local file, not a URL.', 'warn'); return null; }
  const before = S.source.hash;
  const fresh = await loadFromUrl(url);
  const old = S.source.inst;
  if (old) { if (old.tile) old.tile.remove(); old.tile = null; disposeInstance(old); }
  await setSource(fresh);
  const same = !!(before && fresh.hash && before === fresh.hash);
  if (announce) {
    same ? toast('Re-fetched — unchanged', 'The server returned byte-identical content.', 'warn')
         : toast('Re-fetched', 'A new graphic is on the URL.', 'ok');
  }
  return same;
}

async function downloadClip(){
  if (!S.source) throw new AGError('Nothing to download', 'Grab a URL or open a file first.');
  const btn = $('#sbDownload');
  btn.disabled = true;
  const done = busy('Grabbing the frame…');
  try {
    let same = false;
    if (S.opts.refetch && S.source.url) same = await refreshSource(false);

    await raf();
    const d = await fullFrame();
    const { blob, fmt } = await encodeFrame(d, S.opts.format, S.opts);
    const fn = clipName(fmt.ext, d);
    saveBlob(blob, fn);

    const was = S.opts.seq;
    S.opts.seq = Math.min(AG.SEQ_MAX, (S.opts.seq | 0) + 1);
    saveOpts(); syncSimple();

    /* An empty frame is the other silent one. A live viz with nothing on air
       exports a perfectly valid, perfectly transparent 1920x1080 PNG — right
       size, right format, real alpha, no content. It only announces itself in
       the edit, by which time there are thirty of them. */
    /* Simple mode exists to produce a keyable frame. JPEG cannot carry alpha,
       and the only visible sign is three characters in the filename — so a
       whole session can be flattened onto a matte before anyone notices. */
    const fmtDef = AG.FORMATS.find(f => f.id === S.opts.format);
    if (fmtDef && !fmtDef.alpha) {
      toast('No alpha in this format',
        `<code>${fmtDef.label}</code> cannot carry transparency — <code>${fn}</code> is flattened onto the matte colour. ` +
        `Switch to PNG, WebP or TGA for a keyable frame.`, 'warn', 8000);
    }
    const empty = !S.stats || S.stats.coverage === 0 || S.stats.clearRatio >= 0.9999;
    if (empty) {
      toast('Saved, but the frame is empty',
        `<code>${fn}</code> is fully transparent — nothing was painted. ` +
        `If this is a live viz, check a graphic is actually on air, then download again.`, 'warn', 8000);
    }
    /* Say it when two clips came from the same bytes. The export succeeded and
       the number advanced, so nothing looks wrong — and a folder of identical
       "clips" is only discovered later, in the edit. */
    else if (same) {
      toast('Saved, but it has not changed',
        `<code>${fn}</code> came from byte-identical content to clip ${String(was - 1).padStart(AG.SEQ_PAD, '0')}. ` +
        `Push the next graphic to the URL, then download again.`, 'warn', 7000);
    } else {
      const a = S.stats && S.stats.clearRatio != null ? ` · ${(S.stats.clearRatio * 100).toFixed(0)}% clear` : '';
      toast('Saved', `<code>${fn}</code> · ${d.width} × ${d.height} · ${bytes(blob.size)}${a}`, 'ok');
    }
  } finally { done(); btn.disabled = !S.source; }
}

/* go */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
