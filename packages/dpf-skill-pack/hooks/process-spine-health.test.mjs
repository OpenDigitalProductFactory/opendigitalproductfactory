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
} from "./process-spine-health-check.mjs";

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
  assert.match(summary, /warn-only/);
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
  assert.match(renderProcessSpineSummary(verdict).join("\n"), /DPF-native replacement skills are not active/);
});

test("warns when installed skills cannot be proven exposed in the active session", () => {
  const verdict = assessProcessSpine({
    skillPackRoot: makeSkillPack(),
    exposedSkills: null,
  });

  assert.equal(verdict.installed.ok, true);
  assert.equal(verdict.exposed.state, "unknown");
  assert.equal(verdict.severity, "warn");
  const summary = renderProcessSpineSummary(verdict).join("\n");
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
});
