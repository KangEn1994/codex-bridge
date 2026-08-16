export type PendingUserMessage = {
  id: string;
  threadId: string;
  text: string;
  baselineMatches: number;
  status: "sending" | "accepted";
  attachmentPreviews?: string[];
  contextNames?: string[];
};

type UserMessageTurn = {
  items: ReadonlyArray<{
    type: string;
    content?: unknown;
  }>;
};

export function textFromUserContent(content: unknown) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) =>
      item && typeof item === "object" && "text" in item
        ? String(item.text || "")
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

export function countMatchingUserMessages(
  turns: ReadonlyArray<UserMessageTurn>,
  text: string,
) {
  return turns.reduce(
    (count, turn) =>
      count +
      turn.items.filter(
        (item) =>
          item.type === "userMessage" &&
          textFromUserContent(item.content) === text,
      ).length,
    0,
  );
}

export function reconcilePendingUserMessages(
  pendingMessages: ReadonlyArray<PendingUserMessage>,
  threadId: string,
  turns: ReadonlyArray<UserMessageTurn>,
) {
  return pendingMessages.filter(
    (pending) =>
      pending.threadId !== threadId ||
      countMatchingUserMessages(turns, pending.text) <= pending.baselineMatches,
  );
}

export function restoreFailedMessage(outgoing: string, currentDraft: string) {
  return currentDraft.trim() ? `${outgoing}\n${currentDraft}` : outgoing;
}
