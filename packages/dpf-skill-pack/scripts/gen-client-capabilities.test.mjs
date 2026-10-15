// BI-64795FD0: the profile generator and its drift check.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CASES_PATH,
  CONVERGENCE_PATH,
  MATRIX_BEGIN,
  MATRIX_END,
  MODULE_PATH,
  PROFILE_PATH,
  SELFTEST_PATH,
  TRACKER_PATH,
  carrierDrift,
  generateOutputs,
  readSelftestProbes,
  readUpdaterCarriers,
  renderMatrix,
  renderPolicyCases,
  spliceMatrix,
  staleOutputs,
  validateProfile,
} from "./gen-client-capabilities.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
const profile = () => JSON.parse(read(PROFILE_PATH));
const probes = () => readSelftestProbes(read(SELFTEST_PATH));

/** A throwaway repo root holding only what the generator reads and writes. */
function scratchRoot() {
  const root = mkdtempSync(join(tmpdir(), "client-capabilities-"));
  for (const path of [PROFILE_PATH, SELFTEST_PATH, TRACKER_PATH, CASES_PATH, MODULE_PATH, CONVERGENCE_PATH]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(REPO_ROOT, path), join(root, path));
  }
  return root;
}

test("the committed profile is valid", () => {
  assert.deepEqual(validateProfile(profile(), { knownProbes: probes() }), []);
});

test("the committed outputs match the profile", () => {
  assert.deepEqual(staleOutputs(REPO_ROOT), []);
});

test("the generated policy cases keep today's behaviour row for row", () => {
  const cases = JSON.parse(renderPolicyCases(profile()));
  assert.equal(cases.length, 60);
  const required = (endpoint, client, mode) => cases.find((c) => c.endpoint === endpoint && c.client === client && c.mode === mode).required;
  assert.equal(required("https://dpf.example/api/mcp/v1", "grok", "oauth"), true);
  assert.equal(required("https://dpf.example/api/mcp/v1", "claude", "oauth"), false);
  assert.equal(required("http://127.0.0.1:3000/api/mcp/v1", "codex", "oauth"), false);
  assert.equal(required("http://127.0.0.1:3000/api/mcp/v1", "claude", "oauth"), true);
  assert.equal(required("http://remote.example/api/mcp/v1", "codex", "oauth"), true);
  assert.ok(cases.filter((c) => c.mode === "legacy").every((c) => c.required));
});

test("a profile change shows up as drift until regenerated", () => {
  const root = scratchRoot();
  try {
    const changed = profile();
    changed.clients.grok.capabilities.oauthHttps = {
      value: true, status: "verified", verifiedAt: "2026-10-13", verifiedVersion: "0.3.0", evidence: "test probe",
    };
    writeFileSync(join(root, PROFILE_PATH), JSON.stringify(changed, null, 2));
    assert.deepEqual(staleOutputs(root).sort(), [CASES_PATH, MODULE_PATH, TRACKER_PATH].sort());
    for (const [path, content] of generateOutputs(root)) writeFileSync(join(root, path), content);
    assert.deepEqual(staleOutputs(root), []);
    const cases = JSON.parse(readFileSync(join(root, CASES_PATH), "utf8"));
    assert.equal(cases.find((c) => c.endpoint.startsWith("https:") && c.client === "grok" && c.mode === "oauth").required, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a hand edit inside the rendered matrix is drift", () => {
  const root = scratchRoot();
  try {
    const tracker = readFileSync(join(root, TRACKER_PATH), "utf8");
    writeFileSync(join(root, TRACKER_PATH), tracker.replace("hooks unproven", "hooks fine"));
    assert.deepEqual(staleOutputs(root), [TRACKER_PATH]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prose outside the markers is the tracker's own and is kept", () => {
  const spliced = spliceMatrix(`# History\n\n${MATRIX_BEGIN}\nold\n${MATRIX_END}\n\nOlder prose.\n`, "NEW");
  assert.equal(spliced, "# History\n\nNEW\n\nOlder prose.\n");
  assert.throws(() => spliceMatrix("no markers here", "NEW"), /no generated client-capability-matrix markers/);
});

test("the matrix shows hook gaps beside auth gaps", () => {
  const matrix = renderMatrix(profile());
  assert.match(matrix, /\| Antigravity \(`antigravity`\) \| none \|.*\| cli: hooks unproven; desktop: hooks unproven; ide: hooks unproven \|/);
  assert.match(matrix, /\| `codex` \| cli \| fires: PreToolUse shell; does not fire: PreToolUse ask;/);
  assert.match(matrix, /\| `claude-code` \| desktop \| fires: PreToolUse shell, PreToolUse ask;.*\| bypassPermissions \| 2026-10-13, v2\.1\.295 \|/);
});

test("validation refuses what the profile must never say", () => {
  const bad = profile();
  bad.clients.grok.capabilities.oauthHttps = { value: true, status: "unproven", verifiedAt: null, verifiedVersion: null, evidence: "x" };
  bad.clients.codex.capabilities.hookPlane.desktop.events["PreToolUse:Bash"] = "fires";
  bad.clients.codex.capabilities.hookPlane.cli.probes = ["no-such-guard.mjs"];
  bad.clients.antigravity.sources = [];
  bad.clients.vscode.capabilities.skillsLoad = { value: true, status: "verified", verifiedAt: null, verifiedVersion: null, evidence: "" };
  const problems = validateProfile(bad, { knownProbes: probes() });
  assert.ok(problems.some((p) => p.includes("grok.oauthHttps: an unproven capability cannot be true")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("codex.hookPlane.desktop: an unverified hook plane cannot state")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("no-such-guard.mjs is not a probe")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("antigravity: sources[] needs at least one")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("vscode.skillsLoad: evidence is required")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("vscode.skillsLoad: verifiedAt")), problems.join("\n"));
});

test("an invalid profile writes nothing", () => {
  const root = scratchRoot();
  try {
    const bad = profile();
    delete bad.clients.codex;
    writeFileSync(join(root, PROFILE_PATH), JSON.stringify(bad));
    assert.throws(() => generateOutputs(root), /exactly one row must have policyClient "codex"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the profile's carriers equal the updater's DEFAULT_CARRIERS", () => {
  const carriers = readUpdaterCarriers(read(CONVERGENCE_PATH));
  assert.deepEqual(carriers, { "claude-code": "header", codex: "header", grok: "query", antigravity: "header" });
  assert.deepEqual(carrierDrift(profile(), carriers), []);
});

test("a carrier the updater and the profile disagree on refuses to generate", () => {
  const root = scratchRoot();
  try {
    const python = readFileSync(join(root, CONVERGENCE_PATH), "utf8").replace('"grok": "query"', '"grok": "header"');
    writeFileSync(join(root, CONVERGENCE_PATH), python);
    assert.throws(() => generateOutputs(root), /grok: profile declarationCarrier query but .* says header/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
