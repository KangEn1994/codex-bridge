import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const configText = await readFile(path.join(homedir(), ".codex-bridge", "relay.json"), "utf8");
const config = JSON.parse(configText.replace(/^\uFEFF/, ""));
const publicUrl = (process.argv[2] || config.publicUrl || "").replace(/\/+$/, "");
const localApkPath = process.argv[3] ? path.resolve(process.argv[3]) : "";
if (!/^https:\/\//i.test(publicUrl)) {
  throw new Error("Usage: node scripts/verify-public-relay.mjs https://bridge.example.com [local-apk]");
}
const authorization = `Bearer ${config.phoneToken}`;

const healthResponse = await fetch(`${publicUrl}/relay/health`);
if (!healthResponse.ok) throw new Error(`Public health failed: ${healthResponse.status}`);
const health = await healthResponse.json();

const threadsResponse = await fetch(`${publicUrl}/api/threads`, {
  headers: { Authorization: authorization },
});
if (!threadsResponse.ok) throw new Error(`Thread list failed: ${threadsResponse.status}`);
const threadsPayload = await threadsResponse.json();
const threadCount = Array.isArray(threadsPayload)
  ? threadsPayload.length
  : (threadsPayload.data?.length ?? threadsPayload.threads?.length ?? 0);

const legacyProxyResponse = await fetch(`${publicUrl}/bridge/api/threads`, {
  headers: { Authorization: authorization },
});
if (!legacyProxyResponse.ok) throw new Error(`Legacy proxy compatibility failed: ${legacyProxyResponse.status}`);

for (const pathname of ["/api/approvals", "/api/queue"]) {
  const response = await fetch(`${publicUrl}${pathname}`, { headers: { Authorization: authorization } });
  if (!response.ok) throw new Error(`${pathname} failed: ${response.status}`);
}
const firstThreadId = Array.isArray(threadsPayload) ? threadsPayload[0]?.id : threadsPayload.data?.[0]?.id;
if (firstThreadId) {
  const detailResponse = await fetch(`${publicUrl}/api/threads/${encodeURIComponent(firstThreadId)}`, {
    headers: { Authorization: authorization },
  });
  if (!detailResponse.ok) throw new Error(`Thread detail failed: ${detailResponse.status}`);
}

const ticketResponse = await fetch(`${publicUrl}/api/ws-ticket`, {
  method: "POST",
  headers: { Authorization: authorization },
});
if (!ticketResponse.ok) throw new Error(`Ticket request failed: ${ticketResponse.status}`);
const ticketPayload = await ticketResponse.json();

await new Promise((resolve, reject) => {
  const socketUrl = new URL("/api/events", publicUrl);
  socketUrl.protocol = "wss:";
  socketUrl.searchParams.set("ticket", ticketPayload.ticket);
  const socket = new WebSocket(socketUrl, {
    origin: publicUrl,
  });
  const timer = setTimeout(() => {
    socket.terminate();
    reject(new Error("WebSocket open timed out"));
  }, 10_000);
  socket.once("open", () => {
    clearTimeout(timer);
    socket.close();
    resolve();
  });
  socket.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

const digest = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();
let apk = null;
if (localApkPath) {
  const apkResponse = await fetch(`${publicUrl}/downloads/CodexBridge.apk`);
  if (!apkResponse.ok) throw new Error(`APK download failed: ${apkResponse.status}`);
  const remoteApk = Buffer.from(await apkResponse.arrayBuffer());
  const localApk = await readFile(localApkPath);
  apk = {
    bytes: remoteApk.length,
    hashMatch: digest(remoteApk) === digest(localApk),
    sha256: digest(remoteApk),
  };
}

console.log(
  JSON.stringify(
    {
      publicHealthy: health.ok === true,
      hostConnected: health.hostConnected === true,
      threadCount,
      legacyProxyCompatible: true,
      auxiliaryApisHealthy: true,
      webSocketConnected: true,
      apk,
    },
    null,
    2,
  ),
);
