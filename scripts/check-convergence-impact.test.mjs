// scripts/check-convergence-impact.test.mjs
// BI-B19BE117: permanent red/green fixtures for the Convergence-Impact Gate.
// Registered in scripts/lib/ci-policy-guards.mjs (pull-request profile) —
// an unlisted test never runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONVERGENCE_MODES,
  TRAILER_NAME,
  classifyConvergenceSurfaces,
  evaluateConvergenceGate,
  loadRegistry,
  parseConvergenceDecisions,
  parseDockerfileCopySources,
  validateConvergenceDecisions,
} from "./check-convergence-impact.mjs";

const registry = loadRegistry();
const kinds = (files) => classifyConvergenceSurfaces(files, { registry }).map((s) => s.kind).sort();

// ── classification ──
test("registry lists only surfaces with a documented reason", () => {
  for (const s of registry.surfaces) {
    assert.ok(s.kind && s.why && s.why.length > 40, `${s.kind} needs a why`);
    assert.ok(Array.isArray(s.patterns) && s.patterns.length > 0, `${s.kind} needs patterns`);
  }
});

test("compose, env, installer, hooks and config surfaces classify", () => {
  // Several of these are ALSO single-file COPY sources in the Dockerfile, so a
  // second kind may ride along; the registry kind must always be present.
  const has = (files, kind) => assert.ok(kinds(files).includes(kind), `${files} -> ${kind}`);
  assert.deepEqual(kinds(["docker-compose.yml"]), ["compose", "image-copied-by-name"]);
  has(["Dockerfile.promoter"], "compose");
  assert.deepEqual(kinds([".env.example"]), ["env-contract"]);
  has(["scripts/promote.sh"], "installer");
  assert.deepEqual(kinds(["scripts/installer/install-state.v3.schema.json"]), ["installer"]);
  has(["install-dpf.ps1"], "installer");
  assert.deepEqual(kinds([".githooks/lib/pre-push-chained.sh"]), ["git-hooks"]);
  has(["scripts/set-hooks-path.mjs"], "git-hooks");
  assert.deepEqual(kinds(["config/install-resource-budgets.json"]), ["install-config"]);
});

test("the three motivating defects would each have been classified", () => {
  // BI-3727106F: hook convergence lived in postinstall only.
  assert.ok(kinds(["scripts/set-hooks-path.mjs", ".githooks/lib/pre-push-chained.sh"]).includes("git-hooks"));
  // BI-BE8BBDE9: promote.sh hard-required a launcher-signed envelope.
  assert.ok(kinds(["scripts/promote.sh", "apps/web/lib/self-upgrade/preflight.ts"]).includes("installer"));
  // BI-922EBB99 / #3262: services dropped from, and volumes added to, compose.
  assert.ok(kinds(["docker-compose.yml", ".env.example"]).includes("compose"));
});

test("files the image COPYs by name classify, directory sources and app source do not", () => {
  const df = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const copied = parseDockerfileCopySources(df);
  assert.ok(copied.includes("scripts/installer/resolve-host-identity.mjs"), "single-file COPY source parsed");
  assert.ok(!copied.includes("apps/web/"), "directory COPY source skipped");
  assert.ok(kinds(["scripts/lib/transition-signing.mjs"]).includes("image-copied-by-name"));
  assert.ok(kinds(["scripts/lib/capability-state-hash.mjs"]).includes("image-copied-by-name"));
  // app source is reached by the normal image rebuild — not a by-name COPY.
  assert.deepEqual(kinds(["apps/web/lib/self-upgrade/preflight.ts", "packages/db/package.json"]), []);
});

test("parseDockerfileCopySources handles flags, multi-source lines and ./ prefixes", () => {
  const text = [
    "FROM node:24",
    "COPY --chown=1000 pnpm-workspace.yaml pnpm-lock.yaml package.json ./",
    "COPY ./scripts/set-hooks-path.mjs ./scripts/",
    "COPY packages/ ./packages/",
    "ADD docker-entrypoint.sh ./",
  ].join("\n");
  assert.deepEqual(parseDockerfileCopySources(text).sort(), [
    "docker-entrypoint.sh",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "scripts/set-hooks-path.mjs",
  ]);
});

test("seed content classifies through the Seed-Fit registry, not a second list", () => {
  assert.deepEqual(kinds(["packages/db/src/seed-skills.ts"]), ["seed-content"]);
  assert.deepEqual(kinds(["prompts/reviewer/code-review.prompt.md"]), ["seed-content"]);
});

