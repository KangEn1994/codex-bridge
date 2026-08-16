import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

type RpcId = number | string;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export type RpcMessage = {
  id?: RpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export class CodexRpcClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<RpcId, PendingRequest>();
  private started = false;
  private stopping = false;

  get isStarted() {
    return this.started;
  }

  async start() {
    if (this.started) return;
    this.stopping = false;
    this.child = this.spawnCodex();
    this.started = true;

    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) this.emit("diagnostic", message);
    });
    this.child.on("exit", (code, signal) => {
      this.started = false;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Codex App Server stopped (${code ?? signal ?? "unknown"})`));
      }
      this.pending.clear();
      if (!this.stopping) this.emit("exit", { code, signal });
    });

    await this.request("initialize", {
      clientInfo: {
        name: "codex_bridge",
        title: "Codex Bridge",
        version: "0.1.0",
      },
      capabilities: {
        // Permission profiles and their policy-aware availability are exposed
        // through the beta app-server surface. Unknown experimental methods
        // remain opt-in at the call site; enabling the capability only lets us
        // query and apply the same permission profiles as first-party clients.
        experimentalApi: true,
      },
    });
    this.notify("initialized", {});
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.started = false;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        clearTimeout(giveUpTimer);
        child.off("exit", finish);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          finish();
        }
      }, 1_000);
      const giveUpTimer = setTimeout(finish, 2_500);
      child.once("exit", finish);
      try {
        child.kill();
      } catch {
        finish();
      }
    });
  }

  request<T = unknown>(method: string, params: unknown = {}, timeoutMs = 60_000): Promise<T> {
    if (!this.child || !this.started) {
      return Promise.reject(new Error("Codex App Server is not running"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown = {}) {
    this.write({ method, params });
  }

  respond(id: RpcId, result: unknown) {
    this.write({ id, result });
  }

  respondError(id: RpcId, code: number, message: string) {
    this.write({ id, error: { code, message } });
  }

  private spawnCodex() {
    const configured = process.env.CODEX_BRIDGE_CODEX_BIN?.trim();
    if (process.platform === "win32") {
      const executable = configured || "codex";
      const escaped = executable.includes(" ") ? `"${executable.replaceAll('"', '""')}"` : executable;
      return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${escaped} app-server --stdio`], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    }
    return spawn(configured || "codex", ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  private write(message: RpcMessage) {
    if (!this.child?.stdin.writable) throw new Error("Codex App Server input is unavailable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string) {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      this.emit("diagnostic", `Ignored non-JSON App Server output: ${line.slice(0, 200)}`);
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || `Codex RPC error ${message.error.code ?? ""}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      this.emit("serverRequest", message);
      return;
    }

    if (message.method) this.emit("notification", message);
  }
}
