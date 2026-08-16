import { spawn } from "node:child_process";
import process from "node:process";

const webPort = process.env.CODEX_RELAY_WEB_PORT || "3000";
const children = [
  spawn(
    process.execPath,
    ["./node_modules/vinext/dist/cli.js", "start", "--hostname", "127.0.0.1", "--port", webPort],
    { stdio: "inherit" },
  ),
  spawn(process.execPath, ["--import", "tsx", "relay/server.ts"], { stdio: "inherit" }),
];

let stopping = false;
const stop = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill(signal);
  setTimeout(() => process.exit(0), 5_000).unref();
};

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`Relay child exited unexpectedly: code=${code} signal=${signal}`);
      stop("SIGTERM");
      process.exitCode = code || 1;
    }
  });
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
