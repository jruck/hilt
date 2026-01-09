#!/usr/bin/env node
/**
 * Generate proper macOS app icons with the 🗡️ dagger emoji
 * Creates a squircle-shaped icon with black background and centered emoji
 *
 * Uses Swift/AppKit to access macOS Core Graphics for proper emoji rendering
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const buildDir = join(projectRoot, "build");
const iconsetDir = join(buildDir, "icon.iconset");
const icnsPath = join(buildDir, "icon.icns");

async function main() {
  console.log("Generating macOS app icons with 🗡️ dagger emoji...");
  console.log("");

  // Create iconset directory
  if (existsSync(iconsetDir)) {
    rmSync(iconsetDir, { recursive: true });
  }
  mkdirSync(iconsetDir, { recursive: true });

  // Swift script for rendering - Swift has native access to Apple fonts
  const swiftScript = `
import Cocoa
import Foundation

// Superellipse (squircle) path generator
func squirclePath(in rect: NSRect, n: CGFloat = 5) -> NSBezierPath {
    let path = NSBezierPath()
    let cx = rect.midX
    let cy = rect.midY
    let r = min(rect.width, rect.height) / 2

    // Generate superellipse points
    var first = true
    for i in 0..<360 {
        let angle = CGFloat(i) * .pi / 180
        let cosA = cos(angle)
        let sinA = sin(angle)

        let x = cx + r * copysign(pow(abs(cosA), 2/n), cosA)
        let y = cy + r * copysign(pow(abs(sinA), 2/n), sinA)

        if first {
            path.move(to: NSPoint(x: x, y: y))
            first = false
        } else {
            path.line(to: NSPoint(x: x, y: y))
        }
    }
    path.close()
    return path
}

func createIcon(size: Int, outputPath: String) -> Bool {
    let cgSize = CGFloat(size)
    let rect = NSRect(x: 0, y: 0, width: cgSize, height: cgSize)

    // Apple's macOS icon spec: 824px squircle on 1024px canvas = ~80.5%
    // This means ~9.75% margin on each side (100px on 1024px)
    let marginPercent: CGFloat = 0.0976
    let margin = cgSize * marginPercent
    let iconSize = cgSize - (margin * 2)
    let iconRect = NSRect(x: margin, y: margin, width: iconSize, height: iconSize)

    // Create image
    let image = NSImage(size: NSSize(width: cgSize, height: cgSize))
    image.lockFocus()

    // Get graphics context
    guard let context = NSGraphicsContext.current?.cgContext else {
        image.unlockFocus()
        return false
    }

    // Clear background (transparent)
    context.clear(rect)

    // Create squircle clip path - now uses iconRect instead of full rect
    let squircle = squirclePath(in: iconRect)

    // Fill with black background
    NSColor.black.setFill()
    squircle.fill()

    // Draw emoji centered within the squircle
    let emoji = "🗡️"
    // Emoji size relative to squircle (not canvas) - 70% fills it nicely
    let fontSize = iconSize * 0.70

    // Use system font which includes Apple Color Emoji
    let font = NSFont.systemFont(ofSize: fontSize)

    let paragraphStyle = NSMutableParagraphStyle()
    paragraphStyle.alignment = .center

    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .paragraphStyle: paragraphStyle
    ]

    let attrString = NSAttributedString(string: emoji, attributes: attributes)
    let textSize = attrString.size()

    // Center within the iconRect (squircle bounds), not the full canvas
    let textRect = NSRect(
        x: iconRect.midX - (textSize.width / 2),
        y: iconRect.midY - (textSize.height / 2),
        width: textSize.width,
        height: textSize.height
    )

    attrString.draw(in: textRect)

    image.unlockFocus()

    // Apply squircle mask for clean edges
    let finalImage = NSImage(size: NSSize(width: cgSize, height: cgSize))
    finalImage.lockFocus()

    if let ctx = NSGraphicsContext.current?.cgContext {
        ctx.clear(rect)

        // Clip to squircle
        squircle.addClip()

        // Draw the image
        image.draw(in: rect)
    }

    finalImage.unlockFocus()

    // Save as PNG
    guard let tiffData = finalImage.tiffRepresentation,
          let bitmapRep = NSBitmapImageRep(data: tiffData),
          let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
        return false
    }

    do {
        try pngData.write(to: URL(fileURLWithPath: outputPath))
        return true
    } catch {
        return false
    }
}

// Icon sizes for macOS iconset
let iconSpecs: [(Int, String)] = [
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024, "icon_512x512@2x.png")
]

let iconsetDir = CommandLine.arguments[1]
var successCount = 0

for (size, filename) in iconSpecs {
    let outputPath = "\\(iconsetDir)/\\(filename)"
    if createIcon(size: size, outputPath: outputPath) {
        print("  ✓ \\(filename)")
        successCount += 1
    } else {
        print("  ✗ \\(filename)")
    }
}

if successCount == iconSpecs.count {
    print("SUCCESS")
} else if successCount > 0 {
    print("PARTIAL")
} else {
    print("FAILED")
}
`;

  // Write Swift script
  const swiftScriptPath = join(buildDir, "gen_icons.swift");
  writeFileSync(swiftScriptPath, swiftScript);

  let success = false;

  try {
    console.log("Generating icons with Swift/AppKit...");
    const result = execSync(`swift "${swiftScriptPath}" "${iconsetDir}" 2>&1`, {
      encoding: "utf-8",
      timeout: 60000,
    });
    console.log(result);

    if (result.includes("SUCCESS") || result.includes("PARTIAL")) {
      success = true;
    }
  } catch (err) {
    console.log("Swift generation failed:", err.message);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
  }

  // Clean up Swift script
  if (existsSync(swiftScriptPath)) {
    rmSync(swiftScriptPath);
  }

  if (!success) {
    console.log("");
    console.log("Icon generation failed. Please check Swift is available.");
    console.log("");
    process.exit(1);
  }

  // Convert iconset to icns
  console.log("");
  console.log("Converting to .icns...");
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, {
      stdio: "inherit",
    });
    console.log(`✓ Generated: ${icnsPath}`);
  } catch (err) {
    console.error("Failed to create .icns file:", err.message);
    process.exit(1);
  }

  // Clean up iconset directory
  rmSync(iconsetDir, { recursive: true });

  console.log("");
  console.log("Done! Icon saved to build/icon.icns");
  console.log("");
  console.log("To update the dev app, run:");
  console.log("  npm run electron:create-dev-app");
}

main().catch(console.error);
