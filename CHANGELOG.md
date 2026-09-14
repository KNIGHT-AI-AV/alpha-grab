# AlphaGrab changelog

## 0.3.2 - 2026-09-14

**The relay checkbox was a lie.** Reported from a live show: "the output link
puller wouldnt take the flowics output, even with the proxy link box checked."

It was true. `proxied()` returned `null` whenever the box was ticked and the
field was empty - and the field is empty for everyone who has not pasted a proxy
of their own. The request went out unproxied and came back with the byte-identical
CORS error, while the control sat there switched on. The tool's own error text
had sent him to that box.

- **A ticked box now always routes somewhere.** Left blank it uses the relay we
  run; a pasted proxy still wins.
- **Ticking it fills the field with the route** instead of leaving it blank, so
  where the request goes is visible rather than implied, **and re-grabs the URL
  immediately** - the old handler only recorded the flag, so nothing happened
  until you pressed Grab again.
- Relabelled "Fetch through a CORS proxy" -> **"Fetch through a relay"**, and the
  hint now names the default instead of assuming you run your own.

Four checks pin exactly that path: unticked is still null, ticked-and-empty
routes through the relay, a pasted proxy wins, and ticking shows the route.
46 guard + 102 Chromium.

**Note for anyone who hit this:** `www.knightaiav.com/alpha-grab/` was still
serving **0.2.0**, which predates the relay entirely - no button, no simple mode.
The current tool has only ever been at **alphagrab.knightaiav.com**.

## 0.3.1 - 2026-09-11

Phones and narrow windows. Reported from one: "what is this random texture up
here" - the checkerboard preview, shrunk to a corner.

- **Simple mode at <= 980px:** its three-column rule overrode the stacked
  single-column layout, so the stage auto-placed into a 0-wide column and the
  canvas fell to 19x11 in the corner. Simple mode is one column at every width.
- **Simple mode after Tab or I:** `body.no-rail.no-insp` carries two classes and
  out-ranked simple mode's layout, putting the stage back in a 0-wide column at
  desktop width - only after someone had toggled a panel in full mode. Those
  classes are dropped on the way into simple mode, and the selectors now match
  at every combination.
- **Full mode at <= 980px (pre-existing, since 0.2.0):** the stage row had a
  200px floor and the viewer's own top and bottom bars are ~120px of chrome, so
  the viewport was 0px tall and no phone ever showed a picture in full mode.
  The stage row now keeps its auto minimum, the panels cap at 30vh, the viewport
  has a 240px floor, and main scrolls vertically instead of clipping.

Verification: 46 guard and 98 Chromium checks (eight new: stage width, viewport
height, canvas centring and zero horizontal scroll at 375, 767, 980 and 1600
px, in both modes), run twice. No check had ever resized the window before.

## 0.3.0 - 2026-09-11

Simple mode, and the repeat loop it exists for: look at the graphic, download
it, push the next one to the same URL, download again.

- **Simple mode is now the default.** The graphic fills the screen, 16:9 and
  centred on a checkerboard, with one row of controls under it. Everything else
  is behind **Full controls** (`S`), one keystroke away.
- **Always a full 1920x1080 broadcast frame**, whatever size the source lays out
  at - contained, transparent where the graphic does not paint. A frame whose
  size follows the source is no use to a switcher.
- **Clip numbering that does the remembering.** `clip_001.png`, `clip_002.png`,
  ... The bar shows the next name *before* you press Download, and the counter
  survives a reload. `Enter` downloads, `R` re-fetches, the reset arrow returns
  to 001.
- **Download re-fetches the URL first** (on by default). Without this the button
  would re-encode the frame already in memory and hand back an older graphic
  under a new number - which looks exactly like working.
- **A relay for hosts that refuse CORS.** Broadcast graphics platforms serve
  their viz pages without `Access-Control-Allow-Origin` and are third parties,
  so nobody using this tool can add the header. A CORS refusal now carries a
  one-click **Use the relay** button. It is **off until you press it**: a relay
  sees every URL routed through it, and rendering, keying and encoding still
  happen in the browser either way.

### Three silent failures now say something

Each of these produces a valid file of the right size and format, so nothing
looks wrong until the edit:

- **The URL has not changed.** Two clips from byte-identical content are named
  and reported as such, so a duplicate is caught at the moment it is made.
- **The frame is empty.** A live viz with nothing on air exports a perfect,
  perfectly transparent 1080p PNG. It is now called out.
- **The format cannot carry alpha.** JPEG flattens onto the matte and announces
  it in three characters of filename; now it says so.

### One defect fixed that was already shipped

**Hiding a panel collapsed the viewer to zero width.** The rail, stage and
inspector are grid items with no explicit column, so `display:none` on the rail
slid the stage into column 1 - which is 0 wide - and the whole viewer vanished.
Pressing `Tab` did it in 0.2.0. Each panel is now pinned to its own column, and
a check measures the stage in all five panel combinations.

Verification: 46 guard checks and 90 Chromium checks, up from 46 and 81, run
three times for stability. The new ones prove the numbering advances on its own,
that a 300x150 template still exports 1920x1080, and that an all-transparent
clip is reported rather than saved quietly.

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
