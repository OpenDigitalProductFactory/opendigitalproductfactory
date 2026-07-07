// node --test — executableCommandText contract (quoted-data false positives).
import assert from "node:assert/strict";
import { test } from "node:test";

import { executableCommandText } from "./command-text.mjs";

test("removes single- and double-quoted segments", () => {
  assert.equal(executableCommandText(`echo 'prisma migrate deploy'`), "echo ");
  assert.equal(executableCommandText(`git commit -m "mention pnpm dev in docs"`), "git commit -m ");
});

test("respects backslash escapes inside double quotes", () => {
  assert.equal(executableCommandText(`echo "a \\" prisma migrate dev"`), "echo ");
});

test("removes heredoc bodies but keeps following commands", () => {
  const cmd = `node - <<'EOF'\nconst s = "prisma migrate deploy";\nEOF\ngit status`;
  const out = executableCommandText(cmd);
  assert.ok(!out.includes("prisma migrate"), out);
  assert.ok(out.includes("git status"), out);
});

test("re-scans sh -c payloads — those ARE commands", () => {
  assert.match(executableCommandText(`sh -c 'prisma migrate dev'`), /prisma migrate dev/);
  assert.match(executableCommandText(`bash -lc "pnpm prisma db push"`), /pnpm prisma db push/);
});

test("unmatched quote strips to end (fail open)", () => {
  assert.equal(executableCommandText(`echo 'unterminated prisma migrate dev`), "echo ");
});

test("non-string / empty input yields empty text", () => {
  assert.equal(executableCommandText(""), "");
  assert.equal(executableCommandText(undefined), "");
});
