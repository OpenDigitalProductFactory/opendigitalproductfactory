import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_REPLACEMENT_SLUGS,
  assessProcessSpine,
  loadCleanupPolicy,
  renderCleanupPolicySummary,
  renderProcessSpineSummary,
  run,
} from "./process-spine-health-check.mjs";
import { OPERATING_CONTRACT_LINES } from "./operating-contract.generated.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

function makeSkillPack(slugs = REQUIRED_REPLACEMENT_SLUGS) {
  const root = mkdtempSync(join(tmpdir(), "dpf-process-spine-"));
  writeFileSync(
    join(root, "process-spine-replacements.json"),
    readFileSync(join(packageRoot, "process-spine-replacements.json"), "utf8"),
    "utf8",
  );
  for (const slug of slugs) {
    const dir = join(root, "skills", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${slug}\n---\n`, "utf8");
  }
  return root;
}

test("contract names the five DPF-native replacements for retired upstream process skills", () => {
  assert.deepEqual(REQUIRED_REPLACEMENT_SLUGS, [
    "dpf-brainstorming",
    "dpf-writing-plans",
    "dpf-tdd",
    "dpf-systematic-debugging",
    "dpf-finishing-a-development-branch",
  ]);
});

test("cleanup policy is contract-backed and never destructive", () => {
  const policy = loadCleanupPolicy(packageRoot);

  assert.equal(policy.mode, "disable-not-delete");
  assert.ok(policy.clients.some((client) => client.client === "codex"));
  assert.ok(policy.clients.every((client) => !String(client.action).includes("delete")));

  const summary = renderCleanupPolicySummary(policy).join("\n");
  assert.match(summary, /disable-not-delete/);
  assert.match(summary, /Codex/);
  // Codex, Grok, and Claude reconcile via disable-plugin; Antigravity is honest unsupported.
  assert.match(summary, /Grok/);
  assert.match(summary, /Claude/);
  assert.match(summary, /disables known competitive/);
  assert.match(summary, /unsupported-until-proven/);
  const grok = policy.clients.find((c) => c.client === "grok");
  assert.equal(grok?.status, "reconciles-safe-config");
  assert.equal(grok?.action, "disable-plugin");
  const claude = policy.clients.find((c) => c.client === "claude");
  assert.equal(claude?.status, "reconciles-safe-config");
  assert.equal(claude?.action, "disable-plugin");
  const antigravity = policy.clients.find((c) => c.client === "antigravity");
  assert.equal(antigravity?.status, "unsupported-until-proven");
});

test("distinguishes installed-on-disk from exposed-in-session evidence", () => {
  const verdict = assessProcessSpine({
    skillPackRoot: makeSkillPack(),
    exposedSkills: ["dpf-brainstorming", "dpf-tdd"],
  });

  assert.equal(verdict.installed.ok, true);
  assert.equal(verdict.exposed.state, "verified");
  assert.deepEqual(verdict.exposed.missingDpfSkills, [
    "dpf-writing-plans",
    "dpf-systematic-debugging",
    "dpf-finishing-a-development-branch",
  ]);
  assert.equal(verdict.severity, "warn");
});

test("flags generic superpowers brainstorming present while dpf-brainstorming is absent", () => {
  const verdict = assessProcessSpine({
    skillPackRoot: makeSkillPack(),
    exposedSkills: ["superpowers:brainstorming"],
  });

  assert.equal(verdict.installed.ok, true);
  assert.equal(verdict.exposed.state, "verified");
  assert.deepEqual(verdict.conflicts.map((c) => c.dpfSkill), ["dpf-brainstorming"]);
  assert.equal(verdict.severity, "warn");
  const summary = renderProcessSpineSummary(verdict);
  assert.match(summary[0], /^Process spine: BROKEN/);
  assert.match(summary.join("\n"), /DPF-native replacement skills are not active/);
});

test("warns when installed skills cannot be proven exposed in the active session", () => {
  const verdict = assessProcessSpine({
    skillPackRoot: makeSkillPack(),
    exposedSkills: null,
  });

  assert.equal(verdict.installed.ok, true);
  assert.equal(verdict.exposed.state, "unknown");
  assert.equal(verdict.severity, "warn");
  const lines = renderProcessSpineSummary(verdict);
  assert.equal(
    lines[0],
    "Process spine: UNPROVEN — this client cannot show DPF which skills are loaded, so DPF skills may be absent. The operating contract follows inline.",
  );
  const summary = lines.join("\n");
  assert.match(summary, /UNKNOWN/);
  assert.match(summary, /cannot prove replacements are loaded/);
});

test("reports fully exposed DPF replacements as healthy", () => {
  const verdict = assessProcessSpine({
    skillPackRoot: makeSkillPack(),
    exposedSkills: REQUIRED_REPLACEMENT_SLUGS,
  });

  assert.equal(verdict.installed.ok, true);
  assert.equal(verdict.exposed.state, "verified");
  assert.equal(verdict.severity, "ok");
  assert.equal(renderProcessSpineSummary(verdict)[0], "Process spine: VERIFIED");
});

test("reports missing plugin files as installed-state failure", () => {
  const verdict = assessProcessSpine({
    skillPackRoot: makeSkillPack(["dpf-brainstorming"]),
    exposedSkills: null,
  });

  assert.equal(verdict.installed.ok, false);
  assert.equal(verdict.exposed.state, "unknown");
  assert.ok(verdict.installed.missingDpfSkills.includes("dpf-writing-plans"));
  assert.equal(verdict.severity, "fail");
  assert.match(renderProcessSpineSummary(verdict)[0], /^Process spine: BROKEN/);
});

// BI-545943EE: the SessionStart output itself, not only the renderer.

const RESTART_ADVICE = /restart the client/i;

function hookContext(result) {
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  return parsed.hookSpecificOutput.additionalContext;
}

test("--hook with no exposure evidence emits UNPROVEN and the inline contract, without restart advice", () => {
  const context = hookContext(run(["--hook", "--skill-pack-root", makeSkillPack()], {}));
  const lines = context.split("\n");
  assert.match(lines[0], /^Process spine: UNPROVEN/);
  assert.ok(!context.includes("Process spine: VERIFIED"));
  assert.doesNotMatch(context, RESTART_ADVICE);
  for (const line of OPERATING_CONTRACT_LINES) {
    assert.ok(lines.includes(line), `contract line missing from SessionStart context: ${line}`);
  }
  for (const prefix of [
    "- principles/decisions-belong-to-their-scope: ",
    "- principles/escalation-is-a-gate-not-a-trust-tier: ",
    "- principles/consult-scopes-before-asking: ",
    "- AGENTS.md §11: ",
  ]) {
    assert.ok(lines.some((l) => l.startsWith(prefix) && l.length > prefix.length), `missing ${prefix}`);
  }
});

test("--hook with skills missing on disk emits BROKEN, restart advice, and the contract", () => {
  const context = hookContext(
    run(["--hook", "--skill-pack-root", makeSkillPack(["dpf-brainstorming"])], {}),
  );
  assert.match(context.split("\n")[0], /^Process spine: BROKEN/);
  assert.match(context, RESTART_ADVICE);
  for (const line of OPERATING_CONTRACT_LINES) assert.ok(context.includes(line));
});

test("--hook with a session that verifiably lacks a DPF skill emits BROKEN", () => {
  const context = hookContext(
    run(
      ["--hook", "--skill-pack-root", makeSkillPack(), "--exposed-skills", "superpowers:brainstorming"],
      {},
    ),
  );
  assert.match(context.split("\n")[0], /^Process spine: BROKEN/);
  assert.match(context, RESTART_ADVICE);
});

test("--hook with every DPF skill verifiably exposed emits nothing", () => {
  const result = run(
    ["--hook", "--skill-pack-root", makeSkillPack(), "--exposed-skills", REQUIRED_REPLACEMENT_SLUGS.join(",")],
    {},
  );
  assert.deepEqual(result, { exitCode: 0, stdout: "" });
});

test("the CLI path exits 2 only when skills are missing on disk", () => {
  assert.equal(run(["--skill-pack-root", makeSkillPack(["dpf-brainstorming"])], {}).exitCode, 2);
  const unproven = run(["--skill-pack-root", makeSkillPack()], {});
  assert.equal(unproven.exitCode, 0);
  assert.match(unproven.stdout, /^Process spine: UNPROVEN/);
});
