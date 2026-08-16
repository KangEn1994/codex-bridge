import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GeneratedImageError,
  GeneratedImageStore,
  localMarkdownImageReferences,
} from "../host/generated-images";
import { sharp } from "../host/sharp-runtime";

const tinyPng = await sharp({
  create: { width: 1, height: 1, channels: 4, background: "#ffffff" },
}).png().toBuffer();

test("serves only image-generation files registered by a thread detail", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-bridge-image-"));
  const file = path.join(directory, "preview.png");
  await writeFile(file, tinyPng);
  try {
    const store = new GeneratedImageStore();
    store.registerThread({
      thread: {
        id: "thread-1",
        turns: [{ items: [{ type: "imageGeneration", id: "image-1", savedPath: file }] }],
      },
    });
    const asset = await store.read("thread-1", "image-1");
    assert.equal(asset.mimeType, "image/png");
    assert.equal(asset.fileName, "preview.png");
    assert.deepEqual(asset.bytes, tinyPng);
    const preview = await store.readPreview("thread-1", "image-1");
    assert.equal(preview.mimeType, "image/webp");
    assert.match(preview.fileName, /-preview\.webp$/);
    assert.ok(preview.bytes.length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects image ids that were not registered for the requested thread", async () => {
  const store = new GeneratedImageStore();
  await assert.rejects(
    store.read("thread-1", "missing"),
    (error: unknown) => error instanceof GeneratedImageError && error.status === 404,
  );
});

test("creates compact preview and viewer assets from an oversized source", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-bridge-large-image-"));
  const file = path.join(directory, "large-source.png");
  const largePng = Buffer.concat([tinyPng, Buffer.alloc(49 * 1024 * 1024)]);
  await writeFile(file, largePng);
  try {
    const store = new GeneratedImageStore();
    store.registerThread({
      thread: {
        id: "thread-large",
        turns: [{ items: [{ type: "imageGeneration", id: "image-large", savedPath: file }] }],
      },
    });
    const viewer = await store.read("thread-large", "image-large");
    assert.equal(viewer.mimeType, "image/webp");
    assert.ok(viewer.bytes.length < 4_800_000);
    const preview = await store.readPreview("thread-large", "image-large");
    assert.equal(preview.mimeType, "image/webp");
    assert.ok(preview.bytes.length < largePng.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("serves local images referenced by trusted assistant markdown", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-bridge-markdown-image-"));
  const file = path.join(directory, "phone screenshot.png");
  await writeFile(file, tinyPng);
  const item = {
    type: "agentMessage",
    id: "message-1",
    text: `真机截图：\n\n![手机截图](<${file}>)`,
  };
  try {
    const [reference] = localMarkdownImageReferences(item);
    assert.equal(reference.source, file);
    assert.match(reference.id, /^media-/);
    const store = new GeneratedImageStore();
    store.registerThread({ thread: { id: "thread-1", turns: [{ items: [item] }] } });
    const asset = await store.read("thread-1", reference.id);
    assert.equal(asset.mimeType, "image/png");
    assert.deepEqual(asset.bytes, tinyPng);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
