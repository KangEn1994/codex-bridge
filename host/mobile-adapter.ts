import { localMarkdownImageReferences } from "./generated-images";

type JsonRecord = Record<string, unknown>;

const MAX_TEXT = 512_000;
const MAX_DETAIL_TEXT = 80_000;

function clipText(value: unknown, max = MAX_DETAIL_TEXT) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max)}\n\n[内容过长，已在手机端截断]`;
}

function compactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (/^data:[^;]+;base64,/i.test(value)) return "[二进制内容已省略]";
    return clipText(value);
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 5) return "[嵌套内容已省略]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => compactValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonRecord).slice(0, 100).map(([key, item]) => [key, compactValue(item, depth + 1)]));
  }
  return String(value);
}

function baseItem(item: JsonRecord) {
  return { type: String(item.type || "activity"), ...(item.id ? { id: item.id } : {}) };
}

export function compactThreadItem(item: JsonRecord): JsonRecord {
  const base = baseItem(item);
  const type = base.type;
  if (type === "userMessage") return { ...base, clientId: item.clientId, content: compactValue(item.content) };
  if (type === "agentMessage") {
    const localImages = localMarkdownImageReferences(item);
    return {
      ...base,
      phase: item.phase,
      text: clipText(item.text, MAX_TEXT),
      ...(localImages.length ? { localImages } : {}),
    };
  }
  if (type === "reasoning") return { ...base, summary: compactValue(item.summary) };
  if (type === "commandExecution") return { ...base, status: item.status, command: clipText(item.command, 40_000), cwd: clipText(item.cwd, 4_000), aggregatedOutput: clipText(item.aggregatedOutput, MAX_DETAIL_TEXT) };
  if (type === "fileChange") return { ...base, status: item.status, changes: compactValue(item.changes) };
  if (type === "mcpToolCall" || type === "dynamicToolCall" || type === "collabAgentToolCall") return { ...base, status: item.status, tool: item.tool || item.server || item.name, arguments: compactValue(item.arguments || item.input || {}) };
  if (type === "imageGeneration") return {
    ...base,
    status: item.status,
    revisedPrompt: clipText(item.revisedPrompt, 20_000),
    imageAvailable: Boolean(item.savedPath || item.result),
  };
  if (type === "webSearch") return { ...base, status: item.status, query: clipText(item.query, 8_000) };
  if (type === "plan") return { ...base, text: clipText(item.text, MAX_DETAIL_TEXT) };
  return { ...base, status: item.status, summary: compactValue(item.summary || item.text || item.name || "") };
}

type UserImageResolver = (sourcePath: string) => JsonRecord | null;

function compactThreadItemWithImages(
  item: JsonRecord,
  resolveUserImage?: UserImageResolver,
): JsonRecord {
  if (item.type !== "userMessage" || !resolveUserImage || !Array.isArray(item.content))
    return compactThreadItem(item);
  const content = item.content.map((value) => {
    const input = value && typeof value === "object" ? value as JsonRecord : null;
    if (input?.type === "localImage" && typeof input.path === "string")
      return resolveUserImage(input.path) || { type: "localImage" };
    return compactValue(value);
  });
  return { ...baseItem(item), clientId: item.clientId, content };
}

export function compactThreadDetail(
  detail: JsonRecord,
  requestedLimit = 40,
  resolveUserImage?: UserImageResolver,
) {
  const thread = (detail.thread || {}) as JsonRecord;
  const turns = Array.isArray(thread.turns) ? thread.turns as JsonRecord[] : [];
  const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit) || 40));
  const returnedTurns = turns.slice(-limit).map((turn) => ({
    ...turn,
    items: Array.isArray(turn.items)
      ? (turn.items as JsonRecord[]).map((item) => compactThreadItemWithImages(item, resolveUserImage))
      : [],
  }));
  return {
    ...detail,
    thread: { ...thread, turns: returnedTurns },
    history: { totalTurns: turns.length, returnedTurns: returnedTurns.length, hasEarlierTurns: turns.length > returnedTurns.length },
  };
}
