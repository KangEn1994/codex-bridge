import assert from "node:assert/strict";
import test from "node:test";
import {
  countMatchingUserMessages,
  reconcilePendingUserMessages,
  restoreFailedMessage,
  type PendingUserMessage,
} from "../app/pending-messages";

function userTurn(text: string) {
  return {
    items: [{ type: "userMessage", content: [{ type: "text", text }] }],
  };
}

test("keeps an optimistic message visible until the server history contains the new copy", () => {
  const text = "手机刚发送的消息";
  const pending: PendingUserMessage = {
    id: "pending-1",
    threadId: "thread-1",
    text,
    baselineMatches: 1,
    status: "accepted",
  };

  const unchangedHistory = [userTurn(text)];
  assert.equal(countMatchingUserMessages(unchangedHistory, text), 1);
  assert.deepEqual(
    reconcilePendingUserMessages([pending], "thread-1", unchangedHistory),
    [pending],
  );

  const synchronizedHistory = [userTurn(text), userTurn(text)];
  assert.deepEqual(
    reconcilePendingUserMessages([pending], "thread-1", synchronizedHistory),
    [],
  );
});

test("reconciliation only removes optimistic messages for the refreshed thread", () => {
  const pending: PendingUserMessage = {
    id: "pending-2",
    threadId: "thread-2",
    text: "另一任务的消息",
    baselineMatches: 0,
    status: "sending",
  };

  assert.deepEqual(
    reconcilePendingUserMessages([pending], "thread-1", [userTurn(pending.text)]),
    [pending],
  );
});

test("restores a failed message without overwriting text typed during the request", () => {
  assert.equal(restoreFailedMessage("发送失败的内容", ""), "发送失败的内容");
  assert.equal(
    restoreFailedMessage("发送失败的内容", "随后输入的新内容"),
    "发送失败的内容\n随后输入的新内容",
  );
});
