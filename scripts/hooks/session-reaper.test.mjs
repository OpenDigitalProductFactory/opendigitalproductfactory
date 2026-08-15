import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const matcher = join(here, "lib", "session-reaper-path.sh");

function matches(line, worktree = "/Users/example/dpf") {
  const script = `. "$1"; dpf_process_line_matches_worktree "$2" "$3"`;
  try {
    execFileSync("sh", ["-c", script, "test", matcher, line, worktree], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("matches the ending worktree and true descendants", () => {
  assert.equal(matches("101 node /Users/example/dpf/server.js"), true);
  assert.equal(matches("102 node --cwd /Users/example/dpf"), true);
});

test("rejects canonical sibling worktrees and the shared local-CI runner", () => {
  assert.equal(matches("201 node /Users/example/dpf-worktrees/topic/server.js"), false);
  assert.equal(matches("202 node /Users/example/dpf-worktrees/.local-ci-runner/check.mjs"), false);
});
