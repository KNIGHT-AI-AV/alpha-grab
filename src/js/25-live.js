/* ═════════════════════ live instances ═════════════════════
   A production switcher does not show you a still of a graphic — it shows you
   the graphic RUNNING, on its own channel, next to the others. This module is
   that: each source keeps its own iframe alive and animating instead of being
   rendered once and thrown away.

   Two different mechanisms do two different jobs, and conflating them is the
   mistake to avoid:

     the MONITOR is the iframe itself. It is same-origin `srcdoc`, so it paints
     and animates natively, for free, at whatever the browser can do.

     the GRABBER is still `domToSvg`. Pixels can only leave through the SVG
     repaint, because an SVG carrying a <foreignObject> taints every canvas it
     touches and nothing can be read back off it (see 20-source.js). That has
     not changed and cannot be worked around.

   What the persistent instance buys is that the repaint now reads a LIVE DOM,
   so "grab the frame that is on screen right now" became possible at all.

   Frame accuracy is the subtle part. Inlining images means awaiting fetches,
   and a running animation keeps moving while you wait — so a naive grab
   smears across time and hands back a frame the monitor never showed. Every
   grab therefore HOLDS the instance first and releases it after.            */

const LIVE = {
  list: [],
  seq: 0,
  selected: null
};

const liveById   = id => LIVE.list.find(i => i.id === id) || null;
const liveActive = () => liveById(LIVE.selected) || LIVE.list[0] || null;

/* ── lifecycle ─────────────────────────────────────────────────────────── */

/* Build the instance record. The iframe is created here but stays empty until
   mountInstance() puts it in the DOM — an iframe only loads once it is in a
   document, and srcdoc set beforehand would fire load against nothing. */
/* A data: URL's "name" is the payload, which makes a useless 300-character tile
   label. Anything that long or that obviously machine-generated gets a plain
   numbered name instead. */
function instanceName(src, n){
  const raw = String((src && src.name) || '').trim();
  if (!raw || raw.length > 42 || /^data[-:]/i.test(raw)) return 'Template ' + n;
  return raw;
}

function newInstance(src, name){
  return {
    id: 'i' + (++LIVE.seq),
    name: name === undefined ? instanceName(src, LIVE.seq) : (name || instanceName(src, LIVE.seq)),
    src,
    w: Math.max(AG.MIN_DIM, Math.round(src.w || S.opts.domW)),
    h: Math.max(AG.MIN_DIM, Math.round(src.h || S.opts.domH)),
    frame: null,
    ready: false,
    playing: true,
    scripted: false,      // animates from script, so the transport cannot hold it
    error: null,
    notes: []
  };
}

async function mountInstance(inst, host){
  const frame = el('iframe', {
    className: 'inst-frame',
    // width/height are the template's DESIGN size; CSS scales the tile down to
    // fit. Never size the iframe to the tile — the template would reflow and
    // you would be monitoring a layout that is not the one you export.
    style: `width:${inst.w}px;height:${inst.h}px;border:0;background:transparent`
  });
  frame.setAttribute('title', inst.name);
  /* Deliberately NOT sandboxed. The repaint reads computed styles out of the
     template's document, which needs same-origin access; and a sandbox
     carrying both allow-scripts and allow-same-origin can lift its own
     restrictions anyway, so it would buy nothing but a way to break. */
  inst.frame = frame;
  host.append(frame);

  let html = inst.src.html;
  if (!/<base\b/i.test(html)) {
    const inject = `<base href="${String(inst.src.baseUrl || '').replace(/"/g, '&quot;')}">`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + inject) : inject + html;
  }

  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new AGError('The template never finished loading',
      'The page did not fire <code>load</code> within 20 seconds.')), 20000);
    frame.onload  = () => { clearTimeout(t); res(); };
    frame.onerror = () => { clearTimeout(t); rej(new AGError('The template failed to load', '')); };
    frame.srcdoc = html;
  });

  const doc = frame.contentDocument;
  if (!doc) throw new AGError('Could not read the rendered template', 'The iframe document was not accessible.');
  try { if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, new Promise(r => setTimeout(r, 4000))]); } catch (_) {}

  /* Let the template run before anyone grabs it. The one-shot path always did
     this; the live path did NOT, and since 0.2.0 every HTML template is a live
     instance — so the settle control governed a code path nothing used any more.
     Measured: content injected 2 s after load was missing from the export with
     settle at 4 s, and the export was a valid, correctly sized, entirely blank
     1080p frame. That is the same symptom as "nothing on air", which is exactly
     why it hid: a broadcast graphic that arrives over a socket a second or two
     after the page parses is the NORMAL case, not an edge one. */
  await new Promise(r => setTimeout(r, clamp(S.opts.settle, 0, AG.SETTLE_MAX)));

  /* An iframe is composited TRANSPARENTLY only while its used color-scheme
     matches the embedder's. Mismatch and Chromium paints an opaque base canvas
     under it — white for a light frame, #121212 for a dark one — and no amount
     of `background: transparent` on html or body removes it, because that base
     sits underneath them both. Measured, four ways, against this page.

     This page is `color-scheme: dark`, and a bare srcdoc document is `normal`.
     So a monitor left alone shows WHITE exactly where the exported frame is
     going to be TRANSPARENT — the one thing an alpha tool must never get
     wrong. Matching the scheme restores compositing and the tile's
     checkerboard reads through.

     The trade: a template that asks for system colours or light-dark() now
     resolves them dark. That is the right way round — the repaint reads this
     same document, so the monitor and the export agree, which is worth more
     than either of them being independently prettier. */
  try {
    const st = doc.createElement('style');
    st.setAttribute('data-ag', 'canvas');
    st.textContent = ':root{color-scheme:dark}';
    (doc.head || doc.documentElement).append(st);
  } catch (_) {}

  /* Does this template keep ITSELF current?

     Measured against a live Flowics viewer: an instance left running for 75 s
     picked up a graphic change on air by itself, and its DOM came back
     byte-identical to a freshly loaded second instance. The page holds a
     websocket to its own backend and re-renders in place — exactly what the
     monitor is showing.

     That matters because the download was re-fetching the URL first and paying
     5 s for it: a network round trip, a fresh iframe, and the full settle
     window, to arrive at content the running instance already had. Worse, the
     re-fetch tears the monitor down and rebuilds it, so the frame came from a
     document the operator had not been watching.

     So count edits. An instance that has re-rendered since mount is proving it
     is fed, and the live DOM is then the freshest thing available — fresher
     than a re-fetch, because it is what is on screen. One that has never moved
     is inert, and gets re-fetched exactly as before. */
  inst.liveEdits = 0;
  try {
    inst.watcher = new MutationObserver(recs => { inst.liveEdits += recs.length; });
    inst.watcher.observe(doc.body, { subtree: true, childList: true, characterData: true });
  } catch (_) {}

  inst.ready = true;
  inst.scripted = await detectScripted(inst);
  /* detectScripted deliberately holds and releases the transport, and a
     template that animates from script mutates while it does. Those are our
     own edits, not the feed's. */
  inst.liveEdits = 0;
  return inst;
}

