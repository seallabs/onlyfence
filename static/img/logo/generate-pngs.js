#!/usr/bin/env node
/**
 * generate-pngs.js
 * Generates PNG logos at standard sizes from the SVG source.
 *
 * Usage:
 *   npm install sharp
 *   node generate-pngs.js
 *
 * Outputs: png/logo-{size}.png for each target size
 */

import sharp from "sharp";
import { readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgSource = readFileSync(join(__dirname, "svg", "logo.svg"));

// Target sizes: [width, height, filename suffix]
const sizes = [
  [16, 14, "16"],    // favicon small
  [32, 28, "32"],    // favicon
  [48, 42, "48"],    // npm badge / small icon
  [64, 56, "64"],    // medium icon
  [72, 64, "72"],    // standard display
  [128, 114, "128"], // retina / readme
  [256, 228, "256"], // large / marketing
  [512, 456, "512"], // high-res
];

const outDir = join(__dirname, "png");
mkdirSync(outDir, { recursive: true });

for (const [w, h, suffix] of sizes) {
  const outPath = join(outDir, `logo-${suffix}.png`);
  await sharp(svgSource)
    .resize(w, h, { kernel: sharp.kernel.nearest })
    .png()
    .toFile(outPath);
  console.log(`✓ ${outPath} (${w}×${h})`);
}

// Square versions with padding (for npm, GitHub avatar, etc.)
for (const size of [32, 64, 128, 256, 512]) {
  const inner = Math.round(size * 0.8);
  const innerH = Math.round(inner * (8 / 9));
  const padTop = Math.round((size - innerH) / 2);
  const padLeft = Math.round((size - inner) / 2);

  const outPath = join(outDir, `logo-square-${size}.png`);
  await sharp(svgSource)
    .resize(inner, innerH, { kernel: sharp.kernel.nearest })
    .extend({
      top: padTop,
      bottom: size - innerH - padTop,
      left: padLeft,
      right: size - inner - padLeft,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outPath);
  console.log(`✓ ${outPath} (${size}×${size} square)`);
}

console.log("\nDone! All PNGs generated.");
