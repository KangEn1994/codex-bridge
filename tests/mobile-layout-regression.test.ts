import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("home and workspace screens stay inside the mobile viewport", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /html, body\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden[^}]*overscroll-behavior:\s*none/);
  assert.match(css, /\.bridge-shell\s*\{[^}]*height:\s*100dvh[^}]*display:\s*flex[^}]*overflow:\s*hidden/);
  assert.match(css, /\.screen\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*overflow:\s*hidden/);
  assert.match(css, /\.home-screen > \.screen-scroll, \.workspace-screen > \.screen-scroll\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/);
  assert.match(css, /html\.native-shell\s*\{[^}]*--safe-top:\s*4px[^}]*--safe-bottom:\s*1px/);
});

test("unbroken task titles cannot widen the home screen", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.attention-row, \.simple-task-row\s*\{[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/);
  assert.match(css, /\.attention-row strong, \.simple-task-row strong\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*-webkit-line-clamp:\s*2/);
  assert.match(css, /\.bottom-nav\s*\{[^}]*position:\s*relative[^}]*flex:\s*0 0 calc\(58px \+ var\(--safe-bottom\)\)[^}]*overflow:\s*hidden/);
});

test("the Android keyboard resizes the app instead of panning away its header", async () => {
  const manifest = await readFile(
    new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
    "utf8",
  );
  const activity = await readFile(
    new URL(
      "../android/app/src/main/java/com/codexbridge/mobile/MainActivity.java",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    manifest,
    /<activity\s+[^>]*android:name="\.MainActivity"[^>]*android:windowSoftInputMode="adjustResize"/,
  );
  assert.match(activity, /WindowCompat\.setDecorFitsSystemWindows\(getWindow\(\), false\)/);
  assert.match(activity, /WindowInsetsCompat\.Type\.ime\(\)/);
  assert.match(activity, /Math\.max\(systemBars\.bottom, keyboard\.bottom\)/);
});
