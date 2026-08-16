import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the live cursor inline without drawing a message-height rail", async () => {
  const [css, app] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/BridgeApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.markdown-live > :last-child::after/);
  assert.doesNotMatch(
    css,
    /\.markdown-live\s*\{[^}]*border-left/s,
  );
  assert.doesNotMatch(
    css,
    /\.thinking-shimmer\s*\{[^}]*border-left/s,
  );
  assert.match(app, /className="thinking-shimmer"/);
  assert.match(app, /正在思考/);
  assert.match(
    css,
    /animation: thinking-shimmer-sweep 4s steps\(48, end\) \.6s infinite/,
  );
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.thinking-shimmer-sweep \{ display: none; \}/);
});
