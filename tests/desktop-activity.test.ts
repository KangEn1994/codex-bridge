import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodexBridge } from "../host/bridge";
import type { RolloutState } from "../host/rollout-state";

type BridgeInternals = {
  desktopActiveThreads: Map<string, number>;
  reconcileDesktopActivity(threadId: string, rollout: RolloutState): RolloutState;
};

test("keeps a desktop-dispatched task active until a newer completion is persisted", async () => {
  const bridge = new CodexBridge();
  const internals = bridge as unknown as BridgeInternals;
  internals.desktopActiveThreads.set("thread-1", 1_000);

  const staleIdle = internals.reconcileDesktopActivity("thread-1", {
    state: "idle",
    reason: "previous answer",
    lastActivityAt: 900,
  });
  assert.equal(staleIdle.state, "active");
  assert.equal(internals.desktopActiveThreads.has("thread-1"), true);

  const uncertain = internals.reconcileDesktopActivity("thread-1", {
    state: "unknown",
    reason: "turn boundary moved outside the tail window",
    lastActivityAt: 1_100,
  });
  assert.equal(uncertain.state, "active");
  assert.equal(internals.desktopActiveThreads.has("thread-1"), true);

  const completed = internals.reconcileDesktopActivity("thread-1", {
    state: "idle",
    reason: "final answer persisted",
    lastActivityAt: 1_200,
  });
  assert.equal(completed.state, "idle");
  assert.equal(internals.desktopActiveThreads.has("thread-1"), false);

  internals.reconcileDesktopActivity("thread-1", {
    state: "active",
    reason: "desktop turn observed",
    lastActivityAt: 1_300,
  });
  (bridge.rpc as unknown as { request: () => Promise<unknown> }).request = async () => ({
    data: [
      {
        id: "thread-1",
        name: null,
        preview: "testing",
        cwd: "C:\\workspace",
        source: "appServer",
        modelProvider: "openai",
        createdAt: 1,
        updatedAt: 2,
        status: { type: "notLoaded" },
        turns: [],
      },
    ],
    nextCursor: null,
  });
  const listed = await bridge.listThreads();
  assert.equal(listed.data[0].desktopActive, true);
});

test("detects an active Desktop rollout on the first task-list read", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-desktop-list-"));
  const rolloutPath = path.join(directory, "rollout.jsonl");
  await writeFile(
    rolloutPath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "event_msg",
      payload: { type: "task_started" },
    })}\n`,
    "utf8",
  );

  const bridge = new CodexBridge();
  (bridge.rpc as unknown as { request: () => Promise<unknown> }).request = async () => ({
    data: [
      {
        id: "thread-active-on-desktop",
        name: null,
        preview: "still running",
        cwd: "/workspace",
        source: "appServer",
        modelProvider: "openai",
        createdAt: 1,
        updatedAt: 2,
        status: { type: "notLoaded" },
        path: rolloutPath,
        turns: [],
      },
    ],
    nextCursor: null,
  });

  try {
    const listed = await bridge.listThreads();
    assert.equal(listed.data[0].desktopActive, true);
  } finally {
    await bridge.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("interrupts a Desktop-owned active turn through its renderer owner", async () => {
  const calls: Array<{ ownerClientId: string; threadId: string }> = [];
  const bridge = new CodexBridge({
    close() {},
    async findThreadOwner() {
      return "desktop-owner";
    },
    async interruptTurn(ownerClientId: string, threadId: string) {
      calls.push({ ownerClientId, threadId });
      return { ok: true, interruptedTurnId: "turn-desktop" };
    },
  } as never);
  const internals = bridge as unknown as BridgeInternals;
  internals.desktopActiveThreads.set("thread-1", Date.now());

  const result = await bridge.interrupt("thread-1");

  assert.deepEqual(calls, [
    { ownerClientId: "desktop-owner", threadId: "thread-1" },
  ]);
  assert.deepEqual(result, {
    interrupted: true,
    turnId: "turn-desktop",
    via: "desktop",
  });
});
