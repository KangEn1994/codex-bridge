export const reasoningEfforts = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;

export type ReasoningEffort = (typeof reasoningEfforts)[number];

export type RunConfiguration = {
  model?: string;
  effort?: ReasoningEffort;
  permissions?: string;
};

export type ModelReasoningEffort = {
  reasoningEffort: ReasoningEffort;
  description: string;
};

export type ModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  defaultReasoningEffort: ReasoningEffort | null;
  supportedReasoningEfforts: ModelReasoningEffort[];
  inputModalities: string[];
  isDefault: boolean;
};

export type PermissionProfileOption = {
  id: string;
  description: string | null;
  allowed: boolean;
};

export type RunOptions = {
  models: ModelOption[];
  permissionProfiles: PermissionProfileOption[];
  defaults: Required<RunConfiguration>;
  permissionMode: "profiles" | "legacy";
};

export type CodexRunOverrides = {
  model?: string;
  effort?: ReasoningEffort;
  permissions?: string;
  sandboxPolicy?: { type: "readOnly" | "workspaceWrite" | "dangerFullAccess" };
};

export class RunConfigurationError extends Error {
  readonly status = 400;
}

const fallbackPermissionProfiles: PermissionProfileOption[] = [
  { id: ":read-only", description: null, allowed: true },
  { id: ":workspace", description: null, allowed: true },
  { id: ":danger-full-access", description: null, allowed: true },
];

export function fallbackPermissions() {
  return fallbackPermissionProfiles.map((profile) => ({ ...profile }));
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (reasoningEfforts as readonly string[]).includes(value);
}

export function normalizeRunConfiguration(
  input: unknown,
  options: RunOptions,
): RunConfiguration | undefined {
  if (input == null) return undefined;
  if (typeof input !== "object" || Array.isArray(input))
    throw new RunConfigurationError("Invalid Codex run configuration");

  const value = input as Record<string, unknown>;
  const normalized: RunConfiguration = {};

  if (value.model != null) {
    if (typeof value.model !== "string") throw new RunConfigurationError("Invalid Codex model");
    const model = options.models.find((candidate) => candidate.id === value.model || candidate.model === value.model);
    if (!model) throw new RunConfigurationError("The selected Codex model is no longer available");
    normalized.model = model.model;
  }

  if (value.effort != null) {
    if (!isReasoningEffort(value.effort))
      throw new RunConfigurationError("Invalid Codex reasoning effort");
    const model = normalized.model
      ? options.models.find((candidate) => candidate.model === normalized.model)
      : null;
    if (
      model &&
      model.supportedReasoningEfforts.length > 0 &&
      !model.supportedReasoningEfforts.some((candidate) => candidate.reasoningEffort === value.effort)
    )
      throw new RunConfigurationError("The selected reasoning effort is not supported by this model");
    normalized.effort = value.effort;
  }

  if (value.permissions != null) {
    if (typeof value.permissions !== "string")
      throw new RunConfigurationError("Invalid Codex permission profile");
    const profile = options.permissionProfiles.find((candidate) => candidate.id === value.permissions);
    if (!profile)
      throw new RunConfigurationError("The selected Codex permission profile is no longer available");
    if (!profile.allowed)
      throw new RunConfigurationError("The selected Codex permission profile is blocked by computer policy");
    normalized.permissions = profile.id;
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

export function toCodexRunOverrides(
  configuration: RunConfiguration | undefined,
  permissionMode: RunOptions["permissionMode"],
): CodexRunOverrides {
  if (!configuration) return {};
  const overrides: CodexRunOverrides = {
    ...(configuration.model ? { model: configuration.model } : {}),
    ...(configuration.effort ? { effort: configuration.effort } : {}),
  };
  if (!configuration.permissions) return overrides;
  if (permissionMode === "profiles") {
    overrides.permissions = configuration.permissions;
    return overrides;
  }
  overrides.sandboxPolicy = {
    type:
      configuration.permissions === ":read-only"
        ? "readOnly"
        : configuration.permissions === ":danger-full-access"
          ? "dangerFullAccess"
          : "workspaceWrite",
  };
  return overrides;
}

export function permissionFromSandboxPolicy(value: unknown): string | undefined {
  const type =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "type" in value
        ? String((value as { type: unknown }).type)
        : "";
  const normalized = type.replaceAll("_", "-").toLowerCase();
  if (normalized.includes("danger") || normalized.includes("full-access")) return ":danger-full-access";
  if (normalized.includes("workspace")) return ":workspace";
  if (normalized.includes("read-only") || normalized.includes("readonly")) return ":read-only";
  return undefined;
}
