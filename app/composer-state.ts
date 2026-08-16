export function resolveComposerPrimaryAction(
  active: boolean,
  message: string,
  attachmentCount = 0,
  contextCount = 0,
) {
  const hasDraft = Boolean(
    message.trim() || attachmentCount > 0 || contextCount > 0,
  );
  return active && !hasDraft ? "stop" : "send";
}
