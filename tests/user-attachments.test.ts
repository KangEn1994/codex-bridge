import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sharp } from "../host/sharp-runtime";
import { UserAttachmentStore } from "../host/user-attachments";

test("stores phone images as bounded local Codex attachments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-attachments-"));
  try {
    const source = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: "#4e8fe8" },
    }).png().toBuffer();
    const store = new UserAttachmentStore(root);
    const saved = await store.save("thread-1", source);
    assert.match(saved.id, /^[0-9a-f-]{36}$/i);
    assert.equal(saved.contentType, "image/webp");
    assert.ok(saved.bytes < 2_800_000);

    const [imagePath] = await store.resolvePaths("thread-1", [saved.id]);
    assert.ok(path.isAbsolute(imagePath));
    const reference = store.referenceForPath("thread-1", imagePath);
    assert.deepEqual(reference, { type: "localImage", attachmentId: saved.id });

    const preview = await store.read("thread-1", saved.id, true);
    assert.equal(preview.mimeType, "image/webp");
    assert.ok(preview.bytes.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registers desktop local-image inputs without exposing their computer path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-attachments-"));
  const external = path.join(root, "desktop.png");
  try {
    await writeFile(external, await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#111111" },
    }).png().toBuffer());
    const store = new UserAttachmentStore(path.join(root, "store"));
    const reference = store.referenceForPath("thread-2", external);
    assert.match(reference?.attachmentId || "", /^local-[A-Za-z0-9_-]{24}$/);
    const image = await store.read("thread-2", reference!.attachmentId);
    assert.equal(image.mimeType, "image/webp");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
