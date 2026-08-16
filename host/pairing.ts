import { randomBytes, timingSafeEqual } from "node:crypto";

export type PairingRequestStatus = "pending" | "approved" | "denied";

export type PairingRequestView = {
  id: string;
  deviceName: string;
  remoteAddress: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  status: PairingRequestStatus;
};

type PairingRequestRecord = PairingRequestView & {
  secret: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type PairingRequestStatusView = {
  status: PairingRequestStatus;
  expiresAt: string;
};

export class PairingRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sanitizeDeviceName(value: unknown) {
  const withoutControls = Array.from(String(value || ""), (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  const compact = withoutControls
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return compact || "Android device";
}

export class PairingRequestStore {
  private readonly records = new Map<string, PairingRequestRecord>();

  constructor(
    private readonly lifetimeMs = 2 * 60_000,
    private readonly maxPending = 64,
    private readonly maxPendingPerAddress = 5,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: { deviceName?: unknown; remoteAddress?: string; userAgent?: string }) {
    this.prune();
    const remoteAddress = String(input.remoteAddress || "unknown").slice(0, 96);
    const pendingForAddress = [...this.records.values()].filter(
      (record) => record.status === "pending" && record.remoteAddress === remoteAddress,
    ).length;
    if (pendingForAddress >= this.maxPendingPerAddress)
      throw new PairingRequestError("Too many pending pairing requests from this device", 429);
    if ([...this.records.values()].filter((record) => record.status === "pending").length >= this.maxPending)
      throw new PairingRequestError("Too many pending pairing requests", 429);

    const createdAtMs = this.now();
    const expiresAtMs = createdAtMs + this.lifetimeMs;
    const record: PairingRequestRecord = {
      id: randomBytes(18).toString("base64url"),
      secret: randomBytes(32).toString("base64url"),
      deviceName: sanitizeDeviceName(input.deviceName),
      remoteAddress,
      userAgent: String(input.userAgent || "").slice(0, 240),
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      createdAtMs,
      expiresAtMs,
      status: "pending",
    };
    this.records.set(record.id, record);
    return {
      requestId: record.id,
      requestSecret: record.secret,
      expiresAt: record.expiresAt,
      expiresIn: Math.ceil(this.lifetimeMs / 1000),
    };
  }

  listPending(): PairingRequestView[] {
    this.prune();
    return [...this.records.values()]
      .filter((record) => record.status === "pending")
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .map((record) => ({
        id: record.id,
        deviceName: record.deviceName,
        remoteAddress: record.remoteAddress,
        userAgent: record.userAgent,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        status: record.status,
      }));
  }

  decide(id: string, decision: "approve" | "deny") {
    this.prune();
    const record = this.records.get(id);
    if (!record) throw new PairingRequestError("Pairing request was not found or has expired", 404);
    if (record.status !== "pending")
      throw new PairingRequestError("Pairing request has already been decided", 409);
    record.status = decision === "approve" ? "approved" : "denied";
    return { status: record.status };
  }

  status(id: string, secret: string): PairingRequestStatusView | null {
    this.prune();
    const record = this.records.get(id);
    if (!record || !safeEqual(secret, record.secret)) return null;
    return { status: record.status, expiresAt: record.expiresAt };
  }

  private prune() {
    const now = this.now();
    for (const [id, record] of this.records) {
      if (record.expiresAtMs <= now) this.records.delete(id);
    }
  }
}
