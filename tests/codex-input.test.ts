import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexInput } from "../host/codex-input";

test("builds native Codex mention inputs for computer files and folders", () => {
  assert.deepEqual(
    buildCodexInput(
      "Review these",
      ["C:\\photos\\screen.webp"],
      [
        { name: "README.md", path: "C:\\work\\README.md" },
        { name: "src", path: "C:\\work\\src" },
      ],
    ),
    [
      { type: "text", text: "Review these", text_elements: [] },
      { type: "localImage", path: "C:\\photos\\screen.webp" },
      { type: "mention", name: "README.md", path: "C:\\work\\README.md" },
      { type: "mention", name: "src", path: "C:\\work\\src" },
    ],
  );
});
