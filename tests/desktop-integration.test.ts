import assert from "node:assert/strict";
import test from "node:test";
import { DesktopIntegrationService } from "../host/desktop-integration";

function idleDetail(cwd = "C:\\workspace") {
  return {
    thread: { cwd },
    handoff: {
      bridgeActive: false,
      bridgeOwned: false,
      desktopActive: false,
      state: "idle",
      queueLength: 0,
    },
  };
}

function createIpc(calls: string[]) {
  return {
    close() {
      calls.push("close");
    },
    async findThreadOwner() {
      return null;
    },
    async startTurn() {
      return {};
    },
    async interruptTurn() {
      return { ok: true };
    },
    async updateThreadSettings() {
      return { ok: true };
    },
    async announceThreadAvailable(threadId: string) {
      calls.push(`announce:${threadId}`);
    },
    async waitForThreadOwner(threadId: string, timeoutMs: number) {
      calls.push(`wait:${threadId}:${timeoutMs}`);
      return "desktop-owner";
    },
  };
}

test("opens an idle project thread in the required desktop order", async () => {
  const calls: string[] = [];
  const projects = {
    async ensure(projectPath: string) {
      return { status: "already_registered" as const, path: projectPath };
    },
    async openProject(projectPath: string) {
      calls.push(`open-project:${projectPath}`);
      return { status: "opened" as const, path: projectPath };
    },
    async getThreadPlacement(threadId: string) {
      calls.push(`placement:${threadId}`);
      return "project" as const;
    },
    async revealThread(threadId: string) {
      calls.push(`reveal:${threadId}`);
      return true;
    },
  };
  const service = new DesktopIntegrationService({
    ipc: createIpc(calls),
    projects,
    ownerReadyTimeoutMs: 25,
  });
  let reads = 0;

  const result = await service.openThread("thread-1", async () => {
    reads += 1;
    calls.push(`read:${reads}`);
    return idleDetail();
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    opened: true,
    projectRegistration: { status: "opened", path: "C:\\workspace" },
    placement: "project",
    desktopPreloaded: true,
    desktopPreloadRequested: true,
  });
  assert.deepEqual(calls, [
    "read:1",
    "placement:thread-1",
    "open-project:C:\\workspace",
    "announce:thread-1",
    "wait:thread-1:25",
    "read:2",
    "reveal:thread-1",
  ]);
});

test("does not touch Desktop when the thread is already busy", async () => {
  const calls: string[] = [];
  const service = new DesktopIntegrationService({
    ipc: createIpc(calls),
    projects: {
      async ensure(projectPath: string) {
        return { status: "already_registered" as const, path: projectPath };
      },
      async openProject(projectPath: string) {
        calls.push("open-project");
        return { status: "opened" as const, path: projectPath };
      },
      async getThreadPlacement() {
        calls.push("placement");
        return "project" as const;
      },
      async revealThread() {
        calls.push("reveal");
        return true;
      },
    },
  });
  const detail = idleDetail();
  detail.handoff.desktopActive = true;

  const result = await service.openThread("thread-busy", async () => detail);

  assert.equal(result.status, 409);
  assert.deepEqual(calls, []);
});

test("fails safely when Codex project placement cannot be read", async () => {
  const calls: string[] = [];
  const service = new DesktopIntegrationService({
    ipc: createIpc(calls),
    projects: {
      async ensure(projectPath: string) {
        return { status: "already_registered" as const, path: projectPath };
      },
      async openProject(projectPath: string) {
        calls.push("open-project");
        return { status: "opened" as const, path: projectPath };
      },
      async getThreadPlacement() {
        calls.push("placement");
        return "unknown" as const;
      },
      async revealThread() {
        calls.push("reveal");
        return true;
      },
    },
  });

  const result = await service.openThread("thread-unknown", async () => idleDetail());

  assert.equal(result.status, 503);
  assert.equal(result.body.placement, "unknown");
  assert.deepEqual(calls, ["placement"]);
});

test("rechecks ownership after preload and skips the deep link if the task became busy", async () => {
  const calls: string[] = [];
  const service = new DesktopIntegrationService({
    ipc: createIpc(calls),
    projects: {
      async ensure(projectPath: string) {
        return { status: "already_registered" as const, path: projectPath };
      },
      async openProject(projectPath: string) {
        calls.push("open-project");
        return { status: "opened" as const, path: projectPath };
      },
      async getThreadPlacement() {
        calls.push("placement");
        return "projectless" as const;
      },
      async revealThread() {
        calls.push("reveal");
        return true;
      },
    },
    ownerReadyTimeoutMs: 10,
  });
  let reads = 0;

  const result = await service.openThread("thread-race", async () => {
    reads += 1;
    const detail = idleDetail();
    if (reads === 2) detail.handoff.bridgeOwned = true;
    return detail;
  });

  assert.equal(result.status, 409);
  assert.equal(calls.includes("reveal"), false);
  assert.equal(calls.includes("open-project"), false);
});
