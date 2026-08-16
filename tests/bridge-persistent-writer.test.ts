import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodexBridge } from "../host/bridge";
import { CodexRpcClient } from "../host/codex-rpc";

type BridgeInternals = {
  queuePath: string;
  runConfigurationsPath: string;
  activeTurns: Map<string, string>;
  releaseOwnedThread(threadId: string, client: CodexRpcClient): Promise<void>;
};

test("draft tasks use isolated warm writer leases and release ownership after completion", async () => {
  const prototype = CodexRpcClient.prototype as unknown as Record<string, unknown>;
  const originalStart = prototype.start;
  const originalStop = prototype.stop;
  const originalRequest = prototype.request;
  const originalStarted = Object.getOwnPropertyDescriptor(CodexRpcClient.prototype, "isStarted");

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-bridge-writer-"));
  const started = new Set<object>();
  const threadStarts: Array<{ id: string; cwd: string; client: object }> = [];
  const turnStarts: Array<{
    threadId: string;
    cwd?: string;
    client: object;
    model?: string;
    effort?: string;
    permissions?: string;
  }> = [];
  const turnSteers: Array<{
    threadId: string;
    expectedTurnId: string;
    text: string;
    imagePath?: string;
  }> = [];
  const turnInterrupts: Array<{ threadId: string; turnId: string; client: object }> = [];
  const goals = new Map<string, Record<string, unknown>>();
  const unsubscribed: string[] = [];
  let processStartCount = 0;
  let processStopCount = 0;

  Object.defineProperty(CodexRpcClient.prototype, "isStarted", {
    configurable: true,
    get() {
      return started.has(this);
    },
  });
  prototype.start = async function () {
    processStartCount += 1;
    started.add(this);
  };
  prototype.stop = async function () {
    if (started.delete(this)) processStopCount += 1;
  };
  prototype.request = async function (_method: string, params: Record<string, unknown>) {
    if (_method === "model/list") {
      return {
        data: [{
          id: "gpt-test",
          model: "gpt-test",
          displayName: "GPT Test",
          description: "Test model",
          hidden: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Fast" },
            { reasoningEffort: "medium", description: "Balanced" },
          ],
          inputModalities: ["text"],
          isDefault: true,
        }],
        nextCursor: null,
      };
    }
    if (_method === "permissionProfile/list") {
      return {
        data: [{ id: ":workspace", description: null, allowed: true }],
        nextCursor: null,
      };
    }
    if (_method === "thread/start") {
      const id = `thread-${threadStarts.length + 1}`;
      const cwd = String(params.cwd);
      threadStarts.push({ id, cwd, client: this });
      return { thread: { id, cwd } };
    }
    if (_method === "turn/start") {
      turnStarts.push({
        threadId: String(params.threadId),
        cwd: params.cwd ? String(params.cwd) : undefined,
        client: this,
        model: params.model ? String(params.model) : undefined,
        effort: params.effort ? String(params.effort) : undefined,
        permissions: params.permissions ? String(params.permissions) : undefined,
      });
      return { turn: { id: `turn-${turnStarts.length}`, status: "inProgress" } };
    }
    if (_method === "turn/steer") {
      const input = params.input as Array<{ type?: string; text?: string; path?: string }>;
      turnSteers.push({
        threadId: String(params.threadId),
        expectedTurnId: String(params.expectedTurnId),
        text: String(input.find((item) => item.type === "text")?.text || ""),
        imagePath: input.find((item) => item.type === "localImage")?.path,
      });
      return { turnId: String(params.expectedTurnId) };
    }
    if (_method === "turn/interrupt") {
      turnInterrupts.push({
        threadId: String(params.threadId),
        turnId: String(params.turnId),
        client: this,
      });
      return {};
    }
    if (_method === "thread/goal/get") {
      return { goal: goals.get(String(params.threadId)) || null };
    }
    if (_method === "thread/goal/set") {
      const threadId = String(params.threadId);
      const goal = {
        threadId,
        objective: String(params.objective || goals.get(threadId)?.objective || ""),
        status: String(params.status || goals.get(threadId)?.status || "active"),
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      };
      goals.set(threadId, goal);
      return { goal };
    }
    if (_method === "thread/goal/clear") {
      goals.delete(String(params.threadId));
      return {};
    }
    if (_method === "thread/unsubscribe") {
      unsubscribed.push(String(params.threadId));
      return { status: "unsubscribed" };
    }
    throw new Error(`Unexpected RPC method: ${_method}`);
  };

  const bridge = new CodexBridge();
  const bridgeInternals = bridge as unknown as BridgeInternals;
  bridgeInternals.queuePath = path.join(temporaryDirectory, "queue.json");
  bridgeInternals.runConfigurationsPath = path.join(
    temporaryDirectory,
    "run-configurations.json",
  );

  try {
    await bridge.start();
    assert.equal(threadStarts.length, 0, "Host startup must not create a workspace-less task");

    await Promise.all([
      bridge.prepareDraft("draft-a", "C:\\workspace-a"),
      bridge.prepareDraft("draft-b", "C:\\workspace-b"),
    ]);
    assert.deepEqual(
      threadStarts.map(({ cwd }) => cwd).sort(),
      ["C:\\workspace-a", "C:\\workspace-b"],
    );
    assert.notEqual(
      threadStarts[0].client,
      threadStarts[1].client,
      "each prepared task must own a separate writer process",
    );

    const [first, second] = await Promise.all([
      bridge.createThread({
        draftId: "draft-a",
        cwd: "C:\\workspace-a",
        text: "first",
        runConfiguration: {
          model: "gpt-test",
          effort: "low",
          permissions: ":workspace",
        },
      }),
      bridge.createThread({ draftId: "draft-b", cwd: "C:\\workspace-b", text: "second" }),
    ]);
    assert.notEqual(first.id, second.id);
    assert.deepEqual(turnStarts.map(({ cwd }) => cwd), [undefined, undefined]);
    const configuredTurn = turnStarts.find((turn) => turn.threadId === first.id);
    assert.deepEqual(
      {
        model: configuredTurn?.model,
        effort: configuredTurn?.effort,
        permissions: configuredTurn?.permissions,
      },
      { model: "gpt-test", effort: "low", permissions: ":workspace" },
    );
    assert.equal(threadStarts.length, 2, "claiming a prepared task must not call thread/start again");
    for (const startedThread of threadStarts.slice(0, 2)) {
      const startedTurn = turnStarts.find(({ threadId }) => threadId === startedThread.id);
      assert.equal(
        startedTurn?.client,
        startedThread.client,
        "claiming a prepared task must continue on its leased writer process",
      );
    }

    const originalReadThread = bridge.readThread.bind(bridge);
    bridge.readThread = async (threadId, includeTurns, waitForLoadMs) => {
      if (threadId !== first.id)
        return originalReadThread(threadId, includeTurns, waitForLoadMs);
      return {
        thread: { ...first, turns: [] },
        goal: null,
        handoff: {
          state: "active" as const,
          reason: "test turn is active",
          runConfiguration: {
            model: "gpt-test",
            effort: "low",
            permissions: ":workspace",
          },
          lastActivityAt: Date.now(),
          bridgeActive: true,
          bridgeOwned: true,
          desktopActive: false,
          bridgeTurnId: "turn-1",
          queueLength: 0,
          preferredRunConfiguration: {
            model: "gpt-test",
            effort: "low",
            permissions: ":workspace",
          },
        },
      };
    };

    const steered = await bridge.sendMessage(first.id, "follow-up while running", {
      queueIfBusy: true,
      steerIfBusy: true,
      imagePaths: ["C:\\photos\\phone.webp"],
    });
    assert.equal(steered.steered, true);
    assert.deepEqual(turnSteers, [
      {
        threadId: first.id,
        expectedTurnId: String(
          (bridge as unknown as BridgeInternals).activeTurns.get(first.id),
        ),
        text: "follow-up while running",
        imagePath: "C:\\photos\\phone.webp",
      },
    ]);
    assert.equal(bridge.getQueue(first.id).length, 0, "steered messages must not enter the queue");

    const goal = await bridge.setThreadGoal(first.id, {
      objective: "Finish the test",
      status: "active",
    });
    assert.equal(goal?.objective, "Finish the test");
    assert.equal((await bridge.getThreadGoal(first.id))?.status, "active");

    const firstTurnId = String(
      (bridge as unknown as BridgeInternals).activeTurns.get(first.id),
    );
    const interrupted = await bridge.interrupt(first.id);
    assert.equal(interrupted.turnId, firstTurnId);
    assert.deepEqual(turnInterrupts, [{
      threadId: first.id,
      turnId: firstTurnId,
      client: threadStarts[0].client,
    }]);

    await bridge.clearThreadGoal(first.id);
    assert.equal(await bridge.getThreadGoal(first.id), null);

    const internals = bridge as unknown as BridgeInternals;
    internals.activeTurns.delete(first.id);
    await internals.releaseOwnedThread(first.id, threadStarts[0].client as CodexRpcClient);
    assert.ok(unsubscribed.includes(first.id));
    assert.equal(
      started.has(threadStarts[0].client),
      false,
      "a completed task must stop its writer process so Codex Desktop can reopen it",
    );

    await bridge.prepareDraft("draft-switch", "C:\\workspace-old");
    await bridge.prepareDraft("draft-switch", "C:\\workspace-new");
    assert.ok(unsubscribed.includes("thread-3"), "changing workspace should release the old blank task");
    const switched = await bridge.createThread({
      draftId: "draft-switch",
      cwd: "C:\\workspace-new",
      text: "switched",
    });
    assert.equal(switched.cwd, "C:\\workspace-new");

    await bridge.prepareDraft("draft-cancel", "C:\\workspace-cancel");
    assert.equal(bridge.discardDraft("draft-cancel"), true);
    await assert.rejects(
      () => bridge.prepareDraft("draft-cancel", "C:\\workspace-cancel"),
      /cancelled/i,
    );

    assert.ok(processStartCount >= 6, "writer leases should be replenished by a warm spare");
    assert.ok(processStopCount >= 2, "completed and replaced drafts should stop their writer processes");
  } finally {
    await bridge.stop();
    prototype.start = originalStart;
    prototype.stop = originalStop;
    prototype.request = originalRequest;
    if (originalStarted) Object.defineProperty(CodexRpcClient.prototype, "isStarted", originalStarted);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  assert.equal(processStopCount, processStartCount, "stopping the bridge must release every app-server process");
});
