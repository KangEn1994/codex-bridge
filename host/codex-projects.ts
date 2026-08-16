import { access, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { logBridgeEvent } from "./logger";

const execFileAsync = promisify(execFile);

type CodexLocalProject = {
  id?: unknown;
  rootPaths?: unknown;
};

type CodexGlobalState = {
  "local-projects"?: Record<string, CodexLocalProject>;
  "selected-project"?: unknown;
  "thread-project-assignments"?: Record<string, unknown>;
  "projectless-thread-ids"?: unknown;
};

export type ThreadProjectPlacement =
  | "project"
  | "projectless"
  | "unassigned"
  | "unknown";

export type ProjectRegistrationResult = {
  status:
    | "already_registered"
    | "registered"
    | "opened"
    | "unsupported"
    | "failed";
  path: string;
  message?: string;
};

type ProjectRegistrarOptions = {
  platform?: NodeJS.Platform;
  statePath?: string;
  launch?: (projectPath: string) => Promise<void>;
  launchThread?: (threadId: string) => Promise<void>;
  registrationTimeoutMs?: number;
  selectionSettleMs?: number;
};

function comparablePath(candidate: string, platform: NodeJS.Platform) {
  const normalized = path.normalize(path.resolve(candidate)).replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function projectIdForExactWorkspace(
  state: CodexGlobalState,
  projectCandidate: string,
  platform: NodeJS.Platform,
) {
  const target = comparablePath(projectCandidate, platform);
  for (const [key, project] of Object.entries(state["local-projects"] ?? {})) {
    if (!Array.isArray(project.rootPaths)) continue;
    if (
      project.rootPaths.some(
        (root) => typeof root === "string" && comparablePath(root, platform) === target,
      )
    )
      return typeof project.id === "string" ? project.id : key;
  }
  return null;
}

async function pause(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findCodexDesktopExecutable() {
  const command = [
    "$package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1",
    "if ($null -eq $package) { exit 2 }",
    "$package.InstallLocation",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true },
  );
  const installLocation = stdout.trim();
  if (!installLocation) throw new Error("未找到 Codex 桌面版安装目录");
  const executable = path.join(installLocation, "app", "ChatGPT.exe");
  await access(executable);
  return executable;
}

async function launchCodexProject(projectPath: string) {
  const executable = await findCodexDesktopExecutable();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["--open-project", projectPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function launchCodexThread(threadId: string) {
  const executable = await findCodexDesktopExecutable();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [`codex://threads/${encodeURIComponent(threadId)}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export class CodexProjectRegistrar {
  private readonly platform: NodeJS.Platform;
  private readonly statePath: string;
  private readonly launch: (projectPath: string) => Promise<void>;
  private readonly launchThread: (threadId: string) => Promise<void>;
  private readonly registrationTimeoutMs: number;
  private readonly selectionSettleMs: number;
  private readonly pending = new Map<string, Promise<ProjectRegistrationResult>>();

  constructor(options: ProjectRegistrarOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.statePath = options.statePath ?? path.join(os.homedir(), ".codex", ".codex-global-state.json");
    this.launch = options.launch ?? launchCodexProject;
    this.launchThread = options.launchThread ?? launchCodexThread;
    this.registrationTimeoutMs = options.registrationTimeoutMs ?? 4_000;
    this.selectionSettleMs = options.selectionSettleMs ?? 1_300;
  }

  async ensure(projectCandidate: string): Promise<ProjectRegistrationResult> {
    const projectPath = path.resolve(projectCandidate);
    const invalid = await this.validateProjectPath(projectPath);
    if (invalid) return invalid;
    let registered: boolean;
    try {
      registered = await this.readRegistered(projectPath);
    } catch (error) {
      return this.stateReadFailure(projectPath, error);
    }
    if (registered) {
      return { status: "already_registered", path: projectPath };
    }

    const key = `ensure:${comparablePath(projectPath, this.platform)}`;
    const active = this.pending.get(key);
    if (active) return active;

    const registration = this.launchAndConfirmRegistration(projectPath).finally(() => {
      setTimeout(() => this.pending.delete(key), 10_000).unref();
    });
    this.pending.set(key, registration);
    return registration;
  }

  async openProject(projectCandidate: string): Promise<ProjectRegistrationResult> {
    const projectPath = path.resolve(projectCandidate);
    const invalid = await this.validateProjectPath(projectPath);
    if (invalid) return invalid;
    let selected: boolean;
    try {
      selected = await this.readSelected(projectPath);
    } catch (error) {
      return this.stateReadFailure(projectPath, error);
    }
    if (selected) {
      logBridgeEvent("codex_project_already_selected", { path: projectPath });
      return { status: "opened", path: projectPath };
    }

    const key = `open:${comparablePath(projectPath, this.platform)}`;
    const active = this.pending.get(key);
    if (active) return active;

    const opening = this.launchAndConfirmSelection(projectPath).finally(() => {
      setTimeout(() => this.pending.delete(key), 10_000).unref();
    });
    this.pending.set(key, opening);
    return opening;
  }

  async revealThread(threadId: string) {
    if (this.platform !== "win32") return false;
    try {
      await this.launchThread(threadId);
      logBridgeEvent("desktop_thread_revealed", { threadId });
      return true;
    } catch (error) {
      logBridgeEvent("desktop_thread_reveal_failed", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async isRegistered(projectCandidate: string) {
    try {
      return await this.readRegistered(projectCandidate);
    } catch {
      return false;
    }
  }

  async getThreadPlacement(threadId: string): Promise<ThreadProjectPlacement> {
    let state: CodexGlobalState;
    try {
      state = await this.readState();
    } catch {
      return "unknown";
    }
    if (Object.prototype.hasOwnProperty.call(state["thread-project-assignments"] ?? {}, threadId))
      return "project";
    const projectlessIds = state["projectless-thread-ids"];
    if (Array.isArray(projectlessIds) && projectlessIds.includes(threadId)) return "projectless";
    return "unassigned";
  }

  private async validateProjectPath(projectPath: string): Promise<ProjectRegistrationResult | null> {
    if (this.platform !== "win32") return { status: "unsupported", path: projectPath };
    try {
      const metadata = await stat(projectPath);
      if (!metadata.isDirectory())
        return { status: "failed", path: projectPath, message: "项目路径不是文件夹" };
    } catch {
      return { status: "failed", path: projectPath, message: "项目文件夹不存在" };
    }
    return null;
  }

  private async launchAndConfirmRegistration(projectPath: string): Promise<ProjectRegistrationResult> {
    try {
      await this.launch(projectPath);
      const deadline = Date.now() + this.registrationTimeoutMs;
      while (Date.now() < deadline) {
        await pause(150);
        if (await this.isRegistered(projectPath)) {
          logBridgeEvent("codex_project_registered", { path: projectPath });
          return { status: "registered", path: projectPath };
        }
      }
      logBridgeEvent("codex_project_opened", { path: projectPath, registrationConfirmed: false });
      return { status: "opened", path: projectPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logBridgeEvent("codex_project_registration_failed", { path: projectPath, error: message });
      return { status: "failed", path: projectPath, message };
    }
  }

  private async launchAndConfirmSelection(projectPath: string): Promise<ProjectRegistrationResult> {
    try {
      await this.launch(projectPath);
      const deadline = Date.now() + this.registrationTimeoutMs;
      while (Date.now() < deadline) {
        await pause(150);
        if (await this.isSelected(projectPath)) {
          logBridgeEvent("codex_project_opened", { path: projectPath, selectionConfirmed: true });
          // The selected-project state is written before the renderer finishes
          // changing project context. Let that navigation settle before the
          // exact conversation preload and deep link are delivered.
          if (this.selectionSettleMs > 0) {
            await pause(this.selectionSettleMs);
          }
          logBridgeEvent("codex_project_selection_settled", {
            path: projectPath,
            settleMs: this.selectionSettleMs,
          });
          return { status: "opened", path: projectPath };
        }
      }
      logBridgeEvent("codex_project_opened", { path: projectPath, selectionConfirmed: false });
      return { status: "opened", path: projectPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logBridgeEvent("codex_project_open_failed", { path: projectPath, error: message });
      return { status: "failed", path: projectPath, message };
    }
  }

  private async isSelected(projectCandidate: string) {
    try {
      return await this.readSelected(projectCandidate);
    } catch {
      return false;
    }
  }

  private async readRegistered(projectCandidate: string) {
    const state = await this.readState();
    return projectIdForExactWorkspace(state, projectCandidate, this.platform) != null;
  }

  private async readSelected(projectCandidate: string) {
    const state = await this.readState();
    const selected = state["selected-project"];
    if (!selected || typeof selected !== "object" || !("projectId" in selected)) return false;
    const projectId = projectIdForExactWorkspace(state, projectCandidate, this.platform);
    return projectId != null && String(selected.projectId) === projectId;
  }

  private stateReadFailure(projectPath: string, error: unknown): ProjectRegistrationResult {
    const details = error instanceof Error ? error.message : String(error);
    logBridgeEvent("codex_project_state_read_failed", { path: projectPath, error: details });
    return {
      status: "failed",
      path: projectPath,
      message: "暂时无法读取 Codex 桌面状态，请稍后重试",
    };
  }

  private async readState(): Promise<CodexGlobalState> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return JSON.parse(await readFile(this.statePath, "utf8")) as CodexGlobalState;
      } catch (error) {
        lastError = error;
        await pause(40);
      }
    }
    throw lastError;
  }
}
