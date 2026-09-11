# AlphaGrab changelog

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
