import assert from "node:assert/strict";
import test from "node:test";
import { CodexBridge, type QueuedMessage } from "../host/bridge";
import type { CodexInput } from "../host/codex-input";
import type { CodexRunOverrides, RunConfiguration } from "../host/run-options";

type DispatchResult = {
  via: "desktop" | "bridge";
  turn: unknown;
};

type BridgeDispatchInternals = {
  queue: QueuedMessage[];
  retryAfter: Map<string, number>;
  dispatchMessage(
    threadId: string,
    input: CodexInput[],
    overrides?: CodexRunOverrides,
    configuration?: RunConfiguration,
  ): Promise<DispatchResult>;
  flushQueue(): Promise<void>;
  startTurn(): Promise<unknown>;
};

const input: CodexInput[] = [
  { type: "text", text: "continue", text_elements: [] },
];

test("rediscovers a Desktop owner and retries one stale IPC route", async () => {
  const owners = ["desktop-stale", "desktop-current"];
  const startedWith: string[] = [];
  const bridge = new CodexBridge({
    close() {},
    async findThreadOwner() {
      return owners.shift() || null;
    },
    async startTurn(ownerClientId: string) {
      startedWith.push(ownerClientId);
      if (ownerClientId === "desktop-stale") throw new Error("no-client-found");
      return { id: "turn-desktop" };
    },
  } as never);

  const result = await (
    bridge as unknown as BridgeDispatchInternals
  ).dispatchMessage("thread-1", input);

  assert.equal(result.via, "desktop");
  assert.deepEqual(result.turn, { id: "turn-desktop" });
  assert.deepEqual(startedWith, ["desktop-stale", "desktop-current"]);
});

test("does not start a competing Bridge writer after a Desktop owner routing failure", async () => {
  let bridgeWriterStarts = 0;
  let desktopStarts = 0;
  let closes = 0;
  const bridge = new CodexBridge({
    close() {
      closes += 1;
    },
    async findThreadOwner() {
      return "desktop-owner";
    },
    async startTurn() {
      desktopStarts += 1;
      throw new Error("client-cannot-handle-request");
    },
  } as never);
  const internals = bridge as unknown as BridgeDispatchInternals;
  internals.startTurn = async () => {
    bridgeWriterStarts += 1;
    return { id: "turn-bridge" };
  };

  await assert.rejects(
    () => internals.dispatchMessage("thread-1", input),
    /IPC route is unavailable/,
  );
  assert.equal(desktopStarts, 2);
  assert.equal(bridgeWriterStarts, 0);
  assert.equal(closes, 1);
});

test("backs off queued messages when the Desktop owner rejects dispatch", async () => {
  let bridgeWriterStarts = 0;
  const bridge = new CodexBridge({
    close() {},
    async findThreadOwner() {
      return "desktop-owner";
    },
    async startTurn() {
      throw new Error("Desktop handler rejected turn context");
    },
  } as never);
  const internals = bridge as unknown as BridgeDispatchInternals;
  internals.startTurn = async () => {
    bridgeWriterStarts += 1;
    return { id: "turn-bridge" };
  };
  internals.queue = [
    {
      id: "queue-1",
      threadId: "thread-1",
      text: "queued follow-up",
      createdAt: Date.now(),
    },
  ];
  (bridge.rpc as unknown as { started: boolean }).started = true;
  bridge.readThread = async () => ({
    thread: {
      id: "thread-1",
      name: null,
      preview: "",
      cwd: "/workspace",
      source: "appServer",
      modelProvider: "openai",
      createdAt: 1,
      updatedAt: 2,
      status: { type: "idle" },
      turns: [],
    },
    goal: null,
    handoff: {
      state: "idle",
      reason: "The desktop turn completed",
      lastActivityAt: Date.now() - 2_000,
      bridgeActive: false,
      bridgeOwned: false,
      desktopActive: false,
      bridgeTurnId: null,
      queueLength: 1,
      preferredRunConfiguration: null,
    },
  });

  const startedAt = Date.now();
  try {
    await internals.flushQueue();
  } finally {
    (bridge.rpc as unknown as { started: boolean }).started = false;
  }

  assert.equal(bridge.getQueue("thread-1").length, 1);
  assert.equal(bridgeWriterStarts, 0);
  assert.ok(
    (internals.retryAfter.get("thread-1") || 0) >= startedAt + 29_000,
  );
});
