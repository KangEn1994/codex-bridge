import assert from "node:assert/strict";
import test from "node:test";
import {
  PairingRequestError,
  PairingRequestStore,
  sanitizeDeviceName,
} from "../host/pairing";

test("creates a private, expiring pairing request and exposes only the public view", () => {
  let now = Date.parse("2026-08-16T00:00:00Z");
  const store = new PairingRequestStore(120_000, 10, 3, () => now);
  const created = store.create({
    deviceName: "  Pixel\n 9  ",
    remoteAddress: "192.168.1.25",
    userAgent: "CodexBridgeAndroid/0.6.0",
  });

  assert.equal(created.expiresIn, 120);
  assert.ok(created.requestId.length >= 20);
  assert.ok(created.requestSecret.length >= 32);
  assert.deepEqual(store.status(created.requestId, "wrong"), null);
  assert.equal(store.status(created.requestId, created.requestSecret)?.status, "pending");
  assert.deepEqual(store.listPending(), [
    {
      id: created.requestId,
      deviceName: "Pixel 9",
      remoteAddress: "192.168.1.25",
      userAgent: "CodexBridgeAndroid/0.6.0",
      createdAt: "2026-08-16T00:00:00.000Z",
      expiresAt: "2026-08-16T00:02:00.000Z",
      status: "pending",
    },
  ]);

  now += 120_001;
  assert.equal(store.listPending().length, 0);
  assert.equal(store.status(created.requestId, created.requestSecret), null);
});

test("approves or denies a request exactly once", () => {
  const store = new PairingRequestStore();
  const approved = store.create({ remoteAddress: "10.0.0.2" });
  assert.deepEqual(store.decide(approved.requestId, "approve"), { status: "approved" });
  assert.equal(store.status(approved.requestId, approved.requestSecret)?.status, "approved");
  assert.throws(
    () => store.decide(approved.requestId, "deny"),
    (error) => error instanceof PairingRequestError && error.status === 409,
  );

  const denied = store.create({ remoteAddress: "10.0.0.3" });
  store.decide(denied.requestId, "deny");
  assert.equal(store.status(denied.requestId, denied.requestSecret)?.status, "denied");
});

test("limits pending requests per remote address", () => {
  const store = new PairingRequestStore(120_000, 10, 2);
  store.create({ remoteAddress: "100.64.0.7" });
  store.create({ remoteAddress: "100.64.0.7" });
  assert.throws(
    () => store.create({ remoteAddress: "100.64.0.7" }),
    (error) => error instanceof PairingRequestError && error.status === 429,
  );
});

test("sanitizes untrusted device names", () => {
  assert.equal(sanitizeDeviceName("\u0000  My\t Phone \n"), "My Phone");
  assert.equal(sanitizeDeviceName(""), "Android device");
  assert.equal(sanitizeDeviceName("x".repeat(100)).length, 80);
});
