export type CodexInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "localImage"; path: string }
  | { type: "mention"; name: string; path: string };

export type CodexMention = {
  name: string;
  path: string;
};

export function buildCodexInput(
  text: string,
  imagePaths: readonly string[] = [],
  mentions: readonly CodexMention[] = [],
): CodexInput[] {
  const input: CodexInput[] = [];
  const normalized = text.trim();
  if (normalized) input.push({ type: "text", text: normalized, text_elements: [] });
  for (const imagePath of imagePaths) {
    if (imagePath) input.push({ type: "localImage", path: imagePath });
  }
  for (const mention of mentions) {
    if (mention.name && mention.path)
      input.push({ type: "mention", name: mention.name, path: mention.path });
  }
  return input;
}
