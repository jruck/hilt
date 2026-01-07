#!/usr/bin/env node
/**
 * Generate macOS app icons from SVG
 * Requires: brew install librsvg
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const buildDir = join(projectRoot, "build");
const iconsetDir = join(buildDir, "icon.iconset");
const svgPath = join(buildDir, "icon.svg");
const icnsPath = join(buildDir, "icon.icns");

// Icon sizes required for macOS
const sizes = [16, 32, 64, 128, 256, 512, 1024];

async function main() {
  console.log("Generating macOS app icons...");

  // Check if SVG exists
  if (!existsSync(svgPath)) {
    console.error(`SVG not found: ${svgPath}`);
    process.exit(1);
  }

  // Create iconset directory
  if (existsSync(iconsetDir)) {
    rmSync(iconsetDir, { recursive: true });
  }
  mkdirSync(iconsetDir, { recursive: true });

  // Generate PNG files for each size
  for (const size of sizes) {
    // Standard resolution
    const pngName = size === 1024 ? `icon_512x512@2x.png` : `icon_${size}x${size}.png`;
    const pngPath = join(iconsetDir, pngName);

    console.log(`  Generating ${pngName}...`);
    try {
      execSync(`rsvg-convert -w ${size} -h ${size} "${svgPath}" -o "${pngPath}"`, {
        stdio: "inherit",
      });
    } catch (err) {
      // Fallback to sips if rsvg-convert is not available
      console.log(`  Falling back to sips for ${pngName}...`);
      // First convert SVG to PNG using a temporary file
      const tempPng = join(buildDir, "temp_icon.png");
      try {
        // Use qlmanage to render SVG (available on all Macs)
        execSync(`qlmanage -t -s ${Math.max(size, 1024)} -o "${buildDir}" "${svgPath}" 2>/dev/null`, {
          stdio: "pipe",
        });
        const renderedPath = join(buildDir, "icon.svg.png");
        if (existsSync(renderedPath)) {
          execSync(`sips -z ${size} ${size} "${renderedPath}" --out "${pngPath}" 2>/dev/null`, {
            stdio: "pipe",
          });
          rmSync(renderedPath);
        }
      } catch (e) {
        console.error(`  Failed to generate ${pngName}: ${e.message}`);
      }
    }

    // Retina resolution (2x) - skip for 1024 as it's already @2x
    if (size <= 512) {
      const retinaPngName = `icon_${size}x${size}@2x.png`;
      const retinaPngPath = join(iconsetDir, retinaPngName);
      const retinaSize = size * 2;

      console.log(`  Generating ${retinaPngName}...`);
      try {
        execSync(`rsvg-convert -w ${retinaSize} -h ${retinaSize} "${svgPath}" -o "${retinaPngPath}"`, {
          stdio: "inherit",
        });
      } catch (err) {
        try {
          execSync(`qlmanage -t -s ${Math.max(retinaSize, 1024)} -o "${buildDir}" "${svgPath}" 2>/dev/null`, {
            stdio: "pipe",
          });
          const renderedPath = join(buildDir, "icon.svg.png");
          if (existsSync(renderedPath)) {
            execSync(`sips -z ${retinaSize} ${retinaSize} "${renderedPath}" --out "${retinaPngPath}" 2>/dev/null`, {
              stdio: "pipe",
            });
            rmSync(renderedPath);
          }
        } catch (e) {
          console.error(`  Failed to generate ${retinaPngName}: ${e.message}`);
        }
      }
    }
  }

  // Convert iconset to icns
  console.log("Converting to .icns...");
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, {
      stdio: "inherit",
    });
    console.log(`Generated: ${icnsPath}`);
  } catch (err) {
    console.error("Failed to create .icns file:", err.message);
    process.exit(1);
  }

  // Clean up iconset directory
  rmSync(iconsetDir, { recursive: true });
  console.log("Done!");
}

main().catch(console.error);
