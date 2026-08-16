import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { logBridgeEvent } from "./logger";

type RelayRequest = {
  type: "request";
  id: string;
  method: string;
  path: string;
  contentType: string | null;
  body: string;
};

type RelayConnectorConfig = {
  publicUrl: string;
  hostToken: string;
  localUrl: string;
  localToken: string;
};

export class RelayConnector extends EventEmitter {
  private socket: WebSocket | null = null;
  private localEvents: WebSocket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private retryDelay = 1_000;

  constructor(private readonly config: RelayConnectorConfig) {
    super();
  }

  get isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.localEvents?.close();
    this.localEvents = null;
    this.socket?.close();
    this.socket = null;
  }

  private connect() {
    if (this.stopped) return;
    const endpoint = `${this.config.publicUrl.replace(/\/$/, "").replace(/^http/, "ws")}/relay/host`;
    const socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${this.config.hostToken}` }, maxPayload: 20_000_000 });
    this.socket = socket;

    socket.on("open", () => {
      this.retryDelay = 1_000;
      logBridgeEvent("relay_connected", { relayOrigin: new URL(this.config.publicUrl).origin });
      this.emit("state", "online");
      this.connectLocalEvents();
    });
    socket.on("message", (data) => void this.handleMessage(String(data)));
    socket.on("error", (error) => logBridgeEvent("relay_socket_error", { error: error.message }));
    socket.on("close", (code) => {
      if (this.socket === socket) this.socket = null;
      this.localEvents?.close();
      this.localEvents = null;
      this.emit("state", "offline");
      logBridgeEvent("relay_disconnected", { code });
      this.scheduleReconnect();
    });
  }

  private connectLocalEvents() {
    if (this.stopped || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const endpoint = `${this.config.localUrl.replace(/\/$/, "").replace(/^http/, "ws")}/api/events?token=${encodeURIComponent(this.config.localToken)}`;
    const events = new WebSocket(endpoint, { maxPayload: 2_000_000 });
    this.localEvents = events;
    events.on("message", (data) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      const payload = String(data);
      const bytes = Buffer.byteLength(payload);
      if (bytes > 1_000_000) {
        logBridgeEvent("relay_event_omitted", { bytes, reason: "oversized" });
        this.socket.send(JSON.stringify({
          type: "event",
          data: JSON.stringify({ method: "bridge/rolloutChanged", params: { reason: "oversized-event" }, at: Date.now() }),
        }));
        return;
      }
      this.socket.send(JSON.stringify({ type: "event", data: payload }));
    });
    events.on("error", (error) => logBridgeEvent("relay_local_events_error", { error: error.message }));
    events.on("close", () => {
      if (this.localEvents === events) this.localEvents = null;
      if (!this.stopped && this.socket?.readyState === WebSocket.OPEN) {
        setTimeout(() => this.connectLocalEvents(), 1_000).unref();
      }
    });
  }

  private async handleMessage(raw: string) {
    let message: RelayRequest;
    try { message = JSON.parse(raw) as RelayRequest; } catch { return; }
    if (message.type !== "request" || !message.id || !message.path.startsWith("/api/")) return;
    try {
      const body = Buffer.from(message.body || "", "base64");
      if (body.length > 12_000_000) throw new Error("Relay request is too large");
      const response = await fetch(`${this.config.localUrl.replace(/\/$/, "")}${message.path}`, {
        method: message.method,
        headers: {
          Authorization: `Bearer ${this.config.localToken}`,
          ...(message.contentType ? { "Content-Type": message.contentType } : {}),
        },
        body: body.length ? body : undefined,
        signal: AbortSignal.timeout(45_000),
      });
      const responseBody = Buffer.from(await response.arrayBuffer());
      if (responseBody.length > 4_000_000) throw new Error("Computer response is too large for the relay");
      this.send({
        type: "response",
        id: message.id,
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: responseBody.toString("base64"),
      });
    } catch (error) {
      this.send({
        type: "response",
        id: message.id,
        status: 502,
        contentType: "application/json; charset=utf-8",
        body: Buffer.from(JSON.stringify({ error: error instanceof Error ? error.message : "Relay request failed" })).toString("base64"),
      });
    }
  }

  private send(payload: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private scheduleReconnect() {
    if (this.stopped || this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(Math.round(this.retryDelay * 1.8), 30_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
    this.retryTimer.unref();
  }
}