test("tests, fixtures, docs and ordinary source never classify", () => {
  assert.deepEqual(kinds([
    "scripts/check-convergence-impact.test.mjs",
    "scripts/installer/install-release-assets.test.mjs",
    "docs/testing/fixtures/data-impact/green.json",
    "docs/architecture/enforced-ci-gates.md",
    "apps/web/app/(shell)/finance/page.tsx",
    "packages/db/prisma/schema/finance.prisma",
    "scripts/check-docs-impact.mjs",
    "README.md",
  ]), []);
});

// ── trailer parsing ──
test("parses every accepted trailer shape", () => {
  const text = [
    `${TRAILER_NAME}: auto-converges — promote.sh composes from the new release assets`,
    `${TRAILER_NAME}: operator-action: add DPF_STATE_DIR to .env per the runbook`,
    `  ${TRAILER_NAME}: fresh-install-only (the file did not exist before and is not read)`,
    `${TRAILER_NAME}: not-reachable this script is CI-only and never copied into an image`,
  ].join("\n");
  const parsed = parseConvergenceDecisions(text);
  assert.deepEqual(parsed.map((d) => d.mode), ["auto-converges", "operator-action", "fresh-install-only", "not-reachable"]);
  assert.equal(parsed[0].reason, "promote.sh composes from the new release assets");
  assert.equal(parsed[2].reason, "the file did not exist before and is not read");
  assert.equal(parsed[3].reason, "this script is CI-only and never copied into an image");
});

test("trailer name is case-insensitive and body text without it yields nothing", () => {
  assert.equal(parseConvergenceDecisions("convergence-impact-decision: auto-converges — via the promoter compose path").length, 1);
  assert.deepEqual(parseConvergenceDecisions("Docs-Impact-Decision: no user-facing change"), []);
});

// ── validation ──
test("every mode is documented with help text", () => {
  for (const [mode, help] of Object.entries(CONVERGENCE_MODES)) assert.ok(help.length > 30, mode);
});

test("unknown mode, bare mode, and short reason each fail for their own reason", () => {
  const errs = (s) => validateConvergenceDecisions(parseConvergenceDecisions(`${TRAILER_NAME}: ${s}`));
  assert.match(errs("yes it is fine, trust me on this one")[0], /mode must be one of/);
  assert.match(errs("auto-converges")[0], /reason of at least/);
  assert.match(errs("auto-converges — promoter")[0], /reason of at least/);
  assert.deepEqual(errs("auto-converges — the session-start hook converger re-writes .githooks/pre-push"), []);
});

// ── gate flow ──
test("gate is a no-op when no install-reachable surface changed", () => {
  const r = evaluateConvergenceGate({ changedFiles: ["apps/web/lib/x.ts", "README.md"], registry });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "no-convergence-surface");
});

test("gate FAILS a compose change with no trailer (proves the gate is not inert)", () => {
  const r = evaluateConvergenceGate({ changedFiles: ["docker-compose.yml"], commitMessages: "feat: add a service", prBody: "", registry });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing-decision");
  // docker-compose.yml is also a single-file COPY source, so both kinds are true.
  assert.ok(r.surfaces.map((s) => s.kind).includes("compose"));
});

test("gate FAILS an attested change whose attestation is theater", () => {
  const r = evaluateConvergenceGate({
    changedFiles: [".env.example"],
    prBody: `${TRAILER_NAME}: auto-converges`,
    registry,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid-decision");
});

test("gate passes when a commit trailer states the mechanism", () => {
  const r = evaluateConvergenceGate({
    changedFiles: ["scripts/promote.sh"],
    commitMessages: `fix(promote): self-issue the envelope\n\n${TRAILER_NAME}: self-upgrade-step — promoter-migration-envelope.mjs self-issues for N-1 callers that cannot sign\n\nSigned-off-by: x`,
    registry,
  });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "attested");
  assert.equal(r.decisions[0].mode, "self-upgrade-step");
});

test("gate passes when the PR body states the mechanism", () => {
  const r = evaluateConvergenceGate({
    changedFiles: ["docker-compose.yml", ".env.example"],
    commitMessages: "",
    prBody: `## Summary\n\n${TRAILER_NAME}: operator-action — add DPF_NEW_KEY to .env on each install; runbook updated in docs/operations/self-upgrade-runbook.md`,
    registry,
  });
  assert.equal(r.ok, true);
});
