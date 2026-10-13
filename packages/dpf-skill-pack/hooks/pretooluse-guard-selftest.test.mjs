// packages/dpf-skill-pack/hooks/pretooluse-guard-selftest.test.mjs
//
// BI-E5C45F61: every PreToolUse deny guard failed open in the Claude desktop
// host and nothing said so. The SessionStart self-test runs a harmless probe
// through each guard, checks the verdict against the Claude contract, checks
// the declared hook commands can run, and says so loudly when they cannot.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROBES, runProbes, declaredCommandProblems, formatNotice } from "./pretooluse-guard-selftest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("every probe denies through the real guards in a form the Claude host honours", () => {
  assert.ok(PROBES.length >= 4);
  assert.deepEqual(runProbes({ hooksDir: HERE, cwd: HERE }), []);
});

test("a guard emitting the legacy dual envelope is reported as inactive", () => {
  const dir = mkdtempSync(join(tmpdir(), "selftest-legacy-"));
  writeFileSync(
    join(dir, "fake-guard.mjs"),
    `process.stdout.write(JSON.stringify({ decision: "deny", reason: "r", hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } }));`,
  );
  const probes = [{ guard: "fake-guard.mjs", payload: { tool_name: "Bash", tool_input: { command: "x" } } }];
  const problems = runProbes({ hooksDir: dir, cwd: dir, probes });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /fake-guard\.mjs.*top-level decision/);
});

test("a guard that crashes or is missing is reported, not silent", () => {
  const dir = mkdtempSync(join(tmpdir(), "selftest-crash-"));
  writeFileSync(join(dir, "crash-guard.mjs"), `throw new Error("boom");`);
  const probes = [
    { guard: "crash-guard.mjs", payload: { tool_name: "Bash", tool_input: { command: "x" } } },
    { guard: "absent-guard.mjs", payload: { tool_name: "Bash", tool_input: { command: "x" } } },
  ];
  const problems = runProbes({ hooksDir: dir, cwd: dir, probes });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /crash-guard\.mjs/);
  assert.match(problems[1], /absent-guard\.mjs.*missing/);
});

const config = (command) => ({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] } });

test("declared commands with an unset variable are reported (they fail open at run time)", () => {
  const problems = declaredCommandProblems(config('node "${CLAUDE_PROJECT_DIR}/hooks/g.mjs"'), {}, "settings.json");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /settings\.json.*CLAUDE_PROJECT_DIR is not set/);
});

test("declared commands pointing at a missing script are reported", () => {
  const root = mkdtempSync(join(tmpdir(), "selftest-root-"));
  mkdirSync(join(root, "hooks"));
  writeFileSync(join(root, "hooks", "present.mjs"), "");
  const cfg = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/present.mjs"' },
            { type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/gone.mjs"' },
          ],
        },
      ],
    },
  };
  const problems = declaredCommandProblems(cfg, { CLAUDE_PLUGIN_ROOT: root }, "hooks.json");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /hooks\.json.*gone\.mjs.*missing/);
});

test("the notice is empty when healthy and loud when not", () => {
  assert.equal(formatNotice([]), "");
  const notice = formatNotice(["compose-guard.mjs: no output"]);
  assert.match(notice, /^PreToolUse guards inactive in this session/);
  assert.match(notice, /compose-guard\.mjs: no output/);
  assert.match(notice, /BI-E5C45F61/);
});
