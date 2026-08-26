#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  collectToolchainFingerprint,
  createLocalIntegrationPlan,
  createProductionArtifactIdentity,
  dockerBuildTag,
  executeLocalIntegrationPlan,
  resolveGitRevision,
} from "./lib/local-integration-ci.mjs";
import { checkHostDiskSpace } from "./lib/disk-space-preflight.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
}

function readJsonIfPresent(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function resolveGitRevisionOrNull(ref) {
  try {
    return resolveGitRevision(ref);
  } catch {
    return null;
  }
}

const candidateBranch = valueAfter("--candidate");
const baseRef = valueAfter("--base-ref") || "origin/main";
const candidateSha = valueAfter("--candidate-sha");
const baseSha = valueAfter("--base-sha");
const baseFreshnessStatus = valueAfter("--base-freshness-status")
  || (process.argv.includes("--fetch-base") ? "remote-current" : "offline-accepted");
const baseResolvedAt = valueAfter("--base-resolved-at");
const baseFetchMode = valueAfter("--base-fetch-mode");
const metadataOut = valueAfter("--metadata-out");
const evidencePlanOut = valueAfter("--evidence-plan-out")
  || (metadataOut ? join(dirname(metadataOut), "dpf-ci-evidence-plan.json") : "");
const mode = valueAfter("--mode") || "single-branch";
const buildStrategy = valueAfter("--build-strategy");
const slotKey = valueAfter("--slot-key") || process.env.DPF_LOCAL_CI_SLOT_KEY || "";
const fetchBase = process.argv.includes("--fetch-base");
const siblingBranches = process.argv
  .filter((arg) => arg.startsWith("--sibling="))
  .map((arg) => arg.slice("--sibling=".length));

if (!candidateBranch) {
  console.error("Usage: node scripts/local-integration-ci.mjs --candidate BRANCH [--base-ref REF] [--candidate-sha SHA] [--base-sha SHA] [--slot-key SLOT] [--metadata-out PATH] [--evidence-plan-out PATH] [--fetch-base] [--mode single-branch|sibling-set|post-merge-main] [--sibling=BRANCH] [--migrate-deploy]");
  process.exit(2);
}

const plan = createLocalIntegrationPlan({
  candidateBranch,
  baseRef,
  mode,
  siblingBranches,
  buildStrategy: buildStrategy || undefined,
  fetchBase,
  evidencePlanOutput: evidencePlanOut || undefined,
  includeMigrateDeploy: process.argv.includes("--migrate-deploy"),
  slotKey: slotKey || undefined,
});

const diskCheck = checkHostDiskSpace();
if (!diskCheck.ok) {
  console.error(diskCheck.message);
  process.exit(1);
}

const startedAt = new Date().toISOString();
const execution = executeLocalIntegrationPlan(plan);
if (metadataOut) {
  const evidencePlan = readJsonIfPresent(evidencePlanOut);
  const vitestDiagnostics = readJsonIfPresent(
    process.env.DPF_LOCAL_CI_VITEST_DIAGNOSTICS_FILE || `${metadataOut}.vitest.json`,
  );
  const typecheckDiagnostics = readJsonIfPresent(
    process.env.DPF_LOCAL_CI_TYPECHECK_RECEIPT_FILE || `${metadataOut}.typecheck.json`,
  );
  const buildDiagnostics = readJsonIfPresent(
    process.env.DPF_LOCAL_CI_BUILD_RECEIPT_FILE || `${metadataOut}.build.json`,
  );
  const integrationCommitSha = resolveGitRevisionOrNull("HEAD");
  const synthesizedTreeSha = resolveGitRevisionOrNull("HEAD^{tree}");
  const imageTag = plan.buildStrategy === "docker-build"
    ? dockerBuildTag(candidateBranch, slotKey)
    : "";
  const imageInspect = imageTag
    ? spawnSync("docker", ["image", "inspect", imageTag, "--format", "{{.Id}}"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    })
    : null;
  let nextBuildId = "";
  try {
    nextBuildId = readFileSync(join(process.cwd(), "apps", "web", ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    // Docker builds do not materialize the build output in the host checkout.
  }
  const productionArtifact = execution.status === 0
    ? createProductionArtifactIdentity({
        buildStrategy: plan.buildStrategy,
        integrationTreeSha: synthesizedTreeSha,
        dockerImageTag: imageTag,
        dockerImageId: imageInspect?.status === 0 ? imageInspect.stdout.trim() : "",
        nextBuildId,
      })
    : null;
  const payload = {
    schemaVersion: 3,
    bi: "BI-76551B2D",
    mode,
    candidateRef: candidateBranch,
    candidateSha: candidateSha || resolveGitRevisionOrNull(candidateBranch),
    baseRef,
    fetchBase: baseFreshnessStatus === "remote-current" || fetchBase,
    baseFreshness: {
      status: baseFreshnessStatus,
      resolvedAt: baseResolvedAt || null,
      fetchMode: baseFetchMode || null,
    },
    baseSha: baseSha || resolveGitRevisionOrNull(baseRef),
    integrationBranch: plan.integrationBranch,
    slotKey: slotKey || null,
    integrationCommitSha,
    synthesizedTreeSha,
    buildStrategy: plan.buildStrategy,
    executionLane: evidencePlan?.executionLane ?? plan.executionLane,
    productionArtifact,
    execution: {
      status: execution.status === 0 ? "passed" : "failed",
      exitCode: execution.status,
      completedCommandCount: execution.completedCommandCount,
      failedCommand: execution.failedCommand?.join(" ") ?? null,
      failureDiagnostics: execution.diagnostics,
      typecheck: typecheckDiagnostics,
      vitest: vitestDiagnostics,
      productionBuild: buildDiagnostics,
    },
    evidencePlan: evidencePlan ? {
      path: evidencePlanOut,
      digest: evidencePlan.digest,
      plannerVersion: evidencePlan.plannerVersion,
      policyVersion: evidencePlan.policyVersion,
      evidenceTier: evidencePlan.evidenceTier,
      executionLane: evidencePlan.executionLane,
      fullSuite: evidencePlan.fullSuite,
    } : null,
    ...collectToolchainFingerprint({ buildStrategy: plan.buildStrategy }),
    commands: plan.commands.map((command) => command.join(" ")),
    startedAt,
    completedAt: new Date().toISOString(),
    // BI-465B3D60 — the RUN's identity, not the commit's. Re-running the gate on
    // an unchanged SHA produces several runs whose candidateSha is identical, so
    // a SHA cannot tell them apart; a reader comparing SHAs concludes this
    // metadata describes the current run when it describes a previous one. The
    // lease is per-run, so it is the thing that actually distinguishes them.
    // Null when the runner is invoked outside a governed lease.
    runLeaseId: process.env.DPF_NONPROD_LEASE_ID || null,
  };
  writeFileSync(metadataOut, `${JSON.stringify(payload, null, 2)}\n`);
  const artifactOut = process.env.DPF_LOCAL_CI_ARTIFACT_FILE;
  if (artifactOut) {
    if (productionArtifact) {
      writeFileSync(artifactOut, `${JSON.stringify(productionArtifact, null, 2)}\n`);
    }
  }
  console.log(`[local-integration-ci] metadata ${metadataOut}`);
}
if (execution.status !== 0) {
  process.exit(execution.status);
}
