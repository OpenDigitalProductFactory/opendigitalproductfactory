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
    // check-docs-impact.mjs left this list when gate-context's packaged closure
    // began COPYing it by name (BI-9B17E889); gen-doc-impact.mjs is not copied.
    "scripts/gen-doc-impact.mjs",
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

test("a trailer quoted inside a fenced code block is an example, not an attestation", () => {
  const fence = "```";
  const example = `${TRAILER_NAME}: <mode> — <mechanism or reason, 20+ chars>`;
  const real = `${TRAILER_NAME}: auto-converges — the ordinary image swap carries the COPY closure`;
  const body = ["Add a trailer like:", fence, example, fence, "", real].join("\n");
  const parsed = parseConvergenceDecisions(body);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].mode, "auto-converges");
  // A body that ONLY quotes the example still has no attestation.
  assert.deepEqual(parseConvergenceDecisions(["Add:", fence, example, fence].join("\n")), []);
  assert.deepEqual(parseConvergenceDecisions(["~~~text", example, "~~~"].join("\n")), []);
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

// ── platform coverage (BI-084F85E5) ──
test("host-runtime code classifies: agent installers, start entrypoints, autostart, the agent itself", () => {
  for (const f of [
    "scripts/installer/native-edge-host.ps1",
    "scripts/installer/native-edge-host.sh",
    "scripts/installer/dpf-start.consumer.sh",
    "scripts/installer/lib/host-convergence.ps1",
    "scripts/installer/lib/autostart.sh",
    "scripts/installer/linux-systemd.service.tmpl",
    "scripts/installer/macos-edge-node.plist.tmpl",
    "services/edge-node-go/internal/action/docker_vm_restart.go",
  ]) assert.ok(kinds([f]).includes("host-runtime"), f);
  assert.ok(!kinds(["scripts/installer/install-state.schema.json"]).includes("host-runtime"));
});

