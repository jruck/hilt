import Cocoa
import Foundation

// Superellipse (squircle) path generator
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
    let rect = NSRect(x: 0, y: 0, width: cgSize, height: cgSize)

    let marginPercent: CGFloat = 0.0976
    let margin = cgSize * marginPercent
    let iconSize = cgSize - (margin * 2)
    let iconRect = NSRect(x: margin, y: margin, width: iconSize, height: iconSize)

    let image = NSImage(size: NSSize(width: cgSize, height: cgSize))
    image.lockFocus()

    guard let context = NSGraphicsContext.current?.cgContext else {
        image.unlockFocus()
        return false
    }

    context.clear(rect)

    let squircle = squirclePath(in: iconRect)

    NSColor.black.setFill()
    squircle.fill()

    let emoji = "🗡️"
    let fontSize = iconSize * 0.70
    let font = NSFont.systemFont(ofSize: fontSize)

    let paragraphStyle = NSMutableParagraphStyle()
    paragraphStyle.alignment = .center

    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .paragraphStyle: paragraphStyle
    ]

    let attrString = NSAttributedString(string: emoji, attributes: attributes)
    let textSize = attrString.size()

    let textRect = NSRect(
        x: iconRect.midX - (textSize.width / 2),
        y: iconRect.midY - (textSize.height / 2),
        width: textSize.width,
        height: textSize.height
    )

    attrString.draw(in: textRect)
    image.unlockFocus()

    let finalImage = NSImage(size: NSSize(width: cgSize, height: cgSize))
    finalImage.lockFocus()

    if let ctx = NSGraphicsContext.current?.cgContext {
        ctx.clear(rect)
        squircle.addClip()
        image.draw(in: rect)
    }

    finalImage.unlockFocus()

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

let outputDir = CommandLine.arguments[1]

// Generate web icons
let webIcons: [(Int, String)] = [
    (180, "apple-touch-icon.png"),
    (512, "icon-512.png"),
    (192, "icon-192.png"),
    (32, "favicon-32.png"),
    (16, "favicon-16.png")
]

for (size, filename) in webIcons {
    let outputPath = "\(outputDir)/\(filename)"
    if createIcon(size: size, outputPath: outputPath) {
        print("✓ \(filename)")
    } else {
        print("✗ \(filename)")
    }
}

print("DONE")
