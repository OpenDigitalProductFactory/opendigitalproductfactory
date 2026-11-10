import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const skillPath = new URL(
  "../skills/dpf-worktree-per-session/SKILL.md",
  import.meta.url,
);

test("worktree guidance makes the claim identity and refusal boundary explicit", async () => {
  const guidance = await readFile(skillPath, "utf8");

  assert.match(guidance, /claim_backlog_item_for_work/);
  assert.match(guidance, /exactly once/i);
  assert.match(guidance, /sessionRef/);
  assert.match(guidance, /workIntent/);
  assert.match(guidance, /branch_occupied/);
  assert.match(guidance, /never claim the same BI from a second worktree/i);
});
