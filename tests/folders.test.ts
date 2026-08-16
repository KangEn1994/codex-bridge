import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFolder, FolderCreationError, validateFolderName } from "../host/folders";

test("creates one folder inside the selected directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-bridge-folder-test-"));
  try {
    const created = await createFolder(root, "mobile-project");
    assert.equal(created.name, "mobile-project");
    assert.equal(created.path, path.join(root, "mobile-project"));
    await access(created.path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal, reserved names, and duplicate folders", async () => {
  assert.throws(() => validateFolderName(".."), FolderCreationError);
  assert.throws(() => validateFolderName("bad/name"), FolderCreationError);
  assert.throws(() => validateFolderName("CON"), FolderCreationError);

  const root = await mkdtemp(path.join(os.tmpdir(), "codex-bridge-folder-test-"));
  try {
    await createFolder(root, "existing");
    await assert.rejects(
      createFolder(root, "existing"),
      (error: unknown) => error instanceof FolderCreationError && error.status === 409,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