function disposeInstance(inst){
  try { inst.watcher && inst.watcher.disconnect(); } catch (_) {}
  inst.watcher = null;
  try { inst.frame && inst.frame.remove(); } catch (_) {}
  inst.frame = null; inst.ready = false;
  const i = LIVE.list.indexOf(inst);
  if (i >= 0) LIVE.list.splice(i, 1);
  if (LIVE.selected === inst.id) LIVE.selected = LIVE.list.length ? LIVE.list[0].id : null;
}

/* ── transport ─────────────────────────────────────────────────────────── */

/* Everything the Web Animations API can see: CSS animations, CSS transitions
   and anything script started through element.animate(). Media elements are
   not animations and are handled beside them. */
function instAnimations(inst){
  const doc = inst.frame && inst.frame.contentDocument;
  if (!doc || !doc.getAnimations) return [];
  try { return doc.getAnimations(); } catch (_) { return []; }
}
function instMedia(inst){
  const doc = inst.frame && inst.frame.contentDocument;
  if (!doc) return [];
  return Array.from(doc.querySelectorAll('video,audio'));
}

function instPause(inst){
  for (const a of instAnimations(inst)) { try { a.pause(); } catch (_) {} }
  for (const m of instMedia(inst))      { try { m.pause(); } catch (_) {} }
  inst.playing = false;
}
function instPlay(inst){
  for (const a of instAnimations(inst)) { try { a.play(); } catch (_) {} }
  for (const m of instMedia(inst))      { try { m.play().catch(() => {}); } catch (_) {} }
  inst.playing = true;
}

/* Longest finite timeline in the instance, in ms — what the scrubber spans.
   An infinite (looping) animation reports its own iteration length instead, so
   a ticker still gets a usable scrub range rather than Infinity. */
function instDuration(inst){
  let max = 0;
  for (const a of instAnimations(inst)) {
    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
    if (!t) continue;
    const d = Number.isFinite(t.endTime) ? t.endTime
            : Number.isFinite(t.duration) ? t.duration * Math.max(1, t.iterations === Infinity ? 1 : t.iterations || 1)
            : 0;
    if (Number.isFinite(d)) max = Math.max(max, d);
  }
  for (const m of instMedia(inst)) if (Number.isFinite(m.duration)) max = Math.max(max, m.duration * 1000);
  return Math.round(max);
}

function instTime(inst){
  let t = 0;
  for (const a of instAnimations(inst)) if (Number.isFinite(a.currentTime)) t = Math.max(t, a.currentTime);
  for (const m of instMedia(inst))      if (Number.isFinite(m.currentTime)) t = Math.max(t, m.currentTime * 1000);
  return Math.round(t);
}

function instSeek(inst, ms){
  const t = Math.max(0, Math.round(ms));
  for (const a of instAnimations(inst)) { try { a.currentTime = t; } catch (_) {} }
  for (const m of instMedia(inst))      { try { m.currentTime = t / 1000; } catch (_) {} }
  return t;
}

