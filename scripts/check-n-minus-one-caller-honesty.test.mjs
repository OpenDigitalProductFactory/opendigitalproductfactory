import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  extractDockerEnvKeys,
  extractWorkflowEnvKeys,
  findViolations,
  scanStringLiterals,
} from "./check-n-minus-one-caller-honesty.mjs";

// The incident this ratchet exists for. #3282 added a readiness requirement to
// the candidate AND the caller-side plumbing satisfying it, and shipped green
// because the harness hard-coded the new environment.
const PR_3282 = "c5cccd89b6834ad826bcadfc8ae58914b63f5d7f";

function showAtRef(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8", maxBuffer: 1e8 });
  } catch {
    return null;
  }
}

test("scanner skips comments so prose apostrophes cannot desynchronize it", () => {
  const source = `
    // the promoter's contract isn't a string
    /* neither is this one's */
    args.push("-e", \`PROMOTE_COMPOSE_PROJECT=\${params.composeProject || "dpf"}\`);
  `;
  assert.deepEqual(extractDockerEnvKeys(source), new Set(["PROMOTE_COMPOSE_PROJECT"]));
});

test("scanner keeps // inside a string literal", () => {
  assert.deepEqual(scanStringLiterals('const u = "http://host/x"; k("-e", "A=1")'), ["http://host/x", "-e", "A=1"]);
});

test("extracts env keys across multi-line arg arrays", () => {
  const source = `args.push(
    "-e",
    \`PROMOTE_TARGET_SHA=\${sha}\`,
    "-v", "/a:/b:ro",
    "-e",
    "DPF_STATE_DIR=/dpf-state",
  );`;
  assert.deepEqual(extractDockerEnvKeys(source), new Set(["PROMOTE_TARGET_SHA", "DPF_STATE_DIR"]));
});

test("a -v mount value is never mistaken for an env key", () => {
  assert.deepEqual(extractDockerEnvKeys('args.push("-v", "STATE=/x:/y:ro")'), new Set());
});

test("reads -e pairs out of a workflow run block", () => {
  const workflow = `
        run: |
          docker run --rm \\
            -e DPF_PROMOTER_STATE_DIR=/dpf-state \\
            -e PROMOTE_TARGET_SHA="$GITHUB_SHA" \\
            "$IMAGE" --readiness --json
  `;
  assert.deepEqual(extractWorkflowEnvKeys(workflow), new Set(["DPF_PROMOTER_STATE_DIR", "PROMOTE_TARGET_SHA"]));
});

test("harness keys the baseline caller also sends are honest", () => {
  const violations = findViolations({
    baselineCallerKeys: new Set(["PROMOTE_TARGET_SHA", "DPF_HOST_PLATFORM"]),
    harnessKeys: new Set(["PROMOTE_TARGET_SHA", "DPF_HOST_PLATFORM"]),
    scaffolding: new Map(),
  });
  assert.deepEqual(violations, []);
});

test("a harness key the baseline caller cannot send is a violation", () => {
  const violations = findViolations({
    baselineCallerKeys: new Set(["PROMOTE_TARGET_SHA"]),
    harnessKeys: new Set(["PROMOTE_TARGET_SHA", "DPF_HOST_PLATFORM"]),
    scaffolding: new Map(),
  });
  assert.deepEqual(violations, ["DPF_HOST_PLATFORM"]);
});

test("declared scaffolding is exempt", () => {
  const violations = findViolations({
    baselineCallerKeys: new Set(),
    harnessKeys: new Set(["COMPOSE_PARALLEL_LIMIT"]),
    scaffolding: new Map([["COMPOSE_PARALLEL_LIMIT", "runner concurrency"]]),
  });
  assert.deepEqual(violations, []);
});

// The regression proof: replay the real #3282 tree and assert the ratchet would
// have blocked it, naming the keys that actually wedged every install.
test("would have blocked PR #3282 before it wedged every pre-existing install", (t) => {
  const baselineCaller = showAtRef(`${PR_3282}^`, "apps/web/lib/self-upgrade/promoter.ts");
  const harnessAtPr = showAtRef(PR_3282, "scripts/test-n-minus-one-upgrade.mjs");
  const workflowAtPr = showAtRef(PR_3282, ".github/workflows/self-upgrade-acceptance.yml");
  if (!baselineCaller || !harnessAtPr || !workflowAtPr) {
    t.skip("history for #3282 unavailable (shallow clone)");
    return;
  }

  const violations = findViolations({
    baselineCallerKeys: extractDockerEnvKeys(baselineCaller),
    harnessKeys: new Set([...extractDockerEnvKeys(harnessAtPr), ...extractWorkflowEnvKeys(workflowAtPr)]),
  });

  for (const wedging of ["DPF_HOST_PLATFORM", "DPF_HOST_ARCH", "DPF_HOST_IDENTITY_PROVENANCE"]) {
    assert.ok(violations.includes(wedging), `${wedging} should be reported`);
  }
  // Same PR, same trapdoor, one gate later: promote.sh's signed migration
  // handoff. The deployed portal cannot send these either.
  for (const handoff of ["DPF_INSTALL_STATE_MIGRATION_ENVELOPE", "DPF_INSTALL_STATE_MIGRATION_SIGNATURE"]) {
    assert.ok(violations.includes(handoff), `${handoff} should be reported`);
  }
});
