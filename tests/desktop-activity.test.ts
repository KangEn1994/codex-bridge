import assert from "node:assert/strict";
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
