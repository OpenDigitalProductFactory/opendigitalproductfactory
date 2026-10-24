import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { mcpCall } from "./mcp-client.mjs";
import { readGitDiffDigest } from "./semantic-review-gate.mjs";
import {
  createLocalCiPassEvidenceValidity,
  writeLocalCiGateState,
} from "./local-ci-gate-state.mjs";
import {
  collectToolchainFingerprint,
  defaultBuildStrategy,
  resolveLocalCiTestProfile,
} from "./local-integration-ci.mjs";

const WORKSPACE_REQUIRED_DOCS = new Set([
  "docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md",
  "docs/architecture/four-portfolio-archetype-standard-profile-catalog.md",
]);

function isDocumentationSource(path) {
  return path.startsWith("docs/") || /(^|\/)README\.md$|\.mdx?$/.test(path);
}

export function couldBeDocumentationFiles(changedFiles) {
  const hasDocumentationSource = changedFiles.some(isDocumentationSource);
  return changedFiles.length > 0
    && !changedFiles.some((path) => WORKSPACE_REQUIRED_DOCS.has(path))
    && changedFiles.every((path) => (
      isDocumentationSource(path)
      || (hasDocumentationSource && path === "apps/web/lib/docs/doc-index.generated.json")
    ));
}

export function repositorySlugFromRemote(remote) {
  const value = String(remote || "").trim();
  const match = value.match(/(?:github\.com[/:])([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : "";
}

export function createPreAdmissionGateIdentity({
  repository,
  plan,
  toolchainFingerprint,
}) {
  return {
    repository,
    integrationTreeSha: plan.headTreeSha,
    evidencePlanDigest: plan.digest,
    toolchainFingerprint,
    gateKind: "local-integration-ci",
  };
}

function gitOutput(gitBin, args, cwd) {
  const result = spawnSync(gitBin, args, { cwd, encoding: "utf8", shell: false });
  return result.status === 0 ? result.stdout.trim() : "";
}

function exactCandidateIsEligible({ gitBin, worktreePath, sha }) {
  if (gitOutput(gitBin, ["rev-parse", "HEAD"], worktreePath) !== sha) return false;
  if (gitOutput(gitBin, ["status", "--porcelain", "--untracked-files=normal"], worktreePath)) {
    return false;
  }
  return Boolean(gitOutput(gitBin, ["rev-parse", "--verify", "origin/main"], worktreePath));
}

function readCandidateFiles(gitBin, worktreePath, sha) {
  const result = spawnSync(
    gitBin,
    ["diff", "--name-only", "origin/main", sha],
    { cwd: worktreePath, encoding: "utf8", shell: false },
  );
  return result.status === 0
    ? result.stdout.split(/\r?\n/).filter(Boolean)
    : null;
}

const TREE_SHA = /^[0-9a-f]{40}$/i;

/**
 * BI-45553400 / BI-1F11D17A. `git merge-tree --write-tree` exits non-zero for
 * a conflict and also for a missing object. Only the conflict text is a
 * merge conflict. Anything else is "we could not build an integration tree",
 * which a resumed gate still reports as source drift.
 */
export function classifyMergeTreeResult({ status, stdout = "", stderr = "" } = {}) {
  const tree = String(stdout || "").trim().split(/\s+/)[0] || "";
  if (status === 0 && TREE_SHA.test(tree)) return { kind: "clean", tree };
  const text = `${stdout || ""}\n${stderr || ""}`;
  if (status !== 0 && status !== null && status !== undefined && /conflict/i.test(text)) {
    const paths = [];
    for (const match of text.matchAll(/Merge conflict in (\S+)/g)) paths.push(match[1]);
    return { kind: "conflict", paths };
  }
  return { kind: "unavailable" };
}

export function resolveIntegrationTree({
  sha,
  ancestorStatus,
  mergeStatus,
  mergeStdout = "",
  mergeStderr = "",
}) {
  if (ancestorStatus === 0) return { kind: "ancestor", ref: sha };
  const classified = classifyMergeTreeResult({
    status: mergeStatus,
    stdout: mergeStdout,
    stderr: mergeStderr,
  });
  if (classified.kind === "clean") return { kind: "merged", ref: classified.tree };
  if (classified.kind === "conflict") return { kind: "conflict", paths: classified.paths };
  return { kind: "unavailable" };
}

/**
 * What the gate should do with a pre-admission result. A merge conflict stops
 * as status conflict for every invocation. A resumed gate that lost its
 * identity for any other reason still stops as source drift.
 */
export function preAdmissionDisposition(documentationResult, { resumed = false } = {}) {
  if (documentationResult?.mergeConflict) {
    return {
      action: "conflict",
      exitCode: 10,
      mergeConflict: documentationResult.mergeConflict,
    };
  }
  if (resumed && !documentationResult?.gateIdentity) {
    return { action: "source-drift", reasons: ["gate-identity-unavailable"] };
  }
  return { action: "continue", gateIdentity: documentationResult?.gateIdentity ?? null };
}

function integrationTreeRef(gitBin, worktreePath, sha) {
  const currentBase = spawnSync(
    gitBin,
    ["merge-base", "--is-ancestor", "origin/main", sha],
    { cwd: worktreePath, shell: false },
  );
  const merge = currentBase.status === 0
    ? null
    : spawnSync(
      gitBin,
      ["merge-tree", "--write-tree", "origin/main", sha],
      { cwd: worktreePath, encoding: "utf8", shell: false },
    );
  return resolveIntegrationTree({
    sha,
    ancestorStatus: currentBase.status,
    mergeStatus: merge?.status,
    mergeStdout: merge?.stdout ?? "",
    mergeStderr: merge?.stderr ?? "",
  });
}

function runDocumentationCommands(worktreePath, env) {
  const commands = [
    ["scripts/gen-doc-index.mjs", "--check"],
    ["scripts/check-doc-links.mjs"],
    ["scripts/check-guards.mjs"],
  ];
  const outputs = [];
  for (const [script, ...args] of commands) {
    const result = spawnSync(process.execPath, [resolve(worktreePath, script), ...args], {
      cwd: worktreePath,
      encoding: "utf8",
      shell: false,
      env,
      maxBuffer: 32 * 1024 * 1024,
    });
    outputs.push(result.stdout || "", result.stderr || "");
    if (result.status !== 0) {
      return {
        commands,
        exitCode: result.status ?? 1,
        failedCommand: ["node", script, ...args].join(" "),
        output: outputs.join("\n").slice(-12_000),
      };
    }
  }
  return {
    commands,
    exitCode: 0,
    failedCommand: null,
    output: outputs.join("\n").slice(-12_000),
  };
}

export async function runPreAdmissionDocumentationLane({
  branch,
  sha,
  worktreePath,
  gitBin,
  ownerProvider,
  ownerSessionId,
  mcpUrl,
  bearerToken,
  stateFile,
  planFile,
  plannerPath,
  env = process.env,
}) {
  resolveLocalCiTestProfile(env);
  if (!exactCandidateIsEligible({ gitBin, worktreePath, sha })) return { handled: false };
  const integration = integrationTreeRef(gitBin, worktreePath, sha);
  if (integration.kind === "conflict") {
    return {
      handled: false,
      mergeConflict: { baseRef: "origin/main", paths: integration.paths ?? [] },
    };
  }
  if (integration.kind !== "ancestor" && integration.kind !== "merged") return { handled: false };
  const integrationRef = integration.ref;
  const changedFiles = readCandidateFiles(gitBin, worktreePath, integrationRef);
  if (!changedFiles) return { handled: false };

  rmSync(planFile, { force: true });
  const planner = spawnSync(process.execPath, [
    plannerPath,
    "--event", "local-ci",
    "--base", "origin/main",
    "--head", integrationRef,
    "--output", planFile,
  ], { cwd: worktreePath, encoding: "utf8", shell: false, env });
  if (planner.status !== 0 || !existsSync(planFile)) return { handled: false };

  let plan;
  try {
    plan = JSON.parse(readFileSync(planFile, "utf8"));
  } catch {
    return { handled: false };
  }
  const repository = repositorySlugFromRemote(
    gitOutput(gitBin, ["remote", "get-url", "origin"], worktreePath),
  );
  const toolchain = collectToolchainFingerprint({
    buildStrategy: defaultBuildStrategy(process.platform, env),
    cwd: worktreePath,
    env,
  });
  const gateIdentity = repository
    ? createPreAdmissionGateIdentity({
      repository,
      plan,
      toolchainFingerprint: toolchain.toolchainFingerprint,
    })
    : null;
  if (!couldBeDocumentationFiles(changedFiles)) {
    return { handled: false, plan, gateIdentity };
  }
  if (plan.executionLane !== "documentation" || plan.fullSuite !== false) {
    return { handled: false, plan, gateIdentity };
  }
  if (gitOutput(gitBin, ["rev-parse", `${integrationRef}^{tree}`], worktreePath) !== plan.headTreeSha) {
    return { handled: false, plan, gateIdentity };
  }

  const producerEvidence = {
    schemaVersion: 1,
    producer: "documentation-evidence-lane",
    candidateSha: sha,
    candidateBranch: branch,
    headTreeSha: gitOutput(gitBin, ["rev-parse", `${sha}^{tree}`], worktreePath),
    integrationTreeSha: plan.headTreeSha,
    evidencePlanDigest: plan.digest,
  };
  const writeState = (result) => writeLocalCiGateState(stateFile, {
    branch, sha, leaseId: "", resilience: null, executionLane: "documentation",
    leaseEvents: [{ type: "documentation-lane", at: new Date().toISOString() }],
    ...result,
    producerEvidence: { ...producerEvidence, evidenceRecordId: result.evidenceId || "" },
  });
  // A crash or publication outage must leave an unfinished attempt, never a
  // newly successful local projection. Completed server evidence is retained.
  writeState({ gatePassed: false, evidenceId: "", status: "running", expiresAt: "" });
  const execution = runDocumentationCommands(worktreePath, env);
  const failureSummary = { failedCommand: execution.failedCommand, output: execution.output };
  if (!exactCandidateIsEligible({ gitBin, worktreePath, sha })) {
    writeState({ gatePassed: false, evidenceId: "", status: "blocked_source_changed", expiresAt: "", failureReason: "Documentation source changed during verification.", failureSummary });
    return { handled: true, status: 1, plan, gateIdentity, evidenceId: "" };
  }
  const passed = execution.exitCode === 0;
  const issuedAt = new Date().toISOString();
  const evidenceValidity = passed
    ? createLocalCiPassEvidenceValidity({ issuedAt })
    : null;
  const evidenceArgs = {
    provider: ownerProvider,
    externalSessionId: ownerSessionId,
    routeContext: "/build",
    candidateBranch: branch,
    mode: "single-branch",
    status: passed ? "passed" : "failed",
    summary: passed
      ? "Exact-tree documentation evidence passed without heavyweight admission."
      : `Documentation evidence failed at ${execution.failedCommand}.`,
    evidence: {
      bi: "BI-B2E9FC9D",
      phase: "pre-admission-documentation",
      executionLane: plan.executionLane,
      evidencePlan: {
        digest: plan.digest,
        plannerVersion: plan.plannerVersion,
        policyVersion: plan.policyVersion,
        headTreeSha: plan.headTreeSha,
        globalGuards: plan.globalGuards,
      },
      branch,
      sha,
      integrationTreeSha: plan.headTreeSha,
      headTreeHash: gitOutput(gitBin, ["rev-parse", `${sha}^{tree}`], worktreePath),
      diffDigest: readGitDiffDigest(gitOutput(gitBin, ["merge-base", sha, "origin/main"], worktreePath), spawnSync, worktreePath),
      completedAt: issuedAt,
      gatePassed: passed,
      evidenceValidity,
      leaseId: null,
      commands: execution.commands.map(([script, ...args]) => (
        ["node", script, ...args].join(" ")
      )),
      failedCommand: execution.failedCommand,
      output: execution.output,
    },
  };
  writeState({ gatePassed: false, evidenceId: "", status: passed ? "running" : "failed", expiresAt: evidenceValidity?.expiresAt || issuedAt, evidencePending: true, evidencePendingReason: "documentation-publication", failureReason: execution.failedCommand || "", failureSummary });
  const evidenceResponse = await mcpCall(
    "record_local_integration_result",
    evidenceArgs,
    { mcpUrl, bearerToken },
  );
  if (evidenceResponse?.success !== true || typeof evidenceResponse.entityId !== "string" || !evidenceResponse.entityId.trim()) {
    throw new Error(`failed to record documentation evidence: ${JSON.stringify(evidenceResponse)}`);
  }

  const evidenceId = evidenceResponse.entityId || "";
  const sourceUnchanged = exactCandidateIsEligible({ gitBin, worktreePath, sha });
  writeState({
    gatePassed: passed && sourceUnchanged,
    evidenceId,
    status: sourceUnchanged ? (passed ? "passed" : "failed") : "blocked_source_changed",
    expiresAt: evidenceValidity?.expiresAt || issuedAt,
    evidenceValidity,
    evidencePending: false,
    failureSummary,
    failureReason: sourceUnchanged ? execution.failedCommand || "" : "Documentation source changed during evidence publication.",
  });
  return {
    handled: true,
    status: !sourceUnchanged ? 1 : passed ? 0 : execution.exitCode,
    plan,
    gateIdentity,
    evidenceId,
  };
}
