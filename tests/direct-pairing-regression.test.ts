import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("direct pairing is unauthenticated only for requests and local-only for decisions", async () => {
  const server = await readFile(new URL("../host/server.ts", import.meta.url), "utf8");
  const createRoute = server.indexOf('url.pathname === "/api/pair/requests"');
  const authorizationGate = server.indexOf("if (!authorized(request, url, config.token))");
  assert.ok(createRoute >= 0 && createRoute < authorizationGate);
  assert.match(server, /pairingRequests\.status\(requestId, url\.searchParams\.get\("secret"\)/);
  assert.match(server, /Pairing requests can only be reviewed on this computer/);
  assert.match(server, /Pairing requests can only be approved on this computer/);
  assert.match(server, /!isLoopback\(request\) \|\| !authorized\(request, url, config\.token\)/);
  assert.match(server, /status\.status === "approved" \? \{ token: config\.token \}/);
});

test("the mobile app requests computer approval and never places the token in the address", async () => {
  const app = await readFile(new URL("../app/BridgeApp.tsx", import.meta.url), "utf8");
  assert.match(app, /requestComputerApproval/);
  assert.match(app, /"\/api\/pair\/requests"/);
  assert.match(app, /等待电脑确认/);
  assert.match(app, /localStorage\.setItem\(storageKey, JSON\.stringify\(next\)\)/);
  assert.doesNotMatch(app, /searchParams\.set\(["']token/);
});

test("local-only mode binds both the Host and web shell to loopback", async () => {
  const [start, web] = await Promise.all([
    readFile(new URL("../scripts/start-codex-bridge.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-web.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(start, /"-ListenAddress", \$ListenAddress/);
  assert.match(web, /\$webHostname = if \(\$ListenAddress -in/);
  assert.match(web, /--hostname \$webHostname/);
});

test("Windows release packages use bundled runtime entries", async () => {
  const [build, host, web] = await Promise.all([
    readFile(new URL("../scripts/build-windows-release.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-host.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-web.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(build, /host-server\.mjs/);
  assert.match(build, /web-server\.mjs/);
  assert.match(build, /CodexBridge-Windows-Setup\.exe/);
  assert.match(build, /CodexBridge-Windows-Portable\.zip/);
  assert.match(host, /runtime\\host-server\.mjs/);
  assert.match(web, /runtime\\web-server\.mjs/);
});

test("the macOS service supervisors brace variables next to localized punctuation", async () => {
  const [host, web] = await Promise.all([
    readFile(new URL("../scripts/run-host.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-web.sh", import.meta.url), "utf8"),
  ]);
  assert.match(host, /\$\{EXIT_CODE\}/);
  assert.match(web, /\$\{EXIT_CODE\}/);
  assert.doesNotMatch(host, /\$EXIT_CODE）/);
  assert.doesNotMatch(web, /\$EXIT_CODE）/);
});
