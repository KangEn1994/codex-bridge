import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ContextReferenceError,
  resolveContextReferences,
} from "../host/context-references";

test("validates computer context paths and derives trusted mention names", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-context-"));
  const filePath = path.join(root, "notes.md");
  const folderPath = path.join(root, "src");
  await Promise.all([
    writeFile(filePath, "notes"),
    mkdir(folderPath),
  ]);
  try {
    assert.deepEqual(
      await resolveContextReferences([
        { path: filePath, kind: "file" },
        { path: folderPath, kind: "folder" },
      ]),
      [
        { name: "notes.md", path: filePath },
        { name: "src", path: folderPath },
      ],
    );
    await assert.rejects(
      () => resolveContextReferences([{ path: filePath, kind: "folder" }]),
      (error) => error instanceof ContextReferenceError && error.status === 409,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
