import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the Codex Bridge application shell", async () => {
  const [layout, app] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/BridgeApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /title: "Codex Bridge"/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /codex-bridge-c\.svg/);
  assert.match(app, /连接 Codex Bridge/);
  assert.match(app, /电脑在线/);
  assert.match(app, /运行中/);
  assert.match(app, /已排队/);
  assert.match(app, /选择工作区/);
  assert.doesNotMatch(app, /复制全文/);
  assert.match(app, /没有匹配的任务/);
  assert.match(app, /创建并使用/);
  await access(new URL("../dist/server/index.js", import.meta.url));
});

test("ships installable PWA metadata and removes the starter preview", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "Codex Bridge");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.length, 2);
  await access(new URL("../public/sw.js", import.meta.url));
  await access(new URL("../public/icon-192.png", import.meta.url));
  await access(new URL("../public/icon-512.png", import.meta.url));
  await access(new URL("../public/codex-bridge-c.svg", import.meta.url));
  await access(new URL("../desktop/tray/assets/tray-icon.png", import.meta.url));
  await access(new URL("../desktop/tray/assets/codex-bridge.ico", import.meta.url));
  await assert.rejects(access(new URL("../public/codex-color.svg", import.meta.url)));
  await assert.rejects(access(new URL("../public/bridge-mark.svg", import.meta.url)));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("proxies every API method used by the mobile client", async () => {
  const route = await readFile(new URL("../app/bridge/[...path]/route.ts", import.meta.url), "utf8");
  for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
    assert.match(route, new RegExp(`export const ${method} = proxy`));
  }
});
