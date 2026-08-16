import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "public", "codex-bridge-c.svg"));

const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["android/app/src/main/res/mipmap-mdpi/ic_launcher.png", 48],
  ["android/app/src/main/res/mipmap-hdpi/ic_launcher.png", 72],
  ["android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", 96],
  ["android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", 144],
  ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", 192],
  ["desktop/tray/assets/tray-icon.png", 64],
];

for (const [relativePath, size] of targets) {
  const output = path.join(root, relativePath);
  await mkdir(path.dirname(output), { recursive: true });
  await sharp(source).resize(size, size).png().toFile(output);
  console.log(`${relativePath}: ${size}x${size}`);
}

const icoPng = await sharp(source).resize(256, 256).png().toBuffer();
const ico = Buffer.alloc(22 + icoPng.length);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 0;
ico[7] = 0;
ico[8] = 0;
ico[9] = 0;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(icoPng.length, 14);
ico.writeUInt32LE(22, 18);
icoPng.copy(ico, 22);

const icoPath = path.join(root, "desktop", "tray", "assets", "codex-bridge.ico");
await mkdir(path.dirname(icoPath), { recursive: true });
await writeFile(icoPath, ico);
console.log("desktop/tray/assets/codex-bridge.ico: 256x256");
