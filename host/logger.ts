import os from "node:os";
import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";

export const bridgeLogPath = path.join(os.homedir(), ".codex-bridge", "bridge.jsonl");

export function logBridgeEvent(event: string, details: Record<string, unknown> = {}) {
  const entry = JSON.stringify({ at: new Date().toISOString(), event, ...details });
  void mkdir(path.dirname(bridgeLogPath), { recursive: true })
    .then(() => appendFile(bridgeLogPath, `${entry}\n`, "utf8"))
    .catch(() => undefined);
}
