import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { mcpCall } from "./mcp-client.mjs";
import {
  createLocalCiPassEvidenceValidity,
  writeLocalCiGateState,
} from "./local-ci-gate-state.mjs";

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

function gitOutput(gitBin, args, cwd) {
  const result = spawnSync(gitBin, args, { cwd, encoding: "utf8", shell: false });
  return result.status === 0 ? result.stdout.trim() : "";
}

function exactCandidateIsEligible({ gitBin, worktreePath, sha }) {
  if (gitOutput(gitBin, ["rev-parse", "HEAD"], worktreePath) !== sha) return false;
  if (gitOutput(gitBin, ["status", "--porcelain", "--untracked-files=normal"], worktreePath)) {
    return false;
  }
  return spawnSync(
    gitBin,
    ["merge-base", "--is-ancestor", "origin/main", sha],
    { cwd: worktreePath, shell: false },
  ).status === 0;
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
  if (!exactCandidateIsEligible({ gitBin, worktreePath, sha })) return { handled: false };
  const changedFiles = readCandidateFiles(gitBin, worktreePath, sha);
  if (!changedFiles || !couldBeDocumentationFiles(changedFiles)) return { handled: false };

  rmSync(planFile, { force: true });
  const planner = spawnSync(process.execPath, [
    plannerPath,
    "--event", "local-ci",
    "--base", "origin/main",
    "--head", sha,
    "--output", planFile,
  ], { cwd: worktreePath, encoding: "utf8", shell: false, env });
  if (planner.status !== 0 || !existsSync(planFile)) return { handled: false };

  let plan;
  try {
    plan = JSON.parse(readFileSync(planFile, "utf8"));
  } catch {
    return { handled: false };
  }
  if (plan.executionLane !== "documentation" || plan.fullSuite !== false) {
    return { handled: false, plan };
  }
  if (gitOutput(gitBin, ["rev-parse", `${sha}^{tree}`], worktreePath) !== plan.headTreeSha) {
    return { handled: false, plan };
  }

  const execution = runDocumentationCommands(worktreePath, env);
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
      gatePassed: passed,
      leaseId: null,
      commands: execution.commands.map(([script, ...args]) => (
        ["node", script, ...args].join(" ")
      )),
      failedCommand: execution.failedCommand,
      output: execution.output,
    },
  };
  const evidenceResponse = await mcpCall(
    "record_local_integration_result",
    evidenceArgs,
    { mcpUrl, bearerToken },
  );
  if (evidenceResponse?.success !== true) {
    throw new Error(`failed to record documentation evidence: ${JSON.stringify(evidenceResponse)}`);
  }

  const evidenceId = evidenceResponse.entityId || "";
  writeLocalCiGateState(stateFile, {
    branch,
    sha,
    gatePassed: passed,
    leaseId: "",
    evidenceId,
    status: passed ? "passed" : "failed",
    expiresAt: evidenceValidity?.expiresAt || issuedAt,
    evidenceValidity,
    resilience: null,
    leaseEvents: [{ type: "documentation-lane", at: issuedAt }],
    evidencePending: false,
  });
  return {
    handled: true,
    status: passed ? 0 : execution.exitCode,
    plan,
    evidenceId,
  };
}
