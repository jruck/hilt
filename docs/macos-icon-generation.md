# macOS Icon Generation for Electron Apps

## Why Most Icons Look Wrong

macOS icons use a **superellipse (squircle)** — not a rounded rectangle. The shape follows `|x|^n + |y|^n = r^n` with `n ≈ 5`. Icons also sit on a larger transparent canvas with specific margins. Getting either of these wrong makes your icon look off in the Dock.

## Apple's Icon Spec

- **Canvas**: 1024×1024px (the actual image size)
- **Icon shape**: 824×824px squircle centered on the canvas
- **Margin**: ~9.76% on each side (100px on a 1024px canvas)
- **Fill ratio**: 80.5% of the canvas is the visible icon shape
- **Background**: Transparent outside the squircle

These ratios scale to all required sizes.

## Required Sizes for `.iconset`

macOS requires these 10 PNG files in a `.iconset` directory:

| Filename | Pixel Size |
|----------|-----------|
| `icon_16x16.png` | 16×16 |
| `icon_16x16@2x.png` | 32×32 |
| `icon_32x32.png` | 32×32 |
| `icon_32x32@2x.png` | 64×64 |
| `icon_128x128.png` | 128×128 |
| `icon_128x128@2x.png` | 256×256 |
| `icon_256x256.png` | 256×256 |
| `icon_256x256@2x.png` | 512×512 |
| `icon_512x512.png` | 512×512 |
| `icon_512x512@2x.png` | 1024×1024 |

## The Pipeline

1. Generate all 10 PNGs using the Swift renderer below
2. Place them in a `build/icon.iconset/` directory
3. Run `iconutil -c icns build/icon.iconset -o build/icon.icns`
4. Reference `build/icon.icns` in your `electron-builder.yml`:
   ```yaml
   mac:
     icon: build/icon.icns
   ```

## Swift Renderer

This Swift script handles the squircle shape, margins, and canvas setup. Replace the `// === YOUR ICON CONTENT HERE ===` section with your own drawing logic — whatever you draw will be clipped to the squircle automatically.

Run with: `swift generate-icon.swift <output-iconset-dir>`

```swift
import Cocoa
import Foundation

// Superellipse (squircle) path — matches macOS icon shape
// n=5 is the correct exponent for Apple's icon squircle
func squirclePath(in rect: NSRect, n: CGFloat = 5) -> NSBezierPath {
    let path = NSBezierPath()
    let cx = rect.midX
    let cy = rect.midY
    let r = min(rect.width, rect.height) / 2

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
    let canvasRect = NSRect(x: 0, y: 0, width: cgSize, height: cgSize)

    // Apple spec: 824px icon on 1024px canvas = 9.76% margin per side
    let marginPercent: CGFloat = 0.0976
    let margin = cgSize * marginPercent
    let iconSize = cgSize - (margin * 2)
    let iconRect = NSRect(x: margin, y: margin, width: iconSize, height: iconSize)

    // Build the squircle path
    let squircle = squirclePath(in: iconRect)

    // --- Pass 1: Draw content onto canvas ---
    let image = NSImage(size: NSSize(width: cgSize, height: cgSize))
    image.lockFocus()

    guard let _ = NSGraphicsContext.current?.cgContext else {
        image.unlockFocus()
        return false
    }

    // Transparent canvas
    NSGraphicsContext.current?.cgContext.clear(canvasRect)

    // Fill squircle background
    NSColor.black.setFill()  // <-- change to your background color
    squircle.fill()

    // === YOUR ICON CONTENT HERE ===
    // Draw within `iconRect` — this is the visible squircle area.
    // Everything outside `iconRect` is margin (transparent).
    // Example: draw an image centered in iconRect, or render text, shapes, etc.
    // ===============================

    image.unlockFocus()

    // --- Pass 2: Clip to squircle for clean edges ---
    let finalImage = NSImage(size: NSSize(width: cgSize, height: cgSize))
    finalImage.lockFocus()

    if let ctx = NSGraphicsContext.current?.cgContext {
        ctx.clear(canvasRect)
        squircle.addClip()
        image.draw(in: canvasRect)
    }

    finalImage.unlockFocus()

    // --- Save as PNG ---
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

// --- Generate all 10 iconset sizes ---
let iconSpecs: [(Int, String)] = [
    (16,   "icon_16x16.png"),
    (32,   "icon_16x16@2x.png"),
    (32,   "icon_32x32.png"),
    (64,   "icon_32x32@2x.png"),
    (128,  "icon_128x128.png"),
    (256,  "icon_128x128@2x.png"),
    (256,  "icon_256x256.png"),
    (512,  "icon_256x256@2x.png"),
    (512,  "icon_512x512.png"),
    (1024, "icon_512x512@2x.png")
]

let iconsetDir = CommandLine.arguments[1]
var successCount = 0

for (size, filename) in iconSpecs {
    let outputPath = "\(iconsetDir)/\(filename)"
    if createIcon(size: size, outputPath: outputPath) {
        print("  ✓ \(filename)")
        successCount += 1
    } else {
        print("  ✗ \(filename)")
    }
}

exit(successCount == iconSpecs.count ? 0 : 1)
```

## Node.js Wrapper (Optional)

If you want to orchestrate this from a Node build script:

```js
import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const buildDir = join(process.cwd(), "build");
const iconsetDir = join(buildDir, "icon.iconset");
const icnsPath = join(buildDir, "icon.icns");

// Clean slate
if (existsSync(iconsetDir)) rmSync(iconsetDir, { recursive: true });
mkdirSync(iconsetDir, { recursive: true });

// Generate PNGs via Swift
execSync(`swift scripts/generate-icon.swift "${iconsetDir}"`, {
  stdio: "inherit",
  timeout: 60000,
});

// Pack into .icns
execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, {
  stdio: "inherit",
});

// Clean up
rmSync(iconsetDir, { recursive: true });
```

## Common Mistakes

- **Using a rounded rectangle** instead of a superellipse — the curves are different
- **No margin / wrong margin** — the icon shape must not fill the full canvas; 9.76% margin per side
- **Only generating one size** — macOS needs all 10 for crisp rendering at every context (Dock, Spotlight, Finder, etc.)
- **Skipping the clipping pass** — without it you get anti-aliasing artifacts at the squircle edges
- **Using ImageMagick/sharp to resize** — these don't render the squircle natively; generate each size from scratch at the correct pixel dimensions
