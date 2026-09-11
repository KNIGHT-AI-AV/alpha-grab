#!/usr/bin/env node
/* Build AlphaGrab: src/ → docs/index.html, one self-contained file.
   Single file on purpose — it has to run from GitHub Pages, from a subfolder
   of knightaiav.com, and from a USB stick on a show laptop with no network. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC  = join(ROOT, 'src');
const OUT  = join(ROOT, 'docs');

export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#161c24"/>' +
  '<g fill="#232b36"><rect x="0" y="0" width="8" height="8"/><rect x="16" y="0" width="8" height="8"/>' +
  '<rect x="8" y="8" width="8" height="8"/><rect x="24" y="8" width="8" height="8"/>' +
  '<rect x="0" y="16" width="8" height="8"/><rect x="16" y="16" width="8" height="8"/>' +
  '<rect x="8" y="24" width="8" height="8"/><rect x="24" y="24" width="8" height="8"/></g>' +
  '<path d="M16 5 L25.5 26 H20.8 L19 21.6 H13 L11.2 26 H6.5 Z M16 12.2 L14.4 17.8 H17.6 Z" fill="#ffb020"/></svg>');

export function build({ quiet } = {}){
  const css = readFileSync(join(SRC, 'app.css'), 'utf8');

  const jsDir = join(SRC, 'js');
  const parts = readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();   // 10- 20- 30- 40- 50-
  if (!parts.length) throw new Error('no source modules found in src/js');
  const js = parts.map(f => `\n/* ── ${f} ─────────────────────────────────────────── */\n` +
                            readFileSync(join(jsDir, f), 'utf8')).join('\n');

  if (/<\/script/i.test(js)) throw new Error('a source module contains </script — it would close the inline block early');

  const tpl = readFileSync(join(SRC, 'index.template.html'), 'utf8');
  const stamp = new Date().toISOString().slice(0, 10);
  const hash = createHash('sha256').update(css + js + tpl).digest('hex').slice(0, 8);

  /* Function replacers: a literal $& or $1 inside the payload must survive. */
  let out = tpl
    .replace('__CSS__', () => css)
    .replace('__JS__', () => js)
    .replace(/__FAVICON__/g, () => FAVICON)
    .replace(/__VERSION__/g, () => VERSION)
    .replace(/__BUILD__/g, () => `${stamp}·${hash}`);

  const left = out.match(/__[A-Z_]+__/g);
  if (left) throw new Error('unreplaced placeholders in the build: ' + [...new Set(left)].join(', '));

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'index.html'), out);
  writeFileSync(join(OUT, '.nojekyll'), '');   // GitHub Pages: serve the file as-is

  if (!quiet) {
    const kb = (statSync(join(OUT, 'index.html')).size / 1024).toFixed(1);
    console.log(`AlphaGrab ${VERSION} (${stamp}·${hash})`);
    console.log(`  modules : ${parts.join(', ')}`);
    console.log(`  → docs/index.html  ${kb} KB, self-contained`);
  }
  return { html: out, version: VERSION, build: `${stamp}·${hash}` };
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) build();
