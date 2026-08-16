import { open, stat } from "node:fs/promises";
import {
  permissionFromSandboxPolicy,
  reasoningEfforts,
  type RunConfiguration,
} from "./run-options";

export type RolloutState = {
  state: "idle" | "active" | "unknown";
  lastActivityAt: number | null;
  reason: string;
  runConfiguration?: RunConfiguration | null;
};

type InspectRolloutOptions = {
  deepFallback?: boolean;
};

type RolloutRecord = {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    phase?: string;
    model?: unknown;
    effort?: unknown;
    permission_profile?: unknown;
    sandbox_policy?: unknown;
  };
};

export function inspectRolloutText(text: string): Omit<RolloutState, "lastActivityAt"> {
  let state: RolloutState["state"] = "unknown";
  let reason = "No turn boundary found";
  let runConfiguration: RunConfiguration | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: RolloutRecord;
    try {
      record = JSON.parse(line) as RolloutRecord;
    } catch {
      continue;
    }
    const event = record.payload?.type;
    const phase = record.payload?.phase;

    if (record.type === "turn_context" && record.payload) {
      const profile = record.payload.permission_profile;
      const profileId =
        typeof profile === "string"
          ? profile
          : profile && typeof profile === "object"
            ? ["id", "profile", "name"]
                .map((key) => (profile as Record<string, unknown>)[key])
                .find((candidate): candidate is string => typeof candidate === "string")
            : undefined;
      const model = typeof record.payload.model === "string" ? record.payload.model : undefined;
      const effort =
        typeof record.payload.effort === "string" &&
        (reasoningEfforts as readonly string[]).includes(record.payload.effort)
          ? (record.payload.effort as RunConfiguration["effort"])
          : undefined;
      const permissions =
        profileId?.startsWith(":")
          ? profileId
          : permissionFromSandboxPolicy(record.payload.sandbox_policy);
      const next = {
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(permissions ? { permissions } : {}),
      };
      runConfiguration = Object.keys(next).length ? next : null;
    }

    if (event === "task_started" || event === "user_message") {
      state = "active";
      reason = event === "task_started" ? "A desktop turn has started" : "A user message has no completed turn yet";
    }
    if (event === "agent_message" && phase?.toLowerCase().includes("final")) {
      state = "idle";
      reason = "A final answer was persisted";
    }
    if (event === "task_complete") {
      state = "idle";
      reason = "The desktop turn completed";
    }
    if (event === "turn_aborted" || event === "turn_cancelled" || event === "turn_canceled") {
      state = "idle";
      reason = "The desktop turn ended without completing";
    }
  }

  return { state, reason, runConfiguration };
}

function inspectRolloutMarkers(text: string): Omit<RolloutState, "lastActivityAt"> {
  const markers: Array<{ marker: string; state: RolloutState["state"]; reason: string }> = [
    { marker: '"type":"task_started"', state: "active", reason: "A desktop turn has started" },
    { marker: '"type":"user_message"', state: "active", reason: "A user message has no completed turn yet" },
    { marker: '"phase":"final_answer"', state: "idle", reason: "A final answer was persisted" },
    { marker: '"phase":"final"', state: "idle", reason: "A final answer was persisted" },
    { marker: '"type":"task_complete"', state: "idle", reason: "The desktop turn completed" },
    { marker: '"type":"turn_aborted"', state: "idle", reason: "The desktop turn ended without completing" },
    { marker: '"type":"turn_cancelled"', state: "idle", reason: "The desktop turn ended without completing" },
    { marker: '"type":"turn_canceled"', state: "idle", reason: "The desktop turn ended without completing" },
  ];
  let latest: (typeof markers)[number] | null = null;
  let latestIndex = -1;
  for (const marker of markers) {
    const index = text.lastIndexOf(marker.marker);
    if (index > latestIndex) {
      latest = marker;
      latestIndex = index;
    }
  }
  return latest
    ? { state: latest.state, reason: latest.reason, runConfiguration: null }
    : { state: "unknown", reason: "No turn boundary found", runConfiguration: null };
}

async function inspectEarlierRollout(handle: Awaited<ReturnType<typeof open>>, endOffset: number) {
  const chunkBytes = 1024 * 1024;
  const maxFallbackBytes = 64 * 1024 * 1024;
  const minimumOffset = Math.max(0, endOffset - maxFallbackBytes);
  let position = endOffset;
  let newerPrefix = Buffer.alloc(0);

  while (position > minimumOffset) {
    const bytes = Math.min(chunkBytes, position - minimumOffset);
    position -= bytes;
    const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, position);
    const parsed = inspectRolloutMarkers(Buffer.concat([buffer, newerPrefix]).toString("utf8"));
    if (parsed.state !== "unknown") return parsed;
    newerPrefix = buffer.subarray(0, Math.min(128, buffer.length));
  }
  return { state: "unknown" as const, reason: "No turn boundary found", runConfiguration: null };
}

export async function inspectRollout(
  path: string | null | undefined,
  options: InspectRolloutOptions = {},
): Promise<RolloutState> {
  if (!path)
    return {
      state: "unknown",
      lastActivityAt: null,
      reason: "No rollout path was provided",
      runConfiguration: null,
    };
  try {
    const metadata = await stat(path);
    const handle = await open(path, "r");
    try {
      const maxBytes = 2 * 1024 * 1024;
      const bytes = Math.min(metadata.size, maxBytes);
      const buffer = Buffer.alloc(bytes);
      const offset = Math.max(0, metadata.size - bytes);
      await handle.read(buffer, 0, bytes, offset);
      let parsed = inspectRolloutText(buffer.toString("utf8"));
      if (parsed.state === "unknown" && options.deepFallback !== false) {
        const recentConfiguration = parsed.runConfiguration;
        parsed = inspectRolloutMarkers(buffer.toString("utf8"));
        if (parsed.state === "unknown" && offset > 0)
          parsed = await inspectEarlierRollout(handle, offset);
        if (recentConfiguration) parsed.runConfiguration = recentConfiguration;
      }
      return { ...parsed, lastActivityAt: metadata.mtimeMs };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return {
      state: "unknown",
      lastActivityAt: null,
      reason: error instanceof Error ? error.message : "Unable to read rollout",
      runConfiguration: null,
    };
  }
}
