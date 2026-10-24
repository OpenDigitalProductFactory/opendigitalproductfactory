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

// BI-B0122A22 follow-up. A worktree's node_modules is a junction into the ROOT
// clone, so every worktree's vitest/next/tsc process carries the root clone path
// in argv. A root-clone session ending must not reap a sibling worktree's gate
// run that merely resolved its binaries through the shared junction — that is
// how three local-CI runs died by SIGTERM on 2026-09-06.
test("does not treat a shared node_modules binary as this worktree's sidecar", () => {
  assert.equal(
    matches("301 node /Users/example/dpf/node_modules/.pnpm/vitest@4.1.10/node_modules/vitest/vitest.mjs run lib/x"),
    false,
  );
  assert.equal(
    matches("302 /Users/example/dpf/node_modules/.bin/next build"),
    false,
  );
});

test("a process that references another worktree is that worktree's, even via shared binaries", () => {
  assert.equal(
    matches("401 node /Users/example/dpf/node_modules/.bin/tsx /Users/example/dpf-worktrees/topic/scripts/x.ts"),
    false,
  );
  assert.equal(
    matches("402 node /Users/example/dpf/node_modules/.bin/tsx /Users/example/dpf-worktrees/topic/scripts/x.ts", "/Users/example/dpf-worktrees/topic"),
    true,
  );
});

test("still owns a real sidecar in this worktree that also loads shared binaries", () => {
  assert.equal(
    matches("501 node /Users/example/dpf/node_modules/.bin/tsx /Users/example/dpf/scripts/mcp-server.ts"),
    true,
  );
});

// The exact shape observed 2026-09-06 (argv truncated to the relevant tokens): the
// Git common dir lives under the root clone, so a sibling worktree's runner names
// `<root>/.git/worktrees/<sibling>/…` in its args. That token is the root clone's
// plumbing, not the root-clone session's process.
test("does not claim a sibling's local-CI runner because its metadata path is under the root .git", () => {
  const line = "601 node /Users/example/dpf-worktrees/topic/scripts/local-integration-ci.mjs --candidate feat/topic "
    + "--metadata-out /Users/example/dpf/.git/worktrees/topic/dpf-local-ci-metadata.json --migrate-deploy";
  assert.equal(matches(line), false);
  assert.equal(matches(line, "/Users/example/dpf-worktrees/topic"), true);
});

test("a root-clone process that only touches the root .git is still not proven ours by that token alone", () => {
  assert.equal(matches("701 node /Users/example/dpf/scripts/x.mjs --git-dir /Users/example/dpf/.git"), true);
  assert.equal(matches("702 node /opt/tool/x.mjs --git-dir /Users/example/dpf/.git"), false);
});
