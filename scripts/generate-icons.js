#!/usr/bin/env node
// scripts/generate-icons.js
//
// Dev-time-only icon generator. NEVER imported by the app at runtime — the
// app ships with zero npm runtime dependencies; this script is just a local
// convenience for (re)generating the PWA icon PNGs from a tiny inline SVG.
//
// Run manually with: node scripts/generate-icons.js
//
// Draws a simple flat icon — a stylized "V" in the app's dark
// `--accent-text` color on top of the `--accent` mint/emerald background
// (see css/styles.css for the canonical hex values) — and rasterizes it to
// every PNG size the manifest/HTML reference. Rasterization is delegated to
// `sharp-cli` via a one-off `npx` invocation: that's a dev-tooling
// dependency fetched on demand, not something the shipped app depends on.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACCENT = '#35e0a1'; // css/styles.css --accent
const ACCENT_TEXT = '#04140d'; // css/styles.css --accent-text

const ICONS_DIR = path.join(__dirname, '..', 'icons');

/** @type {{ file: string, size: number }[]} */
const TARGETS = [
  { file: 'icon-180.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'favicon.png', size: 48 },
];

function buildSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${ACCENT}"/>
  <text x="256" y="350" font-size="300" text-anchor="middle"
        font-family="-apple-system, Helvetica, Arial, sans-serif" font-weight="700"
        fill="${ACCENT_TEXT}">V</text>
</svg>
`;
}

function main() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtaper-icons-'));
  const svgPath = path.join(tmpDir, 'icon-source.svg');
  fs.writeFileSync(svgPath, buildSvg());

  // Isolate the npm cache npx uses for this one-off fetch: some sandboxes
  // have a global ~/.npm cache with stale/corrupted entries that make a
  // plain `npx` fail with EEXIST. A scratch cache sidesteps that without
  // touching the user's real npm cache.
  const npmCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtaper-npm-cache-'));
  const env = { ...process.env, npm_config_cache: npmCacheDir };

  try {
    for (const { file, size } of TARGETS) {
      const outPath = path.join(ICONS_DIR, file);
      console.log(`Generating ${file} (${size}x${size})...`);
      execFileSync(
        'npx',
        ['--yes', '-p', 'sharp-cli', 'sharp', '-i', svgPath, '-o', outPath, 'resize', String(size), String(size)],
        { env, stdio: 'inherit' }
      );

      const stat = fs.statSync(outPath);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error(`${file} was not written or is empty`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(npmCacheDir, { recursive: true, force: true });
  }

  console.log('Done. Icons written to', ICONS_DIR);
}

main();
