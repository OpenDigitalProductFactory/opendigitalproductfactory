import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const handler = readFileSync(
  new URL("../apps/web/lib/mcp/build-ship-handlers.ts", import.meta.url),
  "utf8",
);
const toolPack = readFileSync(
  new URL("../apps/web/lib/mcp/packs/build-lifecycle-pack.ts", import.meta.url),
  "utf8",
);
const prompt = readFileSync(
  new URL("../apps/web/lib/build/build-agent-prompts.ts", import.meta.url),
  "utf8",
);

test("Build Studio publishes, validates, then opens the PR", () => {
  const publishAt = handler.indexOf("await publishBranchCommit(");
  const validateAt = handler.indexOf("buildPublishedReadinessCommand({");
  const openAt = handler.indexOf("await openPullRequest(");
  assert.ok(publishAt > 0, "branch publication must be present");
  assert.ok(validateAt > publishAt, "exact-tree validation must follow publication");
  assert.ok(openAt > validateAt, "PR opening must follow exact-tree validation");
  assert.doesNotMatch(handler, /runPrePRGates/);
  assert.doesNotMatch(handler, /verification-issues/);
});

test("Build Studio exposes readiness context and documents fail-closed behavior", () => {
  assert.match(toolPack, /readinessTrailers/);
  assert.match(toolPack, /without opening a PR/);
  assert.match(prompt, /recoverable branch first/);
  assert.match(prompt, /no PR is opened/);
  assert.doesNotMatch(prompt, /unit-test surface is currently informational/);
});
