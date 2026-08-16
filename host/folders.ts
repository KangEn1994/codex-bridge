import { mkdir } from "node:fs/promises";
import path from "node:path";

const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const invalidWindowsCharacters = /[<>:"/\\|?*]/;

export class FolderCreationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "FolderCreationError";
  }
}

export function validateFolderName(candidate: unknown) {
  if (typeof candidate !== "string") throw new FolderCreationError("请输入文件夹名称", 400);
  const name = candidate.trim();
  if (!name) throw new FolderCreationError("请输入文件夹名称", 400);
  if (name === "." || name === "..") throw new FolderCreationError("文件夹名称无效", 400);
  if (name.length > 120) throw new FolderCreationError("文件夹名称不能超过 120 个字符", 400);
  const hasControlCharacter = Array.from(name).some((character) => character.charCodeAt(0) < 32);
  if (invalidWindowsCharacters.test(name) || hasControlCharacter || /[. ]$/.test(name)) {
    throw new FolderCreationError("文件夹名称包含 Windows 不允许的字符", 400);
  }
  if (reservedWindowsName.test(name)) {
    throw new FolderCreationError("该名称是 Windows 保留名称，请换一个", 400);
  }
  return name;
}

export async function createFolder(parentCandidate: unknown, nameCandidate: unknown) {
  if (typeof parentCandidate !== "string" || !path.isAbsolute(parentCandidate)) {
    throw new FolderCreationError("请先选择一个有效的当前目录", 400);
  }
  const parent = path.resolve(parentCandidate);
  const name = validateFolderName(nameCandidate);
  const folderPath = path.join(parent, name);
  if (path.dirname(folderPath) !== parent) throw new FolderCreationError("文件夹路径无效", 400);
  try {
    await mkdir(folderPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EEXIST") throw new FolderCreationError("同名文件夹已经存在", 409);
    if (code === "ENOENT" || code === "ENOTDIR") throw new FolderCreationError("当前目录不存在", 404);
    if (code === "EACCES" || code === "EPERM") throw new FolderCreationError("没有权限在这里新建文件夹", 403);
    throw error;
  }
  return { name, path: folderPath };
}
