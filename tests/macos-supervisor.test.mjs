import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_LAUNCHER_CONFIG,
  MIN_CONNECTION_PASSWORD_LENGTH,
  normalizeSiteUrl,
  saveConnectionPassword,
  validateConnectionPassword,
  validateConnectionSettings,
} from "../macos/config.mjs";
import { BridgeState, buildSnapshot } from "../macos/supervisor-core.mjs";

test("validates the three macOS connection modes", () => {
  const local = validateConnectionSettings({ mode: "local" }, DEFAULT_LAUNCHER_CONFIG);
  assert.equal(local.launcher.listenAddress, "127.0.0.1");
  assert.equal(local.mobileUrl, "http://127.0.0.1:43110");

  const network = validateConnectionSettings(
    { mode: "network", address: "100.64.0.10" },
    DEFAULT_LAUNCHER_CONFIG,
  );
  assert.equal(network.launcher.listenAddress, "0.0.0.0");
  assert.equal(network.mobileUrl, "http://100.64.0.10:43110");

  const relay = validateConnectionSettings(
    {
      mode: "relay",
      relayPublicUrl: "https://bridge.example.com/",
      hostToken: "h".repeat(32),
      phoneToken: "p".repeat(32),
    },
    DEFAULT_LAUNCHER_CONFIG,
  );
  assert.equal(relay.launcher.listenAddress, "127.0.0.1");
  assert.equal(relay.mobileUrl, "https://bridge.example.com");
  assert.equal(relay.relay.publicUrl, "https://bridge.example.com");
});

test("rejects unsafe public relay and malformed network settings", () => {
  assert.throws(
    () => normalizeSiteUrl("http://bridge.example.com", { relay: true }),
    /HTTPS/,
  );
  assert.throws(
    () => validateConnectionSettings(
      { mode: "network", address: "169.254.1.2" },
      DEFAULT_LAUNCHER_CONFIG,
    ),
    /IPv4/,
  );
  assert.throws(
    () => validateConnectionSettings(
      {
        mode: "relay",
        relayPublicUrl: "https://bridge.example.com/path",
        hostToken: "h".repeat(32),
        phoneToken: "p".repeat(32),
      },
      DEFAULT_LAUNCHER_CONFIG,
    ),
    /根地址/,
  );
});

test("derives online, degraded, and offline macOS supervisor states", () => {
  const base = {
    launcher: DEFAULT_LAUNCHER_CONFIG,
    relayConfig: { configured: false, publicUrl: "", hostToken: "", phoneToken: "" },
    relay: { success: false, json: {} },
  };
  const online = buildSnapshot({
    ...base,
    api: { success: true, json: { codex: true } },
    web: { success: true },
    failureCount: 0,
  });
  assert.equal(online.state, BridgeState.ONLINE);

  const degraded = buildSnapshot({
    ...base,
    relayConfig: { configured: true, publicUrl: "https://bridge.example.com" },
    api: { success: true, json: { codex: true, relayConnected: false } },
    web: { success: true },
    relay: { success: true, json: { hostConnected: false } },
    failureCount: 0,
  });
  assert.equal(degraded.state, BridgeState.DEGRADED);

  const offline = buildSnapshot({
    ...base,
    api: { success: false, json: {} },
    web: { success: false },
    failureCount: 2,
  });
  assert.equal(offline.state, BridgeState.OFFLINE);
  assert.match(offline.detail, /Host/);
});

test("keeps the macOS management API on loopback and rejects browser CSRF", async () => {
  const [source, dashboard, dashboardScript] = await Promise.all([
    readFile(new URL("../macos/supervisor.mjs", import.meta.url), "utf8"),
    readFile(new URL("../macos/dashboard.html", import.meta.url), "utf8"),
    readFile(new URL("../macos/dashboard.js", import.meta.url), "utf8"),
  ]);
  assert.match(source, /server\.listen\(managerPort, "127\.0\.0\.1"/);
  assert.match(source, /validManagerHost\(request\)/);
  assert.match(source, /validMutationOrigin\(request\)/);
  assert.match(source, /\/api\/security\/connection-password/);
  assert.match(source, /throw new HttpError\(400, error instanceof Error/);
  assert.match(dashboard, /id="passwordForm"/);
  assert.match(dashboard, /id="connectionPassword"[^>]*minlength="12"/);
  assert.match(dashboardScript, /saveConnectionPassword/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin/);
});

test("validates and privately persists a rotated connection password", async () => {
  assert.equal(MIN_CONNECTION_PASSWORD_LENGTH, 12);
  assert.throws(
    () => validateConnectionPassword({ password: "a".repeat(11), confirmation: "a".repeat(11) }),
    /至少需要 12/,
  );
  assert.throws(
    () => validateConnectionPassword({ password: "a".repeat(12), confirmation: "b".repeat(12) }),
    /不一致/,
  );
  assert.equal(
    validateConnectionPassword({ password: "a".repeat(12), confirmation: "a".repeat(12) }),
    "a".repeat(12),
  );
  assert.throws(
    () => validateConnectionPassword({ password: `valid password ${"x".repeat(20)}`, confirmation: `valid password ${"x".repeat(20)}` }),
    /不能包含空格/,
  );

  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-bridge-password-"));
  const paths = { configDirectory: directory, hostConfig: path.join(directory, "config.json") };
  const password = `new-password-${"x".repeat(24)}`;
  try {
    await writeFile(paths.hostConfig, JSON.stringify({ token: "old", port: 43110 }), { mode: 0o600 });
    await saveConnectionPassword(paths, { password, confirmation: password });
    const saved = JSON.parse(await readFile(paths.hostConfig, "utf8"));
    assert.equal(saved.token, password);
    assert.equal(saved.port, 43110);
    assert.equal((await stat(paths.hostConfig)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
