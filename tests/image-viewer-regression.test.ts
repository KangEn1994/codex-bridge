import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("image viewer uses one web card and the Telephoto native gesture engine", async () => {
  const [web, native, serviceWorker] = await Promise.all([
    readFile(new URL("../app/BridgeApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/codexbridge/mobile/ImageViewerActivity.kt", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(web, /function ThreadImageCard/);
  assert.match(web, /<ThreadImageCard[\s\S]*generated: true/);
  assert.doesNotMatch(web, /function GeneratedImagePreview/);
  assert.match(native, /ZoomableAsyncImage/);
  assert.doesNotMatch(native, /rememberTransformableState|pointerInput/);
  assert.match(serviceWorker, /key !== IMAGE_CACHE/);
});