/* One frame at the chosen rate. 25 for PAL/EBU, 30 for NTSC-ish work — the
   step is exposed so landing on "the frame before the wipe" is exact rather
   than a guess at a slider. */
function instStep(inst, frames, fps){
  const rate = clamp(fps || AG.STEP_FPS, 1, 120);
  instPause(inst);
  return instSeek(inst, instTime(inst) + (frames * 1000 / rate));
}

/* A template driven by requestAnimationFrame or setInterval cannot be held by
   any outside transport — there is no handle to pause. Rather than let that
   look like a broken scrubber, detect it and say so: hold the instance, then
   watch whether the rendered DOM keeps changing anyway. */
async function detectScripted(inst){
  const doc = inst.frame && inst.frame.contentDocument;
  if (!doc || !doc.body) return false;
  const sig = () => {
    try {
      const b = doc.body;
      return b.innerHTML.length + '|' + b.childElementCount + '|' + (b.textContent || '').length;
    } catch (_) { return ''; }
  };
  const was = inst.playing;
  instPause(inst);
  const a = sig();
  await new Promise(r => setTimeout(r, 180));
  const b = sig();
  if (was) instPlay(inst);
  return a !== b;
}

/* ── what the graphic SAYS ──────────────────────────────────────────────
   A folder of clip_001 … clip_040 is a folder nobody can search. The operator
   knows the file by whose name is on it, and that name is sitting right there
   in the DOM the repaint already reads — so the filename may as well carry it.

   "Most prominent" is font-size first. A lower third puts the person's name in
   the largest type on screen and everything else beneath it, and a title card
   does the same with its title, so one rule covers both without knowing which
   is which.

   The trap is ICON FONTS. Flowics ships three of them, and a 64px ligature
   glyph outscores a 60px name while carrying no readable text at all — it
   would have produced filenames made of private-use codepoints. Anything
   without two real letters is refused, as is anything in a family named like
   an icon set. */
const ICON_FAMILY = /icon|glyph|material|awesome|feather|ionicons/i;

function graphicLabel(inst){
  const doc = inst && inst.frame && inst.frame.contentDocument;
  if (!doc || !doc.body) return '';
  let best = null;
  const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const raw = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
    /* Two letters, and letters that a person would read. A single glyph, a
       lone digit or a run of punctuation is furniture, not a label. */
    if (raw.length < 2 || (raw.match(/[a-z]/gi) || []).length < 2) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    let cs;
    try { cs = doc.defaultView.getComputedStyle(parent); } catch (_) { continue; }
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) <= 0.02) continue;
    if (ICON_FAMILY.test(cs.fontFamily || '')) continue;
    let r;
    try { const rg = doc.createRange(); rg.selectNodeContents(node); r = rg.getBoundingClientRect(); } catch (_) { continue; }
    if (r.width < 4 || r.height < 4) continue;
    const size = parseFloat(cs.fontSize) || 0;
    if (!best || size > best.size + 0.5 || (Math.abs(size - best.size) <= 0.5 && r.width > best.w))
      best = { size, w: r.width, text: raw };
  }
  if (!best) return '';
  /* The first few words. A strap can run to a full sentence and a filename
     should not. */
  return best.text.split(' ').slice(0, 4).join(' ').slice(0, 44);
}

/* What the instance is showing, as one short string. Skipping the re-fetch
   also skipped the byte hash that caught "you downloaded the same graphic
   twice" — a silent fault, because the export succeeds and the number advances
   and you only find the duplicates in the edit. The rendered DOM answers the
   same question and is what the operator actually cares about. */
function instSignature(inst){
  const doc = inst && inst.frame && inst.frame.contentDocument;
  if (!doc || !doc.body) return '';
  let h = 0x811c9dc5;
  const feed = (doc.body.textContent || '') + '|' + doc.body.innerHTML.length;
  for (let i = 0; i < feed.length; i++) { h ^= feed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

/* ── the grab ──────────────────────────────────────────────────────────── */

/* Read the frame the monitor is showing, right now, without disturbing it.
   Held for the duration so what comes out is one instant, not a smear across
   however long the image fetches took; every DOM mutation is undone after. */
async function grabInstance(inst, onNote){
  const doc = inst.frame && inst.frame.contentDocument;
  if (!doc) throw new AGError('That instance is not running', 'Load the template again.');

  const notes = new Map();
  const note = m => notes.set(m, (notes.get(m) || 0) + 1);
  const undo = [];
  const wasPlaying = inst.playing;

  instPause(inst);
  await raf();
  try {
    const fontCss = await collectFontFaces(doc, inst.src.baseUrl, note);
    await inlineImages(doc, inst.src.baseUrl, note, undo);
    const svg = domToSvg(doc, inst.w, inst.h, fontCss, note);
    if (inst.scripted) note('this template animates from script, so the transport cannot hold it — the grab may not be the frame you saw');
    inst.notes = [...notes.keys()];
    if (onNote) for (const [m, n] of notes) onNote(n > 1 ? `${m} (×${n})` : m);
    return svg;
  } finally {
    while (undo.length) { try { undo.pop()(); } catch (_) {} }
    if (wasPlaying) instPlay(inst);
  }
}
