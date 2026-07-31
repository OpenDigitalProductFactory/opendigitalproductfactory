#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CI_EVIDENCE_ARTIFACT_PREFIX,
  CI_EVIDENCE_LIFETIME_MS,
  createEvidenceReceipt,
  evidenceArtifactDiscoveryVerdict,
  normalizeArtifactInventory,
  receiptChecksum,
  validateEvidenceReceipt,
} from "./lib/ci-evidence-receipt.mjs";
import { sha256Bytes, sha256File } from "./lib/ci-build-artifact.mjs";
import { parseAggregate } from "./merge-readiness-policy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_PATH = ".github/workflows/ci.yml";
const MERGE_POLICY_PATH = "config/merge-readiness-policy.json";
const PLANNER_PATHS = [
  "scripts/ci-evidence-plan.mjs",
  "scripts/lib/ci-evidence-plan.mjs",
  "config/ci-evidence-policy.json",
];
const SETUP_PATH = ".github/actions/setup-pnpm/action.yml";

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!flag.startsWith("--")) throw new Error(`unexpected argument: ${flag}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    options[flag.slice(2)] = value;
    index += 1;
  }
  return { mode, options };
}

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function appendOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values)
    .map(([key, value]) => `${key}=${String(value).replaceAll("\n", " ")}`);
  writeFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, { flag: "a" });
}

function appendSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { flag: "a" });
}

function fingerprintFiles(paths) {
  return sha256Bytes(JSON.stringify(paths.map((path) => ({
    path,
    sha256: sha256File(join(ROOT, path)),
  }))));
}

function declaredNodeMajor() {
  const source = readFileSync(join(ROOT, SETUP_PATH), "utf8");
  const match = source.match(/node-version:\s*([0-9]+)/);
  if (!match) throw new Error(`${SETUP_PATH} does not declare a Node major`);
  return Number(match[1]);
}

function collectToolchain() {
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return {
    runnerOs: process.platform,
    runnerArch: process.arch,
    runnerImageOs: process.env.ImageOS ?? null,
    runnerImageVersion: process.env.ImageVersion ?? null,
    node: process.version,
    declaredNodeMajor: declaredNodeMajor(),
    packageManager: rootPackage.packageManager,
    lockfileSha256: sha256File(join(ROOT, "pnpm-lock.yaml")),
    setupFingerprint: fingerprintFiles([SETUP_PATH]),
  };
}

function collectIdentity() {
  const mergePolicy = JSON.parse(readFileSync(join(ROOT, MERGE_POLICY_PATH), "utf8"));
  return {
    workflowPath: WORKFLOW_PATH,
    workflowFingerprint: fingerprintFiles([WORKFLOW_PATH]),
    plannerImplementationFingerprint: fingerprintFiles(PLANNER_PATHS),
    mergePolicyManifestFingerprint: fingerprintFiles([MERGE_POLICY_PATH]),
    mergePolicyRequiredContexts: [...mergePolicy.requiredContexts].sort(),
    toolchain: collectToolchain(),
  };
}

function expectedGateIds() {
  const manifest = JSON.parse(readFileSync(join(ROOT, MERGE_POLICY_PATH), "utf8"));
  const workflow = readFileSync(join(ROOT, WORKFLOW_PATH), "utf8");
  const aggregate = parseAggregate(workflow, manifest.aggregateJobId);
  if (!aggregate) throw new Error(`cannot find aggregate job ${manifest.aggregateJobId}`);
  return aggregate.needs;
}

async function githubJson(path) {
  const base = process.env.DPF_GITHUB_API_BASE_URL || "https://api.github.com";
  const response = await fetch(`${base}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "dpf-ci-evidence-receipt",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function runArtifacts(runId) {
  const repository = process.env.GITHUB_REPOSITORY;
  const response = await githubJson(
    `/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
  );
  return response.artifacts ?? [];
}

async function create(options) {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const planDigest = process.env.DPF_CI_PLANNER_DIGEST;
  if (!repository || !runId || !runAttempt || !eventName || !planDigest) {
    throw new Error(
      "create requires GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, "
      + "GITHUB_EVENT_NAME, and DPF_CI_PLANNER_DIGEST",
    );
  }
  const needs = JSON.parse(process.env.NEEDS_JSON ?? "{}");
  const artifacts = await runArtifacts(runId);
  const identity = collectIdentity();
  const now = Date.now();
  const receipt = createEvidenceReceipt({
    repository,
    source: {
      commitSha: process.env.GITHUB_SHA || git("rev-parse", "HEAD"),
      treeSha: git("rev-parse", "HEAD^{tree}"),
    },
    workflow: {
      eventName,
      runId,
      runAttempt,
      workflowPath: identity.workflowPath,
      workflowFingerprint: identity.workflowFingerprint,
    },
    planner: {
      planDigest,
      implementationFingerprint: identity.plannerImplementationFingerprint,
    },
    mergePolicy: {
      manifestFingerprint: identity.mergePolicyManifestFingerprint,
      requiredContexts: identity.mergePolicyRequiredContexts,
    },
    toolchain: identity.toolchain,
    gates: needs,
    artifacts,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CI_EVIDENCE_LIFETIME_MS).toISOString(),
  });

  const outputDir = resolve(ROOT, options["output-dir"] ?? "artifacts/ci-evidence");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "ci-evidence.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(join(outputDir, "ci-evidence.sha256"), `${receiptChecksum(receipt)}\n`);
  appendOutput({
    artifact_name: `${CI_EVIDENCE_ARTIFACT_PREFIX}-${receipt.source.treeSha}`,
    tree_sha: receipt.source.treeSha,
  });
  appendSummary([
    "### Exact-tree CI evidence receipt",
    "",
    "- Mode: foundation shadow; no post-merge work is skipped",
    "- Receipt: created with a companion SHA-256 checksum",
    "- Scope: immutable tree, policy, toolchain, gates, checks, and artifacts",
  ]);
  console.log(
    `[ci-evidence-receipt] created shadow receipt for tree ${receipt.source.treeSha} `
    + `with ${receipt.gates.length} gates`,
  );
}

async function locate() {
  const repository = process.env.GITHUB_REPOSITORY;
  const treeSha = git("rev-parse", "HEAD^{tree}");
  const artifactName = `${CI_EVIDENCE_ARTIFACT_PREFIX}-${treeSha}`;
  try {
    const query = new URLSearchParams({ name: artifactName, per_page: "100" });
    const payload = await githubJson(`/repos/${repository}/actions/artifacts?${query}`);
    const artifacts = payload.artifacts ?? [];
    const runIds = [...new Set(artifacts.map((artifact) => artifact.workflow_run?.id).filter(Boolean))];
    const runs = await Promise.all(runIds.map(async (runId) => [
      runId,
      await githubJson(`/repos/${repository}/actions/runs/${runId}`),
    ]));
    const verdict = evidenceArtifactDiscoveryVerdict({
      artifacts,
      runsById: new Map(runs),
      artifactName,
    });
    appendOutput({
      found: verdict.decision === "found" ? "true" : "false",
      artifact_name: artifactName,
      source_run_id: verdict.sourceRunId ?? "",
      reason: verdict.reason,
      tree_sha: treeSha,
    });
    console.log(`[ci-evidence-receipt] shadow discovery: ${verdict.reason}`);
  } catch (error) {
    const reason = "discovery unavailable; exhaustive evidence remains required";
    appendOutput({
      found: "false",
      artifact_name: artifactName,
      source_run_id: "",
      reason,
      tree_sha: treeSha,
    });
    console.warn(`[ci-evidence-receipt] ${reason}: ${error.message}`);
  }
}

async function validate(options) {
  const repository = process.env.GITHUB_REPOSITORY;
  const sourceRunId = options["source-run-id"];
  const inputDir = resolve(ROOT, options["input-dir"] ?? "artifacts/ci-evidence");
  try {
    if (!sourceRunId) throw new Error("validate requires --source-run-id");
    const sourceRun = await githubJson(`/repos/${repository}/actions/runs/${sourceRunId}`);
    if (
      sourceRun.event !== "merge_group"
      || sourceRun.status !== "completed"
      || sourceRun.conclusion !== "success"
    ) {
      throw new Error("source run is not a completed successful merge_group");
    }
    const receipt = JSON.parse(readFileSync(join(inputDir, "ci-evidence.json"), "utf8"));
    const checksum = readFileSync(join(inputDir, "ci-evidence.sha256"), "utf8").trim();
    const identity = collectIdentity();
    const checks = await githubJson(
      `/repos/${repository}/commits/${sourceRun.head_sha}/check-runs?filter=latest&per_page=100`,
    );
    const result = validateEvidenceReceipt({
      receipt,
      expected: {
        repository,
        sourceCommitSha: sourceRun.head_sha,
        treeSha: git("rev-parse", "HEAD^{tree}"),
        sourceRunId,
        workflowPath: identity.workflowPath,
        workflowFingerprint: identity.workflowFingerprint,
        plannerImplementationFingerprint: identity.plannerImplementationFingerprint,
        mergePolicyManifestFingerprint: identity.mergePolicyManifestFingerprint,
        mergePolicyRequiredContexts: identity.mergePolicyRequiredContexts,
        toolchain: identity.toolchain,
        gateIds: expectedGateIds(),
        artifacts: normalizeArtifactInventory(await runArtifacts(sourceRunId)),
        sourceChecks: checks.check_runs ?? [],
      },
      checksum,
    });
    const reason = result.ok
      ? "validated exact-tree receipt"
      : "receipt rejected one or more exact-tree invariants";
    appendOutput({
      reusable: result.ok ? "true" : "false",
      reason,
    });
    appendSummary([
      "### Exact-tree evidence shadow verdict",
      "",
      `- Would reuse: **${result.ok ? "yes" : "no"}**`,
      `- Reason: ${reason}`,
      "- Enforcement: disabled; this push still runs exhaustive evidence",
    ]);
    if (!result.ok) {
      console.warn(
        `[ci-evidence-receipt] shadow validation rejected evidence: ${result.reasons.join("; ")}`,
      );
    } else {
      console.log("[ci-evidence-receipt] shadow validation accepted exact-tree evidence");
    }
  } catch (error) {
    const reason = "validation unavailable; exhaustive evidence remains required";
    appendOutput({ reusable: "false", reason });
    appendSummary([
      "### Exact-tree evidence shadow verdict",
      "",
      "- Would reuse: **no**",
      `- Reason: ${reason}`,
      "- Enforcement: disabled; this push still runs exhaustive evidence",
    ]);
    console.warn(`[ci-evidence-receipt] ${reason}: ${error.message}`);
  }
}

export async function runEvidenceReceiptCli(argv = process.argv.slice(2)) {
  const { mode, options } = parseArgs(argv);
  if (mode === "create") return create(options);
  if (mode === "locate") return locate();
  if (mode === "validate") return validate(options);
  throw new Error(`unknown mode: ${mode ?? "(missing)"}`);
}

const thisFile = resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  runEvidenceReceiptCli().catch((error) => {
    console.error(`[ci-evidence-receipt] fatal: ${error.message}`);
    process.exitCode = 1;
  });
}
