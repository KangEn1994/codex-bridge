import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

type PendingRequest = {
  response: ServerResponse;
  timer: NodeJS.Timeout;
  cacheableImage: boolean;
};

type RelayRequest = {
  type: "request";
  id: string;
  method: string;
  path: string;
  contentType: string | null;
  body: string;
};

type HostMessage =
  | { type: "response"; id: string; status: number; contentType?: string | null; body?: string }
  | { type: "event"; data: string };

const port = Number(process.env.PORT || 8080);
const listenAddress = process.env.HOST || "127.0.0.1";
const publicUrl = new URL(process.env.CODEX_RELAY_PUBLIC_URL || "http://127.0.0.1:8080");
const allowedOrigin = publicUrl.origin;
const webTarget = new URL(process.env.CODEX_RELAY_WEB_INTERNAL_URL || "http://127.0.0.1:3000");
const hostToken = requiredSecret("CODEX_RELAY_HOST_TOKEN");
const phoneToken = requiredSecret("CODEX_RELAY_PHONE_TOKEN");
const pending = new Map<string, PendingRequest>();
const tickets = new Map<string, number>();
const authFailures = new Map<string, { count: number; resetAt: number; blockedUntil: number }>();
const phoneSockets = new Set<WebSocket>();
const liveSockets = new WeakSet<WebSocket>();
let hostSocket: WebSocket | null = null;
let lastSnapshot: string | null = null;

function hostStateEvent(connected: boolean) {
  return JSON.stringify({
    method: "bridge/hostState",
    params: { connected },
    at: Date.now(),
  });
}

function broadcastToPhones(payload: string) {
  for (const client of phoneSockets)
    if (client.readyState === WebSocket.OPEN) client.send(payload);
}

function requiredSecret(name: string) {
  const value = process.env[name]?.trim() || "";
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
}

function secretMatches(candidate: string | null | undefined, expected: string) {
  if (!candidate) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function clientAddress(request: IncomingMessage) {
  const remote = request.socket.remoteAddress || "unknown";
  const forwarded = request.headers["x-forwarded-for"];
  const loopbackProxy = remote === "127.0.0.1" || remote === "::1" || remote.endsWith("::ffff:127.0.0.1");
  const trustProxy = process.env.CODEX_RELAY_TRUST_PROXY === "true" || loopbackProxy;
  if (trustProxy && typeof forwarded === "string" && forwarded) return forwarded.split(",", 1)[0].trim();
  return remote;
}

function isRateLimited(request: IncomingMessage) {
  const entry = authFailures.get(clientAddress(request));
  return Boolean(entry && entry.blockedUntil > Date.now());
}

function recordAuthFailure(request: IncomingMessage) {
  const key = clientAddress(request);
  const now = Date.now();
  const current = authFailures.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + 5 * 60_000, blockedUntil: 0 }
    : current;
  entry.count += 1;
  if (entry.count >= 8) entry.blockedUntil = now + 5 * 60_000;
  authFailures.set(key, entry);
}

function bearer(request: IncomingMessage) {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function validOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  return !origin || origin === allowedOrigin;
}

function authorizePhone(request: IncomingMessage) {
  if (isRateLimited(request) || !validOrigin(request)) return false;
  const valid = secretMatches(bearer(request), phoneToken);
  if (!valid) recordAuthFailure(request);
  return valid;
}

function securityHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cache-Control", "no-store");
}

function cors(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (origin === allowedOrigin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("Vary", "Origin");
}

function json(request: IncomingMessage, response: ServerResponse, status: number, payload: unknown) {
  securityHeaders(response);
  cors(request, response);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > 12_000_000) throw new Error("Request body is too large");
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}

function allowedApi(method: string, pathname: string) {
  if (pathname === "/api/health") return method === "GET";
  if (pathname === "/api/pair/exchange") return method === "POST";
  if (pathname === "/api/fs/browse") return method === "GET";
  if (pathname === "/api/fs/folders") return method === "POST";
  if (pathname === "/api/codex-options") return method === "GET";
  if (pathname === "/api/thread-drafts") return method === "POST";
  if (/^\/api\/thread-drafts\/[^/]+$/.test(pathname)) return method === "DELETE";
  if (pathname === "/api/threads") return method === "GET" || method === "POST";
  if (/^\/api\/threads\/[^/]+$/.test(pathname)) return method === "GET";
  if (/^\/api\/threads\/[^/]+\/images\/[^/]+$/.test(pathname)) return method === "GET";
  if (/^\/api\/threads\/[^/]+\/attachments$/.test(pathname)) return method === "POST";
  if (/^\/api\/threads\/[^/]+\/attachments\/[^/]+$/.test(pathname)) return method === "GET";
  if (/^\/api\/threads\/[^/]+\/run-configuration$/.test(pathname)) return method === "PATCH";
  if (/^\/api\/threads\/[^/]+\/goal$/.test(pathname))
    return method === "GET" || method === "POST" || method === "DELETE";
  if (/^\/api\/threads\/[^/]+\/(messages|interrupt|open-desktop)$/.test(pathname)) return method === "POST";
  if (pathname === "/api/queue") return method === "GET";
  if (/^\/api\/queue\/[^/]+$/.test(pathname)) return method === "DELETE" || method === "PATCH";
  if (pathname === "/api/approvals") return method === "GET";
  if (/^\/api\/approvals\/[^/]+$/.test(pathname)) return method === "POST";
  return false;
}

