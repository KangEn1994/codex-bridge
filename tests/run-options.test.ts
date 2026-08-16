import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackPermissions,
  normalizeRunConfiguration,
  permissionFromSandboxPolicy,
  toCodexRunOverrides,
  type RunOptions,
} from "../host/run-options";

const options: RunOptions = {
  models: [
    {
      id: "gpt-test",
      model: "gpt-test",
      displayName: "GPT Test",
      description: "Test model",
      hidden: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "medium", description: "Balanced" },
      ],
      inputModalities: ["text"],
      isDefault: true,
    },
  ],
  permissionProfiles: fallbackPermissions(),
  defaults: { model: "gpt-test", effort: "medium", permissions: ":workspace" },
  permissionMode: "profiles",
};

test("validates model, effort, and permission selections", () => {
  assert.deepEqual(
    normalizeRunConfiguration(
      { model: "gpt-test", effort: "low", permissions: ":workspace" },
      options,
    ),
    { model: "gpt-test", effort: "low", permissions: ":workspace" },
  );
  assert.throws(
    () => normalizeRunConfiguration({ model: "missing" }, options),
    /no longer available/i,
  );
  assert.throws(
    () => normalizeRunConfiguration({ model: "gpt-test", effort: "ultra" }, options),
    /not supported/i,
  );
});

test("uses permission profile ids when the app server supports profiles", () => {
  assert.deepEqual(
    toCodexRunOverrides(
      { model: "gpt-test", effort: "medium", permissions: ":workspace" },
      "profiles",
    ),
    { model: "gpt-test", effort: "medium", permissions: ":workspace" },
  );
});

test("falls back to legacy sandbox policies for older app servers", () => {
  assert.deepEqual(
    toCodexRunOverrides({ permissions: ":read-only" }, "legacy"),
    { sandboxPolicy: { type: "readOnly" } },
  );
  assert.deepEqual(
    toCodexRunOverrides({ permissions: ":danger-full-access" }, "legacy"),
    { sandboxPolicy: { type: "dangerFullAccess" } },
  );
});

test("derives the built-in permission profile from persisted sandbox state", () => {
  assert.equal(permissionFromSandboxPolicy({ type: "workspaceWrite" }), ":workspace");
  assert.equal(permissionFromSandboxPolicy({ type: "danger-full-access" }), ":danger-full-access");
  assert.equal(permissionFromSandboxPolicy("read-only"), ":read-only");
});
