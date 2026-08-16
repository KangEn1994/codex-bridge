import path from "node:path";
import { stat } from "node:fs/promises";
import type { CodexMention } from "./codex-input";

export type ContextReferenceInput = {
  path?: string;
  kind?: "file" | "folder";
};

export class ContextReferenceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function resolveContextReferences(
  values: readonly ContextReferenceInput[] = [],
): Promise<CodexMention[]> {
  if (values.length > 8)
    throw new ContextReferenceError("每条消息最多添加 8 个电脑文件或文件夹");

  const unique = new Map<string, ContextReferenceInput>();
  for (const value of values) {
    if (!value || typeof value.path !== "string" || !value.path.trim())
      throw new ContextReferenceError("电脑文件路径无效");
    const resolved = path.resolve(value.path.trim());
    unique.set(process.platform === "win32" ? resolved.toLowerCase() : resolved, {
      path: resolved,
      kind: value.kind,
    });
  }

  const mentions: CodexMention[] = [];
  for (const value of unique.values()) {
    let metadata;
    try {
      metadata = await stat(value.path!);
    } catch {
      throw new ContextReferenceError(`电脑上的路径不存在：${value.path}`, 404);
    }
    const actualKind = metadata.isDirectory()
      ? "folder"
      : metadata.isFile()
        ? "file"
        : null;
    if (!actualKind)
      throw new ContextReferenceError(`不支持这种电脑路径：${value.path}`);
    if (value.kind && value.kind !== actualKind)
      throw new ContextReferenceError(`电脑路径类型已经变化：${value.path}`, 409);
    mentions.push({
      name: path.basename(value.path!) || value.path!,
      path: value.path!,
    });
  }
  return mentions;
}