test("gate FAILS a host-runtime change whose decisions converge only one platform", () => {
  const r = evaluateConvergenceGate({
    changedFiles: ["scripts/installer/native-edge-host.ps1"],
    commitMessages: `${TRAILER_NAME}: operator-action — re-run install-dpf.ps1 on each Windows host to install the agent`,
    registry,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "platform-coverage-missing");
  assert.match(r.errors[0], /no decision names: macos, linux/);
});

test("gate passes a host-runtime change that says how every platform converges", () => {
  const perPlatform = evaluateConvergenceGate({
    changedFiles: ["scripts/installer/native-edge-host.sh", "scripts/installer/native-edge-host.ps1"],
    commitMessages: [
      `${TRAILER_NAME}: self-upgrade-step — Windows: the shipped dpf-start.ps1 converges the agent at the next sign-in`,
      `${TRAILER_NAME}: self-upgrade-step — macOS and Linux: the shipped dpf-start.consumer.sh converges it at the next boot`,
    ].join("\n"),
    registry,
  });
  assert.equal(perPlatform.ok, true, perPlatform.errors?.join("; "));
  const notHostSide = evaluateConvergenceGate({
    changedFiles: ["scripts/promote.sh"],
    commitMessages: `${TRAILER_NAME}: self-upgrade-step — promoter-migration-envelope.mjs self-issues for N-1 callers`,
    registry,
  });
  assert.equal(notHostSide.ok, true, "platform coverage applies only to host-runtime changes");
});

// ── per-service compose convergence (BI-205A85C0, D5 of BI-C54E691E) ──
// #6020 gave portal-tls a reaping init and attested auto-converges, but no
// self-upgrade step recreates a running stateless sidecar (step 7e only
// reports, WWMD DI-C04ABC76BBF4), so the fix never arrived. The gate now checks
// an auto-converges claim per changed service: the file must be in a compose
// chain the installer or promoter can resolve, and the service's recreate
// class must have a live convergence mechanism.
const TLS_BEFORE = `services:
  portal-tls:
    image: caddy:2
    labels:
      dpf.recreate-class: stateless
`;
const TLS_AFTER = `services:
  portal-tls:
    image: caddy:2
    init: true
    labels:
      dpf.recreate-class: stateless
`;
const pair = (files) => (file) => files[file] ?? { base: "", head: "" };
const autoConverges = `${TRAILER_NAME}: auto-converges — promote.sh composes from the new release assets on the next self-upgrade`;

test("#6020's shape: a running stateless sidecar change cannot claim auto-converges while step 7e is report-only", () => {
  const r = evaluateConvergenceGate({
    changedFiles: ["docker-compose.tls.yml"],
    prBody: autoConverges,
    registry,
    readComposePair: pair({ "docker-compose.tls.yml": { base: TLS_BEFORE, head: TLS_AFTER } }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "compose-service-not-converged");
  assert.match(r.errors.join("\n"), /portal-tls \(stateless, docker-compose\.tls\.yml\)/);
  assert.match(r.errors.join("\n"), /7e/);
});

test("the same change passes when the PR names an operator action or the step it adds", () => {
  for (const decision of [
    `${TRAILER_NAME}: operator-action — recreate portal-tls on each install; docs/operations/self-upgrade-runbook.md`,
    `${TRAILER_NAME}: self-upgrade-step — this PR makes step 7e recreate changed stateless services`,
  ]) {
    const r = evaluateConvergenceGate({
      changedFiles: ["docker-compose.tls.yml"], prBody: decision, registry,
      readComposePair: pair({ "docker-compose.tls.yml": { base: TLS_BEFORE, head: TLS_AFTER } }),
    });
    assert.equal(r.ok, true, decision);
  }
});

test("a managed service change and a newly added service can claim auto-converges", () => {
  const portalBefore = "services:\n  portal:\n    image: a\n    labels:\n      dpf.recreate-class: managed\n";
  const portalAfter = "services:\n  portal:\n    image: b\n    labels:\n      dpf.recreate-class: managed\n  newbie:\n    image: n\n    labels:\n      dpf.recreate-class: stateless\n";
  const r = evaluateConvergenceGate({
    changedFiles: ["docker-compose.yml"], prBody: autoConverges, registry,
    readComposePair: pair({ "docker-compose.yml": { base: portalBefore, head: portalAfter } }),
  });
  assert.equal(r.ok, true, r.errors?.join("\n"));
});

test("a data-owner change cannot claim auto-converges until a step converges data owners", () => {
  const before = "services:\n  postgres:\n    image: pg:16\n    labels:\n      dpf.recreate-class: data-owner\n";
  const r = evaluateConvergenceGate({
    changedFiles: ["docker-compose.yml"], prBody: autoConverges, registry,
    readComposePair: pair({ "docker-compose.yml": { base: before, head: before.replace("pg:16", "pg:17") } }),
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /postgres \(data-owner, docker-compose\.yml\)/);
});

test("a service changed in a file no resolved chain contains cannot claim auto-converges", () => {
  const before = "services:\n  ci-db:\n    image: a\n    labels:\n      dpf.recreate-class: stateless\n";
  const r = evaluateConvergenceGate({
    changedFiles: ["docker-compose.local-ci.yml"], prBody: autoConverges, registry,
    readComposePair: pair({ "docker-compose.local-ci.yml": { base: before, head: before.replace("image: a", "image: b") } }),
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /docker-compose\.local-ci\.yml.*no compose chain/);
});

test("a removed service cannot claim auto-converges: self-upgrade never stops a dropped service", () => {
  const before = "services:\n  old:\n    image: a\n    labels:\n      dpf.recreate-class: stateless\n  keep:\n    image: k\n";
  const r = evaluateConvergenceGate({
    changedFiles: ["docker-compose.yml"], prBody: autoConverges, registry,
    readComposePair: pair({ "docker-compose.yml": { base: before, head: "services:\n  keep:\n    image: k\n" } }),
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /old.*removed/);
});

test("the chain file list matches the installer's resolver and the activation table", () => {
  const chain = registry.composeConvergence.chainFiles;
  for (const f of ["docker-compose.yml", "docker-compose.release.yml", "docker-compose.macos.yml", "docker-compose.linux.yml", "docker-compose.edge.yml"]) {
    assert.ok(chain.includes(f), f);
    assert.match(readFileSync(new URL("./installer/lib/compose.sh", import.meta.url), "utf8"), new RegExp(f.replace(/\./g, "\\.")));
  }
});
