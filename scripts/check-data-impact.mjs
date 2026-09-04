#!/usr/bin/env node
// Data-Impact Gate — content-based data-governance conformance gate (BI-DG-003, spec §6.9).
//
// NOT a "file touched" check. When a PR changes a persistent surface (schema, migration,
// projection producer, AI-context source, MDM domain, or lifecycle executor) it must
// carry a generated DataImpactManifest (`*.data-impact.json`) — or a structured,
// unexpired exception (`*.data-impact-exception.json`) — that completely describes the
// change per the §6.9 contract. This script exports the pure validators (unit-tested
// against permanent red/green fixtures) and a `main()` that runs the gate in CI/local.
//
// Rollout is a non-growing ratchet: pre-existing gaps live in the BI-DG-002 immutable
// legacy baseline; every NEW/CHANGED persistent surface must satisfy the full contract.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { listChangedFiles } from "./lib/git-changed-files.mjs";

// ── Persistent-surface classification (kept conservative for the first ship) ──
export const PERSISTENT_SURFACE_RULES = [
  // Matches the schema domain folder (packages/db/prisma/schema/*.prisma, the
  // B5 Seam C layout) AND the legacy schema.prisma monolith so diffs that span
  // the split still classify.
  { kind: "schema", re: /^packages\/db\/prisma\/schema(\.prisma$|\/[^/]+\.prisma$)/ },
  { kind: "migration", re: /^packages\/db\/prisma\/migrations\// },
  { kind: "projection", re: /lib\/(ea\/data-model-mirror|integrate\/.*graph-sync|.*pgvector-store)\.ts$/ },
  { kind: "ai-context", re: /lib\/inference\/semantic-memory(\b|[.-])/ },
  { kind: "mdm-domain", re: /lib\/mdm\/domain-registry\.ts$/ },
  { kind: "lifecycle", re: /lib\/operate\/retention\// },
];

export function classifyChangedSurfaces(changedFiles) {
  const kinds = new Set();
  for (const f of changedFiles) {
    for (const rule of PERSISTENT_SURFACE_RULES) {
      if (rule.re.test(f)) kinds.add(rule.kind);
    }
  }
  return [...kinds];
}

const FIELD_RESOLUTIONS = new Set(["inherited", "governed", "not-applicable"]);
const SENSITIVE_FLAGS = new Set(["sensitive", "subject", "prohibited"]);
const POLICY_VECTORS = ["allow", "deny", "obligation", "unknownContext", "precedence", "exceptionExpiry"];
const MDM_CONTRACTS = ["ownership", "crosswalk", "match", "quality", "lifecycle", "publish"];

// ── Manifest validation (deterministic, CI-friendly error strings) ──
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return ["manifest is not an object"];
  if (manifest.version !== "1") errors.push('manifest.version must be "1"');
  if (!manifest.accountableOwner) errors.push("manifest.accountableOwner is required");
  if (!Array.isArray(manifest.changes) || manifest.changes.length === 0) {
    errors.push("manifest.changes must be a non-empty array");
    return errors;
  }

  manifest.changes.forEach((change, i) => {
    const at = `changes[${i}]`;
    switch (change?.kind) {
      case "model": {
        if (!change.assetId) errors.push(`${at}: model change needs a stable assetId`);
        if (!change.lifecycleDisposition) errors.push(`${at}: model change needs a lifecycleDisposition`);
        if (!Array.isArray(change.fields)) {
          errors.push(`${at}: model change needs a fields[] resolution`);
          break;
        }
        change.fields.forEach((field, j) => {
          const fat = `${at}.fields[${j}]`;
          if (!FIELD_RESOLUTIONS.has(field?.resolution)) {
            errors.push(`${fat}: resolution must be inherited|governed|not-applicable`);
          }
          if (!field?.reason) errors.push(`${fat}: needs a resolution reason`);
          if (!field?.provenance) errors.push(`${fat}: needs provenance`);
          const flags = Array.isArray(field?.flags) ? field.flags : [];
          if (flags.some((f) => SENSITIVE_FLAGS.has(f)) && !field?.fieldPolicy) {
            errors.push(`${fat}: sensitive/subject/prohibited field needs a governed fieldPolicy`);
          }
        });
        break;
      }
      case "projection": {
        if (!change.derivedContractId) errors.push(`${at}: projection needs a derivedContractId`);
        if (!change.cleanupTest) errors.push(`${at}: projection needs a cleanup test`);
        if (!change.reconciliationTest) errors.push(`${at}: projection needs a reconciliation test`);
        break;
      }
      case "mdm-domain": {
        for (const req of MDM_CONTRACTS) {
          if (!change[req]) errors.push(`${at}: new master-data domain needs a ${req} contract`);
        }
        break;
      }
      case "destructive": {
        if (change.holdCheck !== true) errors.push(`${at}: destructive path must check legal holds`);
        if (change.dispositionEvidence !== true) {
          errors.push(`${at}: destructive path must write disposition evidence`);
        }
        break;
      }
      case "policy": {
        const vectors = change.testVectors ?? {};
        for (const v of POLICY_VECTORS) {
          if (!vectors[v]) errors.push(`${at}: executable policy needs a ${v} test vector`);
        }
        break;
      }
      default:
        errors.push(`${at}: unknown change kind ${JSON.stringify(change?.kind)}`);
    }
  });

  return errors;
}

// ── Exception validation ──
export function validateException(exception, { now } = {}) {
  const errors = [];
  if (!exception || typeof exception !== "object") return ["exception is not an object"];
  for (const req of ["scope", "approver", "rationale", "compensatingControl", "expiry", "remediationBI"]) {
    if (!exception[req]) errors.push(`exception needs a ${req}`);
  }
  const nowIso = now ?? new Date().toISOString();
  if (exception.expiry && String(exception.expiry) <= nowIso) {
    errors.push("exception.expiry must be in the future (an expired attestation is not an exception)");
  }
  const waives = Array.isArray(exception.waives) ? exception.waives : [];
  if (waives.includes("prohibited-storage")) {
    errors.push("exception cannot permit prohibited storage");
  }
  if (waives.includes("asset-coverage") || waives.includes("lifecycle-coverage")) {
    errors.push("exception cannot waive asset/lifecycle coverage for a new persistent model");
  }
  return errors;
}

// ── CI entrypoint ──
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

export function runGate({
  base = process.env.BASE_SHA || "origin/main",
  changed,
  readFile = (f) => readFileSync(f, "utf8"),
} = {}) {
  let files = changed;
  if (!files) {
    const listed = listChangedFiles(base);
    if (listed.status === "unresolvable") {
      return {
        ok: false,
        message: `cannot resolve ${base} — the guard did not run. This is not a pass. Remedy: git fetch --deepen 50 origin.`,
      };
    }
    files = listed.files;
  }

  const surfaces = classifyChangedSurfaces(files);
  if (surfaces.length === 0) {
    return { ok: true, message: "No persistent surface changed — nothing to gate." };
  }

  const isFixture = (f) => f.includes("fixtures/");
  const manifestFile = files.find((f) => /\.data-impact\.json$/.test(f) && !isFixture(f));
  const exceptionFile = files.find((f) => /\.data-impact-exception\.json$/.test(f) && !isFixture(f));

  if (!manifestFile && !exceptionFile) {
    return {
      ok: false,
      message:
        `changed persistent surface(s) [${surfaces.join(", ")}] require a DataImpactManifest ` +
        `(*.data-impact.json) or a structured exception (*.data-impact-exception.json).`,
    };
  }

  const errors = [];
  if (manifestFile) {
    errors.push(...validateManifest(JSON.parse(readFile(manifestFile))).map((e) => `manifest: ${e}`));
  }
  if (exceptionFile) {
    errors.push(...validateException(JSON.parse(readFile(exceptionFile))).map((e) => `exception: ${e}`));
  }
  return errors.length > 0
    ? { ok: false, message: errors.join("\n - ") }
    : { ok: true, message: `Data-impact contract satisfied for [${surfaces.join(", ")}].` };
}

// Executed directly (not imported by the test).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-data-impact.mjs")) {
  const result = runGate();
  if (result.ok) {
    console.log(`[data-impact-gate] ${result.message}`);
    process.exit(0);
  }
  console.error(`[data-impact-gate] FAILED:\n - ${result.message}`);
  console.error(
    "\nAdd a generated *.data-impact.json manifest (asset IDs, change kinds, field resolutions,\n" +
      "policy decisions, accountable owner, affected copies, migration/backfill, tests) or a\n" +
      "structured *.data-impact-exception.json (scope, approver, rationale, compensating control,\n" +
      "expiry, remediation BI). See AGENTS.md → Data-Impact Gate and the design spec §6.9.",
  );
  process.exit(1);
}
