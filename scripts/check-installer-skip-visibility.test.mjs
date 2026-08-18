// A guarded step that skips in silence is indistinguishable from one that ran and
// succeeded -- and this installer then records the step as done via Save-Progress.
//
// The agent-toolchain block is the case that motivated this. Neither
// scripts/seed-worktree-mcp.ps1 nor scripts/dpf-bootstrap-agent-toolchain.ps1 ships
// in the release bundle, so on a `consumer` install both Test-Path guards are false.
// That much is intentional -- install-dpf.sh gates the same convergence on
// contributor mode, commenting "customer installs don't need agent CLIs wired up".
//
// The defect was that install-dpf.ps1 had no `else`, so a Ready-to-go install
// completed with agent wiring silently absent and no explanation, while the POSIX
// installer warned in exactly the same situation. A user who expected
// MCP-connected agents had nothing to go on.
//
// This asserts the *visibility* contract, not the bundling decision: if a step is
// skipped because its script is absent, the operator must be told.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const psInstaller = readFileSync(join(repoRoot, "install-dpf.ps1"), "utf8");
const shInstaller = readFileSync(join(repoRoot, "install-dpf.sh"), "utf8");

/** Optional-script guards in install-dpf.ps1 that must explain themselves when skipped. */
const GUARDED_STEPS = Object.freeze([
  { varName: "seedScript", script: "seed-worktree-mcp.ps1" },
  { varName: "bootstrapScript", script: "dpf-bootstrap-agent-toolchain.ps1" },
]);

/**
 * Return the source of the `if (Test-Path $<varName>) { ... } else { ... }` construct,
 * brace-matched from the guard so we read the real else branch rather than a regex guess.
 */
function guardBlock(source, varName) {
  const guard = new RegExp(`if\\s*\\(Test-Path\\s+\\$${varName}\\)\\s*\\{`);
  const m = source.match(guard);
  assert.ok(m, `install-dpf.ps1 should still guard $${varName} with Test-Path`);

  let i = source.indexOf("{", m.index);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  // Include whatever follows the closing brace, so an `else { ... }` is visible.
  const tail = source.slice(i, i + 700);
  return { body: source.slice(m.index, i + 1), tail };
}

for (const { varName, script } of GUARDED_STEPS) {
  test(`skipping ${script} is reported to the operator, not silent`, () => {
    const { tail } = guardBlock(psInstaller, varName);
    assert.match(
      tail,
      /^\}\s*else\s*\{/,
      `install-dpf.ps1: the Test-Path guard for ${script} has no else branch, so its absence ` +
        `is silent and then recorded as done by Save-Progress "mcp_seed"`,
    );
    const elseBody = tail.slice(0, tail.indexOf("}", tail.indexOf("else")) + 1);
    assert.match(
      elseBody,
      /Write-Warn/,
      `install-dpf.ps1: the else branch for ${script} must Write-Warn so the skip is visible`,
    );
    assert.ok(
      elseBody.includes(script),
      `install-dpf.ps1: the warning for ${script} should name the script the operator is missing`,
    );
  });
}

test("the Windows warning matches the POSIX installer, which already warns", () => {
  // install-dpf.sh:
  //   warn "scripts/dpf-bootstrap-agent-toolchain.sh not found; skipping agent toolchain convergence."
  assert.match(
    shInstaller,
    /warn "scripts\/dpf-bootstrap-agent-toolchain\.sh not found; skipping agent toolchain convergence\."/,
    "install-dpf.sh should still warn here; if this moved, keep the two installers in step",
  );
  assert.match(
    psInstaller,
    /skipping agent toolchain convergence\./,
    "install-dpf.ps1 should warn with the same wording as install-dpf.sh",
  );
});

test("a skipped agent-toolchain step tells the operator how to connect MCP later", () => {
  // The consumer path has no supported route to a working connector, so the warning
  // is the only place the operator learns what to do instead.
  const { tail } = guardBlock(psInstaller, "bootstrapScript");
  assert.match(
    tail,
    /Platform Development > MCP/,
    "the skip warning should point at Admin > Platform Development > MCP for issuing a token",
  );
});
