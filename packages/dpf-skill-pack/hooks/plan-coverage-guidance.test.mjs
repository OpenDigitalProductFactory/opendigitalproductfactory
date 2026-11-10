import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const skillPath = new URL(
  "../skills/dpf-writing-plans/SKILL.md",
  import.meta.url,
);

test("plan-writing guidance uses the decomposition coverage contract", async () => {
  const guidance = await readFile(skillPath, "utf8");

  assert.match(guidance, /record_plan_backlog_coverage/);
  assert.match(guidance, /planArtifactRef/);
  assert.match(guidance, /decision:\s*`(?:decomposed|atomic)`/);
  assert.match(guidance, /do not.*`gate`/is);
  assert.match(guidance, /do not.*`pass`/is);
  assert.match(guidance, /one corrected call|one attempt/i);
});
