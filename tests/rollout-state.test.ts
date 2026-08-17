import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectRollout, inspectRolloutText } from "../host/rollout-state";

const record = (payload: Record<string, unknown>) => JSON.stringify({ timestamp: "2026-08-09T00:00:00Z", type: "event_msg", payload });

test("detects a desktop turn that has not finished", () => {
  const result = inspectRolloutText([
    record({ type: "task_started" }),
    record({ type: "user_message", message: "continue" }),
    record({ type: "agent_message", phase: "commentary", message: "working" }),
  ].join("\n"));
  assert.equal(result.state, "active");
});

test("detects a persisted final answer", () => {
  const result = inspectRolloutText([
    record({ type: "user_message", message: "continue" }),
    record({ type: "agent_message", phase: "final_answer", message: "done" }),
  ].join("\n"));
  assert.equal(result.state, "idle");
});

test("treats aborted turns as safe handoff boundaries", () => {
  const result = inspectRolloutText([
    record({ type: "user_message", message: "continue" }),
    record({ type: "turn_aborted" }),
  ].join("\n"));
  assert.equal(result.state, "idle");
});

test("keeps unknown state when no reliable boundary exists", () => {
  const result = inspectRolloutText("not-json\n" + record({ type: "token_count" }));
  assert.equal(result.state, "unknown");
});

test("reads the latest model, effort, and permission from turn context", () => {
  const result = inspectRolloutText([
    JSON.stringify({
      type: "turn_context",
      payload: {
        model: "gpt-test",
        effort: "high",
        permission_profile: { type: "disabled" },
        sandbox_policy: { type: "workspaceWrite" },
      },
    }),
    record({ type: "task_complete" }),
  ].join("\n"));
  assert.deepEqual(result.runConfiguration, {
    model: "gpt-test",
    effort: "high",
    permissions: ":workspace",
  });
});

test("recovers a turn boundary that moved beyond the recent tail window", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-rollout-state-"));
  const rolloutPath = path.join(directory, "rollout.jsonl");
  try {
    await writeFile(
      rolloutPath,
      [
        record({ type: "task_started" }),
        record({ type: "user_message", message: "continue" }),
        record({ type: "custom_tool_call_output", output: "x".repeat(2_500_000) }),
      ].join("\n"),
      "utf8",
    );
    assert.equal((await inspectRollout(rolloutPath)).state, "active");

    await writeFile(
      rolloutPath,
      [
        record({ type: "task_started" }),
        record({ type: "user_message", message: "continue" }),
        record({ type: "custom_tool_call_output", output: "x".repeat(2_500_000) }),
        record({ type: "task_complete" }),
      ].join("\n"),
      "utf8",
    );
    assert.equal((await inspectRollout(rolloutPath)).state, "idle");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses the latest rollout event time when the file mtime is stale", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-rollout-state-"));
  const rolloutPath = path.join(directory, "rollout.jsonl");
  const startedAt = "2026-08-17T11:10:35.165Z";
  const completedAt = "2026-08-17T11:10:50.415Z";
  try {
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({ timestamp: startedAt, type: "event_msg", payload: { type: "task_started" } }),
        JSON.stringify({ timestamp: completedAt, type: "event_msg", payload: { type: "task_complete" } }),
      ].join("\n"),
      "utf8",
    );
    const staleMtime = new Date("2026-08-17T09:06:39.797Z");
    await utimes(rolloutPath, staleMtime, staleMtime);

    const result = await inspectRollout(rolloutPath);

    assert.equal(result.state, "idle");
    assert.equal(result.lastActivityAt, Date.parse(completedAt));
    assert.ok(result.lastActivityAt > Date.parse(startedAt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
