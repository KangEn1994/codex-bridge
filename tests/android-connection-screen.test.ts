import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainActivityUrl = new URL(
  "../android/app/src/main/java/com/codexbridge/mobile/MainActivity.java",
  import.meta.url,
);
const connectionActivityUrl = new URL(
  "../android/app/src/main/java/com/codexbridge/mobile/ConnectionActivity.kt",
  import.meta.url,
);

test("fresh Android installs use the offline Compose connection screen", async () => {
  const [mainActivity, connectionActivity, manifest] = await Promise.all([
    readFile(mainActivityUrl, "utf8"),
    readFile(connectionActivityUrl, "utf8"),
    readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
  ]);

  assert.match(mainActivity, /webView\.post\(\(\) -> showConnectionScreen\(\)\)/);
  assert.match(mainActivity, /new Intent\(this, ConnectionActivity\.class\)/);
  assert.doesNotMatch(mainActivity, /AlertDialog|showSettingsDialog/);
  assert.match(manifest, /android:name="\.ConnectionActivity"/);
  assert.match(connectionActivity, /text = "扫码连接电脑"/);
  assert.match(connectionActivity, /text = "手动输入地址和令牌"/);
  assert.match(connectionActivity, /Icons\.Default\.QrCodeScanner/);
});

test("the offline connection screen returns scans and manual tokens to the existing pairing flow", async () => {
  const [mainActivity, connectionActivity] = await Promise.all([
    readFile(mainActivityUrl, "utf8"),
    readFile(connectionActivityUrl, "utf8"),
  ]);

  assert.match(connectionActivity, /putExtra\(RESULT_SCAN, raw\)/);
  assert.match(connectionActivity, /putExtra\(RESULT_SERVER, server\)/);
  assert.match(connectionActivity, /putExtra\(RESULT_TOKEN, token\)/);
  assert.match(mainActivity, /handleScannedPairing\(scan\)/);
  assert.match(mainActivity, /connectToBridge\(server, token\)/);
  assert.match(mainActivity, /webView\.loadUrl\(pairingLaunchUrl\(bridgeUrl, payload\)\)/);
});

test("notification permission waits until a bridge page has loaded", async () => {
  const mainActivity = await readFile(mainActivityUrl, "utf8");
  const onCreate = mainActivity.slice(
    mainActivity.indexOf("protected void onCreate"),
    mainActivity.indexOf("protected void onNewIntent"),
  );

  assert.match(onCreate, /configureNotificationChannel\(\)/);
  assert.doesNotMatch(onCreate, /requestNotificationPermissionIfNeeded|requestPermissions/);
  assert.match(mainActivity, /onPageFinished[\s\S]*requestNotificationPermissionIfNeeded\(\)/);
  assert.match(mainActivity, /NOTIFICATION_PERMISSION_ASKED_KEY/);
});
