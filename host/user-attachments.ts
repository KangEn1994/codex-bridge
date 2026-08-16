import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { sharp } from "./sharp-runtime";
import type { GeneratedImageAsset } from "./generated-images";

const MAX_UPLOAD_BYTES = 12_000_000;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 2_800_000;
const ATTACHMENT_ID = /^[0-9a-f-]{36}$/i;

export class UserAttachmentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type MobileAttachmentReference = {
  type: "localImage";
  attachmentId: string;
};

export class UserAttachmentStore {
  private readonly externalPaths = new Map<string, string>();
  private readonly rendered = new Map<string, GeneratedImageAsset>();
  private readonly previews = new Map<string, GeneratedImageAsset>();

  constructor(
    private readonly root = path.join(os.homedir(), ".codex-bridge", "attachments"),
  ) {}

  async save(threadId: string, source: Buffer) {
    if (!source.length) throw new UserAttachmentError("没有收到图片内容", 400);
    if (source.length > MAX_UPLOAD_BYTES)
      throw new UserAttachmentError("图片过大，请选择 12 MB 以内的图片", 413);

    const id = randomUUID();
    const directory = this.threadDirectory(threadId);
    const filePath = path.join(directory, `${id}.webp`);
    const asset = await this.render(source, 2048, MAX_ATTACHMENT_BYTES, "发送图片");
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, asset.bytes, { mode: 0o600 });
    return {
      id,
      contentType: asset.mimeType,
      bytes: asset.bytes.length,
      endpoint: `/api/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(id)}`,
    };
  }

  async resolvePaths(threadId: string, attachmentIds: readonly string[]) {
    if (attachmentIds.length > 4) throw new UserAttachmentError("每条消息最多发送 4 张图片", 400);
    const paths: string[] = [];
    for (const id of attachmentIds) {
      if (!ATTACHMENT_ID.test(id)) throw new UserAttachmentError("图片附件无效", 400);
      const filePath = path.join(this.threadDirectory(threadId), `${id}.webp`);
      try {
        await stat(filePath);
      } catch {
        throw new UserAttachmentError("图片附件已失效，请重新选择", 404);
      }
      paths.push(filePath);
    }
    return paths;
  }

  referenceForPath(threadId: string, sourcePath: string): MobileAttachmentReference | null {
    if (!path.isAbsolute(sourcePath)) return null;
    const normalized = path.normalize(sourcePath);
    const ownDirectory = this.threadDirectory(threadId);
    if (path.dirname(normalized).toLowerCase() === ownDirectory.toLowerCase()) {
      const id = path.basename(normalized, path.extname(normalized));
      if (ATTACHMENT_ID.test(id)) return { type: "localImage", attachmentId: id };
    }

    const id = `local-${createHash("sha256")
      .update(`${threadId}\0${normalized}`)
      .digest("base64url")
      .slice(0, 24)}`;
    this.externalPaths.set(this.key(threadId, id), normalized);
    return { type: "localImage", attachmentId: id };
  }

  async read(threadId: string, id: string, preview = false): Promise<GeneratedImageAsset> {
    const key = this.key(threadId, id);
    const cache = preview ? this.previews : this.rendered;
    const cached = cache.get(key);
    if (cached) return cached;

    let filePath: string;
    if (ATTACHMENT_ID.test(id)) filePath = path.join(this.threadDirectory(threadId), `${id}.webp`);
    else if (/^local-[A-Za-z0-9_-]{24}$/.test(id) && this.externalPaths.has(key))
      filePath = this.externalPaths.get(key)!;
    else throw new UserAttachmentError("图片附件不存在", 404);

    let source: Buffer;
    try {
      const metadata = await stat(filePath);
      if (metadata.size > MAX_SOURCE_BYTES) throw new UserAttachmentError("图片文件过大", 413);
      source = await readFile(filePath);
    } catch (error) {
      if (error instanceof UserAttachmentError) throw error;
      throw new UserAttachmentError("图片文件已不可用", 404);
    }

    const asset = await this.render(
      source,
      preview ? 1024 : 2048,
      preview ? 1_500_000 : MAX_ATTACHMENT_BYTES,
      preview ? "图片预览" : "发送图片",
    );
    cache.set(key, asset);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
    return asset;
  }

  private async render(source: Buffer, size: number, maxBytes: number, name: string) {
    const candidates = [
      { size, quality: 86 },
      { size: Math.min(size, 1800), quality: 78 },
      { size: Math.min(size, 1440), quality: 72 },
    ];
    try {
      for (const candidate of candidates) {
        const bytes = await sharp(source, { animated: false, sequentialRead: true })
          .rotate()
          .resize({
            width: candidate.size,
            height: candidate.size,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: candidate.quality, effort: 3 })
          .toBuffer();
        if (bytes.length <= maxBytes)
          return { bytes, mimeType: "image/webp" as const, fileName: `${name}.webp` };
      }
    } catch {
      throw new UserAttachmentError("无法读取这张图片，请换一张重试", 415);
    }
    throw new UserAttachmentError("图片压缩后仍然过大，请换一张重试", 413);
  }

  private threadDirectory(threadId: string) {
    const digest = createHash("sha256").update(threadId).digest("hex").slice(0, 32);
    return path.join(this.root, digest);
  }

  private key(threadId: string, id: string) {
    return `${threadId}\0${id}`;
  }
}
