/**
 * generate-icons.mjs
 *
 * Converts the bundled SVG icons into all PNG/ICO sizes required by Tauri.
 * Run with:
 *   npm install sharp          ← one-time, not a project dep
 *   node scripts/generate-icons.mjs
 *
 * Sources used:
 *   src-tauri/icons/app-icon.svg   → app icon (colored, with background)
 *   src-tauri/icons/tray-icon.svg  → tray/menu-bar icon (transparent, monochrome)
 *
 * Output (all written to src-tauri/icons/):
 *   32x32.png, 128x128.png, 128x128@2x.png   ← required by Tauri bundler
 *   icon.ico                                  ← Windows
 *   icon.icns                                 ← macOS (requires macOS + iconutil)
 *   tray-icon.png                             ← menu bar / system tray
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, "..");
const ICONS_DIR = join(ROOT, "src-tauri", "icons");

mkdirSync(ICONS_DIR, { recursive: true });

async function run() {
  // ── Dependency check ──────────────────────────────────────────────────────
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error(
      "\n  sharp is not installed.\n" +
      "  Run:  npm install sharp\n" +
      "  Then: node scripts/generate-icons.mjs\n"
    );
    process.exit(1);
  }

  const appSvg  = join(ICONS_DIR, "app-icon.svg");
  const traySvg = join(ICONS_DIR, "tray-icon.svg");

  if (!existsSync(appSvg) || !existsSync(traySvg)) {
    console.error("SVG source files not found. Expected:\n  " + appSvg + "\n  " + traySvg);
    process.exit(1);
  }

  console.log("Generating icons from SVG sources...\n");

  // ── App icon sizes (from app-icon.svg) ────────────────────────────────────
  const appSizes = [
    { name: "32x32.png",      size: 32  },
    { name: "128x128.png",    size: 128 },
    { name: "128x128@2x.png", size: 256 },
    { name: "icon-512.png",   size: 512 },  // intermediate for .ico/.icns
    { name: "icon-1024.png",  size: 1024 }, // intermediate for .icns
  ];

  for (const { name, size } of appSizes) {
    const out = join(ICONS_DIR, name);
    await sharp(appSvg)
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`  ✓ ${name.padEnd(20)} ${size}×${size}px`);
  }

  // ── Tray icon (from tray-icon.svg) ────────────────────────────────────────
  // Generate @1x and @2x for HiDPI displays
  for (const { name, size } of [
    { name: "tray-icon.png",   size: 22 },
    { name: "tray-icon@2x.png", size: 44 },
  ]) {
    const out = join(ICONS_DIR, name);
    await sharp(traySvg)
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`  ✓ ${name.padEnd(20)} ${size}×${size}px`);
  }

  // ── Windows .ico (multi-size) ─────────────────────────────────────────────
  // sharp can write ICO when the output extension is .ico
  try {
    const icoPath = join(ICONS_DIR, "icon.ico");
    // ICO files embed multiple sizes; write the 256px version as the ICO
    // (Windows uses the best available size from the file).
    await sharp(appSvg)
      .resize(256, 256)
      .toFormat("png")
      .toFile(join(ICONS_DIR, "_ico256.png"));

    // Use sharp to produce a simple single-frame ICO from the 256px PNG.
    // For a proper multi-frame ICO you'd use png-to-ico; this is sufficient
    // for Tauri's bundler which accepts a PNG named icon.ico.
    await sharp(appSvg).resize(256, 256).png().toFile(icoPath);
    console.log(`  ✓ icon.ico`);
  } catch (e) {
    console.log(`  ⚠ icon.ico skipped: ${e.message}`);
  }

  // ── macOS .icns ───────────────────────────────────────────────────────────
  try {
    const { execSync } = await import("child_process");
    const iconsetDir = join(ICONS_DIR, "AppIcon.iconset");
    mkdirSync(iconsetDir, { recursive: true });

    // iconutil expects these exact filenames
    const icnsSizes = [
      [16, false], [16, true],
      [32, false], [32, true],
      [64, false], [64, true],
      [128, false], [128, true],
      [256, false], [256, true],
      [512, false], [512, true],
    ];

    for (const [px, retina] of icnsSizes) {
      const actualPx = retina ? px * 2 : px;
      const filename = retina
        ? `icon_${px}x${px}@2x.png`
        : `icon_${px}x${px}.png`;
      await sharp(appSvg)
        .resize(actualPx, actualPx)
        .png()
        .toFile(join(iconsetDir, filename));
    }

    execSync(
      `iconutil -c icns "${iconsetDir}" -o "${join(ICONS_DIR, "icon.icns")}"`,
      { stdio: "ignore" }
    );
    console.log(`  ✓ icon.icns`);
  } catch {
    console.log(`  ⚠ icon.icns skipped (requires macOS + iconutil — run this script on a Mac to generate it).`);
  }

  // ── Cleanup intermediates ─────────────────────────────────────────────────
  for (const tmp of ["icon-512.png", "icon-1024.png", "_ico256.png"]) {
    try {
      const { unlinkSync } = await import("fs");
      unlinkSync(join(ICONS_DIR, tmp));
    } catch { /* ignore */ }
  }

  console.log("\nDone. Icons are in src-tauri/icons/");
  console.log("Run `npm run tauri build` to package the app.\n");
}

run().catch((e) => {
  console.error("Icon generation failed:", e.message);
  process.exit(1);
});
