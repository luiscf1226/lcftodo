// Regenerates the PWA / favicon PNGs from the logo geometry: `node scripts/generate-icons.mjs`.
// Uses sharp (installed with Next.js). Output is committed; this only needs re-running on logo changes.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const ACCENT = "#4f46e5";
const CHECK = '<path d="M154 263l66 66 138-146" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="48"/>';

// "any": rounded tile, used by browsers and desktop installs as-is.
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${ACCENT}"/>${CHECK}</svg>`;
// "maskable" / Apple touch icon: full-bleed square; the OS applies its own mask. The check sits
// well inside the 80% safe zone.
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${ACCENT}"/>${CHECK}</svg>`;

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

const outputs = [
  ["public/icons/lcf-todos-192.png", rounded, 192],
  ["public/icons/lcf-todos-512.png", rounded, 512],
  ["public/icons/lcf-todos-maskable-192.png", fullBleed, 192],
  ["public/icons/lcf-todos-maskable-512.png", fullBleed, 512],
  ["src/app/apple-icon.png", fullBleed, 180],
];
for (const [file, svg, size] of outputs) writeFileSync(root + file, await png(svg, size));

writeFileSync(root + "public/icons/lcf-todos.svg", rounded + "\n");
writeFileSync(root + "src/app/icon.svg", rounded + "\n");

// favicon.ico holding PNG images (supported by every current browser).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(rounded, s)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4); // color planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
writeFileSync(root + "src/app/favicon.ico", Buffer.concat([header, ...images]));

console.log("Icons written.");
