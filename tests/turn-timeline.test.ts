import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTurnTimeline,
  resolveProcessGroupOpen,
  shouldAutomaticallyOpenProcessGroup,
} from "../app/turn-timeline";

test("keeps assistant narration inline and groups only technical activity", () => {
  const timeline = buildTurnTimeline([
    { id: "user", type: "userMessage", content: [] },
    { id: "reason", type: "reasoning", summary: ["internal"] },
    {
      id: "commentary-1",
      type: "agentMessage",
      phase: "commentary",
      text: "正在检查连接。",
    },
    { id: "command", type: "commandExecution", command: "npm test" },
    { id: "file", type: "fileChange", changes: [] },
    {
      id: "commentary-2",
      type: "agentMessage",
      phase: "commentary",
      text: "已经定位到问题。",
    },
    {
      id: "final",
      type: "agentMessage",
      phase: "final_answer",
      text: "修好了。",
    },
  ]);

  assert.deepEqual(
    timeline.map((segment) =>
      segment.kind === "activities"
        ? [segment.kind, segment.items.map((item) => item.id)]
        : segment.kind === "assistant"
          ? [segment.kind, segment.item.id, segment.commentary]
          : [segment.kind, segment.item.id],
    ),
    [
      ["activities", ["reason"]],
      ["assistant", "commentary-1", true],
      ["activities", ["command", "file"]],
      ["assistant", "commentary-2", true],
      ["assistant", "final", false],
    ],
  );
});

test("treats legacy agent messages without a phase as final answers", () => {
  const timeline = buildTurnTimeline([
    { id: "legacy", type: "agentMessage", text: "完成" },
  ]);

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].kind, "assistant");
  if (timeline[0].kind === "assistant")
    assert.equal(timeline[0].commentary, false);
});

test("keeps generated images as first-class timeline content", () => {
  const timeline = buildTurnTimeline([
    { id: "command", type: "commandExecution", command: "prepare" },
    { id: "image", type: "imageGeneration", imageAvailable: true },
    { id: "reason", type: "reasoning", summary: ["continue"] },
  ]);

  assert.deepEqual(
    timeline.map((segment) =>
      segment.kind === "activities"
        ? [segment.kind, segment.items.map((item) => item.id)]
        : [segment.kind, segment.item.id],
    ),
    [
      ["activities", ["command"]],
      ["image", "image"],
      ["activities", ["reason"]],
    ],
  );
});

test("lets automatic process visibility yield to explicit user choices", () => {
  assert.equal(resolveProcessGroupOpen(null, true), true);
  assert.equal(resolveProcessGroupOpen(null, false), false);
  assert.equal(resolveProcessGroupOpen(false, true), false);
  assert.equal(resolveProcessGroupOpen(true, false), true);

  assert.equal(shouldAutomaticallyOpenProcessGroup(true, true, false), true);
  assert.equal(shouldAutomaticallyOpenProcessGroup(true, false, false), false);
  assert.equal(shouldAutomaticallyOpenProcessGroup(false, true, false), false);
  assert.equal(shouldAutomaticallyOpenProcessGroup(true, true, true), false);
});