function proxyWeb(request: IncomingMessage, response: ServerResponse) {
  const headers = { ...request.headers, host: webTarget.host };
  const upstream = http.request({
    hostname: webTarget.hostname,
    port: webTarget.port || 80,
    method: request.method,
    path: request.url || "/",
    headers,
  }, (upstreamResponse) => {
    const responseHeaders = { ...upstreamResponse.headers };
    if ((request.url || "").split("?", 1)[0].toLowerCase().endsWith(".apk")) {
      responseHeaders["content-type"] = "application/vnd.android.package-archive";
      responseHeaders["content-disposition"] = 'attachment; filename="CodexBridge.apk"';
    }
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", (error) => json(request, response, 502, { error: `Web service unavailable: ${error.message}` }));
  request.pipe(upstream);
}

function closePending(status: number, message: string) {
  for (const [id, item] of pending) {
    clearTimeout(item.timer);
    if (!item.response.headersSent) {
      item.response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      item.response.end(JSON.stringify({ error: message }));
    }
    pending.delete(id);
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", publicUrl);
  const method = request.method || "GET";
  // Older mobile builds used /bridge as a same-origin development proxy.
  // Keep those installations working while the frontend migrates the saved
  // Relay address back to the public origin.
  const routePath = url.pathname.startsWith("/bridge/api/") ? url.pathname.slice("/bridge".length) : url.pathname;
  if (method === "OPTIONS") {
    securityHeaders(response);
    cors(request, response);
    response.writeHead(validOrigin(request) ? 204 : 403);
    response.end();
    return;
  }

  try {
    if (url.pathname === "/relay/health") {
      json(request, response, 200, { ok: true, hostConnected: hostSocket?.readyState === WebSocket.OPEN, clients: phoneSockets.size });
      return;
    }

    if (routePath === "/api/health") {
      json(request, response, 200, { ok: true, codex: hostSocket?.readyState === WebSocket.OPEN });
      return;
    }

    if (routePath === "/api/ws-ticket" && method === "POST") {
      if (!authorizePhone(request)) {
        json(request, response, isRateLimited(request) ? 429 : 401, { error: "Invalid pairing token" });
        return;
      }
      const ticket = randomBytes(24).toString("base64url");
      tickets.set(ticket, Date.now() + 30_000);
      if (tickets.size > 128) {
        const now = Date.now();
        for (const [value, expiresAt] of tickets) if (expiresAt <= now) tickets.delete(value);
      }
      json(request, response, 201, { ticket, expiresIn: 30 });
      return;
    }

    if (routePath.startsWith("/api/")) {
      const pairingExchange = routePath === "/api/pair/exchange" && method === "POST";
      if (pairingExchange && !validOrigin(request)) {
        json(request, response, 403, { error: "Origin is not allowed" });
        return;
      }
      if (!pairingExchange && !authorizePhone(request)) {
        json(request, response, isRateLimited(request) ? 429 : 401, { error: "Invalid pairing token" });
        return;
      }
      if (!allowedApi(method, routePath)) {
        json(request, response, 404, { error: "Not found" });
        return;
      }
      if (!hostSocket || hostSocket.readyState !== WebSocket.OPEN) {
        json(request, response, 503, { error: "Computer is offline" });
        return;
      }

      const body = await readBody(request);
      const id = randomBytes(16).toString("base64url");
      const message: RelayRequest = {
        type: "request",
        id,
        method,
        path: `${routePath}${url.search}`,
        contentType: typeof request.headers["content-type"] === "string" ? request.headers["content-type"] : null,
        body: body.toString("base64"),
      };
      const timer = setTimeout(() => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        json(request, item.response, 504, { error: "Computer response timed out" });
      }, 45_000);
      pending.set(id, {
        response,
        timer,
        cacheableImage: method === "GET" && /^\/api\/threads\/[^/]+\/(?:images|attachments)\/[^/]+$/.test(routePath),
      });
      response.once("close", () => {
        const item = pending.get(id);
        if (item && response.destroyed) {
          clearTimeout(item.timer);
          pending.delete(id);
        }
      });
      hostSocket.send(JSON.stringify(message));
      return;
    }

    proxyWeb(request, response);
  } catch (error) {
    json(request, response, 500, { error: error instanceof Error ? error.message : "Unexpected relay error" });
  }
});

// API responses are base64 encoded inside the host WebSocket. A thread detail
// near the 4 MB HTTP limit can therefore exceed 5 MB on the wire.
const hostServer = new WebSocketServer({ noServer: true, maxPayload: 20_000_000 });
const phoneServer = new WebSocketServer({ noServer: true, maxPayload: 256_000 });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", publicUrl);
  if (url.pathname === "/relay/host") {
    if (!secretMatches(bearer(request), hostToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    hostServer.handleUpgrade(request, socket, head, (websocket) => hostServer.emit("connection", websocket, request));
    return;
  }

  if (url.pathname === "/api/events") {
    const ticket = url.searchParams.get("ticket") || "";
    const expiresAt = tickets.get(ticket) || 0;
    tickets.delete(ticket);
    if (!validOrigin(request) || expiresAt <= Date.now()) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    phoneServer.handleUpgrade(request, socket, head, (websocket) => phoneServer.emit("connection", websocket, request));
    return;
  }

  socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
  socket.destroy();
});

hostServer.on("connection", (socket) => {
  if (hostSocket && hostSocket.readyState === WebSocket.OPEN) hostSocket.close(4001, "Replaced by a new computer connection");
  hostSocket = socket;
  liveSockets.add(socket);
  broadcastToPhones(hostStateEvent(true));
  console.log(JSON.stringify({ at: new Date().toISOString(), event: "host_connected" }));
  socket.on("pong", () => liveSockets.add(socket));
  socket.on("message", (data) => {
    let message: HostMessage;
    try { message = JSON.parse(String(data)) as HostMessage; } catch { return; }
    if (message.type === "response") {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      securityHeaders(item.response);
      if (item.cacheableImage) {
        item.response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        item.response.setHeader("Vary", "Authorization, Origin");
      }
      item.response.writeHead(Math.max(100, Math.min(599, Number(message.status) || 502)), {
        "Content-Type": message.contentType || "application/json; charset=utf-8",
      });
      item.response.end(Buffer.from(message.body || "", "base64"));
      return;
    }
    if (message.type === "event" && typeof message.data === "string" && Buffer.byteLength(message.data) <= 1_000_000) {
      try {
        const event = JSON.parse(message.data) as { method?: string };
        if (event.method === "bridge/snapshot") lastSnapshot = message.data;
      } catch { return; }
      broadcastToPhones(message.data);
    }
  });
  socket.on("close", () => {
    if (hostSocket === socket) {
      hostSocket = null;
      lastSnapshot = null;
      closePending(503, "Computer disconnected");
      broadcastToPhones(hostStateEvent(false));
      console.log(JSON.stringify({ at: new Date().toISOString(), event: "host_disconnected" }));
    }
  });
});

phoneServer.on("connection", (socket) => {
  phoneSockets.add(socket);
  liveSockets.add(socket);
  socket.on("pong", () => liveSockets.add(socket));
  socket.on("close", () => phoneSockets.delete(socket));
  socket.send(hostStateEvent(hostSocket?.readyState === WebSocket.OPEN));
  if (lastSnapshot) socket.send(lastSnapshot);
});

const heartbeat = setInterval(() => {
  for (const socket of [...phoneSockets, ...(hostSocket ? [hostSocket] : [])]) {
    if (!liveSockets.has(socket)) {
      socket.terminate();
      continue;
    }
    liveSockets.delete(socket);
    socket.ping();
  }
  const now = Date.now();
  for (const [ticket, expiresAt] of tickets) if (expiresAt <= now) tickets.delete(ticket);
  for (const [address, entry] of authFailures) if (entry.resetAt <= now && entry.blockedUntil <= now) authFailures.delete(address);
}, 25_000);
heartbeat.unref();

server.listen(port, listenAddress, () => {
  console.log(JSON.stringify({ at: new Date().toISOString(), event: "relay_listening", listenAddress, port, publicUrl: publicUrl.origin }));
});

const shutdown = () => {
  clearInterval(heartbeat);
  closePending(503, "Relay is shutting down");
  hostSocket?.close(1001, "Relay is shutting down");
  for (const socket of phoneSockets) socket.close(1001, "Relay is shutting down");
  server.close(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
