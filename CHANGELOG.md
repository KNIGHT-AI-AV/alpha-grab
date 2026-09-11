# AlphaGrab changelog

## 0.2.0 - 2026-09-11

Live instances. A production switcher does not show you a still of a graphic, it
shows you the graphic running - so now this does too.

- **Every HTML template becomes a running instance** instead of being rendered
  once and thrown away. Up to 8 at a time, each in its own iframe, all rendering
  locally in the browser.
- **Multiviewer** (`L`): every instance live and animating at once, on a
  checkerboard so you read its real alpha, switcher-style. Click a tile to make
  it the current source - the inspector, preview and export bar follow it.
- **Transport** for the selected instance: hold/run (`Space`), step a frame at a
  time (`[` / `]`) at 24/25/30/50/60p, and a scrubber across its timeline. An
  animated lower third can be parked on an exact frame instead of guessed at.
- **A grab is the frame you are parked on.** Every capture holds the instance for
  its whole duration, so the export is one instant rather than a smear across
  however long the image fetches took - and every DOM change the capture makes is
  undone afterwards, so the running graphic is left exactly as it was.
- **Grab all** pulls the current frame from every instance in one pass.
- A template that animates from script rather than from CSS or the Web Animations
  API is detected and labelled `SCRIPTED`, because no outside transport can hold
  it and a grab may not be the frame you saw. Said out loud rather than silently
  wrong.
- Verification: 46 guard checks and 79 Chromium checks, up from 40 and 63. The new
  ones prove the monitor actually animates, that a hold really holds, and that a
  frame parked at 0 ms exports red while the same graphic parked at 1000 ms
  exports blue - read back off the decoded export, not asserted.

The monitor is composited against the tile's checkerboard, so empty areas read
as transparent rather than as a colour. That took a measured fix: **an iframe is
composited transparently only while its used `color-scheme` matches the
embedder's.** Mismatch and Chromium paints an opaque base canvas underneath
`html` and `body` that no background rule can clear - this page is dark, a bare
`srcdoc` document is `normal`, and the tiles came out WHITE exactly where the
export is transparent. Matching the scheme fixes it; the check is on the painted
pixel, because computed style reports transparent either way.

Three real defects the new tests caught before release: hiding the multiviewer with
`[hidden]` stripped the layout box off every instance, so the repaint read a DOM
where everything was 0x0 and exported an empty frame; and the live iframe had
picked up a `sandbox` attribute that would have blocked the same-origin access the
repaint needs.

## 0.1.0 — 2026-09-08

First build. Not released: nothing is deployed, so no page describes it.

- URL, drag-drop, paste and file input for bitmaps, SVG and HTML templates.
- HTML graphics templates run for real and are repainted as native SVG, so the
  export is vector and scales without enlargement.
- Chroma key with colour-difference matting and spill suppression; luma key;
  colour→alpha with edge unmixing.
- Matte tools: choke/grow, feather, matte gamma and gain, trim to content.
- Straight and premultiplied alpha in both directions.
- Fill + key pair export; PNG, WebP, TGA (32-bit) and JPEG.
- 13 output presets from HD to 8K, vertical and LED ribbon; custom sizes to
  8192 px per side, lowered automatically where the browser cannot reach it.
- Alpha QC panel measured off the exported pixels, not inferred.
- Batch of up to 50 URLs to a ZIP; named presets; shareable settings links.
- Safe-area guides, thirds, centre cross; six preview backdrops.
- Guard suite (advertised == enforced) plus a Chromium suite that asserts on decoded exported pixels; both green on this build.
