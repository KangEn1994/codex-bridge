import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, type ClientOptions, type RawData } from "ws";

const hostToken = "host-test-token-abcdefghijklmnopqrstuvwxyz-0123456789";
const phoneToken = "phone-test-token-abcdefghijklmnopqrstuvwxyz-0123456789";

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve a test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForHealth(origin: string, process: ChildProcess) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Relay exited early with code ${process.exitCode}`);
    try {
      const response = await fetch(`${origin}/relay/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await delay(50);
  }
  throw new Error("Relay did not become healthy");
}

function openSocket(url: string, options?: ClientOptions, onMessage?: (message: string) => void) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url, options);
    if (onMessage) socket.on("message", (data) => onMessage(String(data)));
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

test("relays allowlisted API requests and events through an authenticated computer socket", async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const relay = spawn(process.execPath, ["--import", "tsx", "relay/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      CODEX_RELAY_PUBLIC_URL: origin,
      CODEX_RELAY_WEB_INTERNAL_URL: "http://127.0.0.1:9",
      CODEX_RELAY_HOST_TOKEN: hostToken,
      CODEX_RELAY_PHONE_TOKEN: phoneToken,
    },
    stdio: "ignore",
  });

  try {
    await waitForHealth(origin, relay);
    const host = await openSocket(`${origin.replace("http", "ws")}/relay/host`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });

    host.on("message", (data) => {
      const request = JSON.parse(String(data)) as { type: string; id: string; method: string; path: string; body: string };
      if (request.type !== "request") return;
      let responsePayload: unknown = { data: [] };
      if (request.path === "/api/threads/large") responsePayload = { data: "x".repeat(2_200_000) };
      if (request.path === "/api/fs/browse?path=C%3A%5C") responsePayload = { path: "C:\\", entries: [] };
      if (request.path === "/api/codex-options?cwd=C%3A%5Cwork") {
        assert.equal(request.method, "GET");
        responsePayload = {
          models: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test" }],
          permissionProfiles: [{ id: ":workspace", allowed: true }],
          defaults: { model: "gpt-test", effort: "medium", permissions: ":workspace" },
          permissionMode: "profiles",
        };
      }
      if (request.path === "/api/fs/folders") {
        assert.equal(request.method, "POST");
        assert.deepEqual(JSON.parse(Buffer.from(request.body, "base64").toString()), {
          parent: "C:\\work",
          name: "new-project",
        });
        responsePayload = { name: "new-project", path: "C:\\work\\new-project" };
      }
      if (request.path === "/api/thread-drafts") {
        assert.equal(request.method, "POST");
        assert.deepEqual(JSON.parse(Buffer.from(request.body, "base64").toString()), {
          draftId: "draft-1",
          cwd: "C:\\work",
        });
        responsePayload = { draftId: "draft-1", thread: { id: "thread-1", cwd: "C:\\work" } };
      }
      if (request.path === "/api/thread-drafts/draft-1") {
        assert.equal(request.method, "DELETE");
        responsePayload = { discarded: true };
      }
      if (request.path === "/api/threads/thread-1/attachments") {
        assert.equal(request.method, "POST");
        assert.equal(Buffer.from(request.body, "base64").length, 1_200_000);
        responsePayload = { id: "attachment-1" };
      }
      if (request.path === "/api/threads/thread-1/run-configuration") {
        assert.equal(request.method, "PATCH");
        assert.deepEqual(JSON.parse(Buffer.from(request.body, "base64").toString()), {
          model: "gpt-test",
          effort: "high",
          permissions: ":workspace",
        });
        responsePayload = {
          configuration: {
            model: "gpt-test",
            effort: "high",
            permissions: ":workspace",
          },
          synced: true,
          via: "desktop",
          appliesTo: "next-turn",
        };
      }
      if (request.path === "/api/queue/item-1") {
        assert.equal(request.method, "PATCH");
        assert.deepEqual(JSON.parse(Buffer.from(request.body, "base64").toString()), { direction: "up" });
        responsePayload = { ok: true };
      }
      if (request.path === "/api/pair/exchange") {
        assert.equal(request.method, "POST");
        responsePayload = { server: origin, token: phoneToken };
      }
      host.send(JSON.stringify({
        type: "response",
        id: request.id,
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: Buffer.from(JSON.stringify(responsePayload)).toString("base64"),
      }));
    });

    const apiResponse = await fetch(`${origin}/api/threads`, { headers: { Authorization: `Bearer ${phoneToken}` } });
    assert.equal(apiResponse.status, 200);
    assert.deepEqual(await apiResponse.json(), { data: [] });

    const legacyProxyResponse = await fetch(`${origin}/bridge/api/threads`, {
      headers: { Authorization: `Bearer ${phoneToken}` },
    });
    assert.equal(legacyProxyResponse.status, 200);
    assert.deepEqual(await legacyProxyResponse.json(), { data: [] });

    const largeResponse = await fetch(`${origin}/api/threads/large`, {
      headers: { Authorization: `Bearer ${phoneToken}` },
    });
    assert.equal(largeResponse.status, 200);
    assert.equal(((await largeResponse.json()) as { data: string }).data.length, 2_200_000);

    const browseResponse = await fetch(`${origin}/api/fs/browse?path=C%3A%5C`, {
      headers: { Authorization: `Bearer ${phoneToken}` },
    });
    assert.equal(browseResponse.status, 200);
    assert.deepEqual(await browseResponse.json(), { path: "C:\\", entries: [] });

    const runOptionsResponse = await fetch(`${origin}/api/codex-options?cwd=C%3A%5Cwork`, {
      headers: { Authorization: `Bearer ${phoneToken}` },
    });
    assert.equal(runOptionsResponse.status, 200);
    assert.deepEqual(await runOptionsResponse.json(), {
      models: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test" }],
      permissionProfiles: [{ id: ":workspace", allowed: true }],
      defaults: { model: "gpt-test", effort: "medium", permissions: ":workspace" },
      permissionMode: "profiles",
    });

    const createFolderResponse = await fetch(`${origin}/api/fs/folders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${phoneToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ parent: "C:\\work", name: "new-project" }),
    });
    assert.equal(createFolderResponse.status, 200);
    assert.deepEqual(await createFolderResponse.json(), {
      name: "new-project",
      path: "C:\\work\\new-project",
    });

    const prepareDraftResponse = await fetch(`${origin}/api/thread-drafts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${phoneToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: "draft-1", cwd: "C:\\work" }),
    });
    assert.equal(prepareDraftResponse.status, 200);
    assert.deepEqual(await prepareDraftResponse.json(), {
      draftId: "draft-1",
      thread: { id: "thread-1", cwd: "C:\\work" },
    });

    const discardDraftResponse = await fetch(`${origin}/api/thread-drafts/draft-1`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${phoneToken}` },
    });
    assert.equal(discardDraftResponse.status, 200);
    assert.deepEqual(await discardDraftResponse.json(), { discarded: true });

    const runConfigurationResponse = await fetch(
      `${origin}/api/threads/thread-1/run-configuration`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${phoneToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-test",
          effort: "high",
          permissions: ":workspace",
        }),
      },
    );
    assert.equal(runConfigurationResponse.status, 200);
    assert.deepEqual(await runConfigurationResponse.json(), {
      configuration: {
        model: "gpt-test",
        effort: "high",
        permissions: ":workspace",
      },
      synced: true,
      via: "desktop",
      appliesTo: "next-turn",
    });

    const queueResponse = await fetch(`${origin}/api/queue/item-1`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${phoneToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "up" }),
    });
    assert.equal(queueResponse.status, 200);
    assert.deepEqual(await queueResponse.json(), { ok: true });

    const attachmentResponse = await fetch(`${origin}/api/threads/thread-1/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${phoneToken}`, "Content-Type": "image/jpeg" },
      body: Buffer.alloc(1_200_000, 7),
    });
    assert.equal(attachmentResponse.status, 200);
    assert.deepEqual(await attachmentResponse.json(), { id: "attachment-1" });

    const badPairOrigin = await fetch(`${origin}/api/pair/exchange`, {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ code: "one-time-code" }),
    });
    assert.equal(badPairOrigin.status, 403);

    const pairResponse = await fetch(`${origin}/api/pair/exchange`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "one-time-code" }),
    });
    assert.equal(pairResponse.status, 200);
    assert.deepEqual(await pairResponse.json(), { server: origin, token: phoneToken });

    const denied = await fetch(`${origin}/api/debug/recent`, { headers: { Authorization: `Bearer ${phoneToken}` } });
    assert.equal(denied.status, 404);

    const ticketResponse = await fetch(`${origin}/api/ws-ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${phoneToken}`, Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(ticketResponse.status, 201);
    const { ticket } = await ticketResponse.json() as { ticket: string };
    const phoneMessages: string[] = [];
    const phone = await openSocket(`${origin.replace("http", "ws")}/api/events?ticket=${encodeURIComponent(ticket)}`, {
      origin,
    }, (message) => phoneMessages.push(message));
    for (let attempt = 0; attempt < 20 && !phoneMessages.length; attempt += 1) await delay(10);
    assert.equal(JSON.parse(phoneMessages[0] || "{}").method, "bridge/hostState");
    assert.equal(JSON.parse(phoneMessages[0] || "{}").params.connected, true);
    const received = new Promise<string>((resolve) => {
      const listener = (data: RawData) => {
        const message = String(data);
        if (JSON.parse(message).method !== "bridge/test") return;
        phone.off("message", listener);
        resolve(message);
      };
      phone.on("message", listener);
    });
    const event = JSON.stringify({ method: "bridge/test", params: { ok: true }, at: Date.now() });
    host.send(JSON.stringify({ type: "event", data: event }));
    assert.equal(await received, event);

    host.close();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (phoneMessages.some((message) => {
        const parsed = JSON.parse(message);
        return parsed.method === "bridge/hostState" && parsed.params.connected === false;
      })) break;
      await delay(10);
    }
    assert.ok(phoneMessages.some((message) => {
      const parsed = JSON.parse(message);
      return parsed.method === "bridge/hostState" && parsed.params.connected === false;
    }));
    phone.close();
  } finally {
    relay.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => relay.once("exit", resolve)), delay(2_000)]);
    if (relay.exitCode === null) relay.kill("SIGKILL");
  }
});
