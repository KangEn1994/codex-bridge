import assert from "node:assert/strict";
import test from "node:test";
import { compactThreadDetail, compactThreadItem } from "../host/mobile-adapter";

test("replaces generated image payloads with lightweight availability metadata", () => {
  const item = compactThreadItem({
    type: "imageGeneration",
    id: "image-1",
    status: "completed",
    result: `data:image/png;base64,${"x".repeat(1_000_000)}`,
    savedPath: "C:\\preview.png",
  });
  assert.deepEqual(item, {
    type: "imageGeneration",
    id: "image-1",
    status: "completed",
    revisedPrompt: "",
    imageAvailable: true,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(item)) < 1_000);
});

test("returns a bounded recent window with history metadata", () => {
  const detail = compactThreadDetail({
    thread: {
      id: "thread-1",
      turns: Array.from({ length: 60 }, (_, index) => ({
        id: `turn-${index}`,
        items: [{ type: "agentMessage", text: `message-${index}` }],
      })),
    },
    handoff: { state: "idle" },
  }, 40) as unknown as { thread: { turns: Array<{ id: string }> }; history: { totalTurns: number; returnedTurns: number; hasEarlierTurns: boolean } };
  assert.equal(detail.thread.turns[0].id, "turn-20");
  assert.deepEqual(detail.history, { totalTurns: 60, returnedTurns: 40, hasEarlierTurns: true });
});

test("adds lightweight asset references for local images in assistant markdown", () => {
  const item = compactThreadItem({
    type: "agentMessage",
    id: "message-1",
    text: "效果图：\n\n![手机截图](C:\\Screenshots\\phone.png)",
  });
  assert.equal(item.text, "效果图：\n\n![手机截图](C:\\Screenshots\\phone.png)");
  assert.deepEqual(
    (item.localImages as Array<Record<string, unknown>>).map(({ source, id }) => ({
      source,
      validId: typeof id === "string" && id.startsWith("media-"),
    })),
    [{ source: "C:\\Screenshots\\phone.png", validId: true }],
  );
});

test("replaces user local-image paths with authenticated attachment ids", () => {
  const detail = compactThreadDetail({
    thread: {
      id: "thread-1",
      turns: [{
        id: "turn-1",
        items: [{
          type: "userMessage",
          content: [
            { type: "text", text: "看看这张图" },
            { type: "localImage", path: "C:\\private\\phone.png" },
          ],
        }],
      }],
    },
  }, 40, () => ({ type: "localImage", attachmentId: "attachment-1" })) as unknown as {
    thread: { turns: Array<{ items: Array<{ content: unknown }> }> };
  };
  assert.deepEqual(detail.thread.turns[0].items[0].content, [
    { type: "text", text: "看看这张图" },
    { type: "localImage", attachmentId: "attachment-1" },
  ]);
  assert.doesNotMatch(JSON.stringify(detail), /C:\\\\private/);
});
