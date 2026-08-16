import assert from "node:assert/strict";
import test from "node:test";
import { resolveComposerPrimaryAction } from "../app/composer-state";

test("shows stop only while a task is active and the composer is empty", () => {
  assert.equal(resolveComposerPrimaryAction(true, ""), "stop");
  assert.equal(resolveComposerPrimaryAction(true, "   "), "stop");
  assert.equal(resolveComposerPrimaryAction(false, ""), "send");
});

test("switches an active task back to send for every supported draft type", () => {
  assert.equal(resolveComposerPrimaryAction(true, "追加一个要求"), "send");
  assert.equal(resolveComposerPrimaryAction(true, "", 1, 0), "send");
  assert.equal(resolveComposerPrimaryAction(true, "", 0, 1), "send");
});
