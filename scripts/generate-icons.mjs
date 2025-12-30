import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const iconsetDir = join(buildDir, 'icon.iconset');

// Ensure iconset directory exists
mkdirSync(iconsetDir, { recursive: true });

const svgPath = join(buildDir, 'icon.svg');
const svg = readFileSync(svgPath);

// macOS iconset sizes
const sizes = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

console.log('Generating icon sizes...');

for (const { name, size } of sizes) {
  const outputPath = join(iconsetDir, name);
  await sharp(svg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(outputPath);
  console.log(`  Created ${name} (${size}x${size})`);
}

console.log('\nAll icon sizes generated!');
console.log('Run: iconutil -c icns build/icon.iconset -o build/icon.icns');
