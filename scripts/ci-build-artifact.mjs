#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildArtifactDiscoveryVerdict,
  createBuildArtifactReceipt,
  sha256Bytes,
  sha256File,
  validateArchiveEntries,
  validateBuildArtifactReceipt,
} from "./lib/ci-build-artifact.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARTIFACT_PREFIX = "web-production-build";

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

function collectToolchain() {
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const nextVersion = execFileSync(
    pnpm,
    ["--filter", "web", "exec", "node", "-p", "require('next/package.json').version"],
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  return {
    arch: process.arch,
    lockfileSha256: sha256File(join(ROOT, "pnpm-lock.yaml")),
    next: nextVersion,
    node: process.version,
    os: process.platform,
    packageManager: rootPackage.packageManager,
  };
}

function collectBuildEnvironmentFingerprint() {
  const buildInputs = Object.fromEntries(
    ["ADMIN_PASSWORD", "DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL"]
      .map((key) => [key, process.env[key] ?? null]),
  );
  return sha256Bytes(JSON.stringify(buildInputs));
}

function runTar(args) {
  // A production .next tree currently contains more than 80k entries and its
  // inventory is about 5.5 MB. Node's 1 MiB spawnSync default truncates that
  // valid listing with ENOBUFS, so keep a bounded but realistic ceiling.
  const result = spawnSync("tar", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`tar failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`tar failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function appendOutput(values) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value).replaceAll("\n", " ")}`);
  writeFileSync(output, `${lines.join("\n")}\n`, { flag: "a" });
}

function appendSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { flag: "a" });
}

function createArtifact(options) {
  const outputDir = resolve(ROOT, options["output-dir"] ?? "artifacts/web-production-build");
  mkdirSync(outputDir, { recursive: true });
  const payloadPath = join(outputDir, "web-production-build.tar.gz");
  const receiptPath = join(outputDir, "ci-build-receipt.json");
  // `next start` reads this from the repository root, while the reused
  // standalone server runs with `.next/standalone` as its working directory.
  // The production Docker image also copies the same file to its runtime root.
  // Keep the reused runtime equivalent and make the inventory validator reject
  // any payload that omits the platform-version source of truth.
  cpSync(join(ROOT, "version.json"), join(ROOT, "apps/web/.next/standalone/version.json"));
  runTar([
    "-czf",
    payloadPath,
    "-C",
    join(ROOT, "apps/web"),
    ".next/standalone",
    ".next/static",
  ]);
  const now = Date.now();
  const receipt = createBuildArtifactReceipt({
    repository: process.env.GITHUB_REPOSITORY,
    commitSha: process.env.GITHUB_SHA || git("rev-parse", "HEAD"),
    treeSha: git("rev-parse", "HEAD^{tree}"),
    eventName: process.env.GITHUB_EVENT_NAME,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    plannerDigest: process.env.DPF_CI_PLANNER_DIGEST,
    toolchain: collectToolchain(),
    environmentFingerprint: collectBuildEnvironmentFingerprint(),
    payloadSha256: sha256File(payloadPath),
    payloadSizeBytes: statSync(payloadPath).size,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
  });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  appendSummary([
    "### Production-build artifact",
    "",
    `- Tree: \`${receipt.source.treeSha}\``,
    `- Payload: ${receipt.artifact.sizeBytes} bytes`,
    `- SHA-256: \`${receipt.artifact.sha256}\``,
    `- Expires: ${receipt.expiresAt}`,
  ]);
  console.log(`[ci-build-artifact] created ${payloadPath} (${receipt.artifact.sizeBytes} bytes)`);
}

async function githubJson(path) {
  // Overridable so the discovery loop's termination behaviour is testable
  // against a local stub; unset in CI, where the real API is used.
  const base = process.env.DPF_GITHUB_API_BASE_URL || "https://api.github.com";
  const response = await fetch(`${base}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "dpf-ci-build-artifact",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function locateArtifact(options) {
  const waitSeconds = Number(options["wait-seconds"] ?? 240);
  const workflow = encodeURIComponent(options.workflow ?? "ci.yml");
  const artifactPrefix = options["artifact-prefix"] ?? DEFAULT_ARTIFACT_PREFIX;
  const repository = process.env.GITHUB_REPOSITORY;
  // pull_request runs are indexed by the PR head SHA in the Actions API even
  // though GITHUB_SHA (and the checked-out tree) is the synthetic merge SHA.
  // The workflow supplies that API lookup identity explicitly; the receipt
  // still binds the built checkout's real commit and immutable tree below.
  const headSha = process.env.DPF_CI_RUN_HEAD_SHA || process.env.GITHUB_SHA;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const discoveryStartedAt = Date.now();
  const deadline = discoveryStartedAt + waitSeconds * 1000;
  try {
    while (Date.now() <= deadline) {
      const query = new URLSearchParams({
        head_sha: headSha,
        event: eventName,
        per_page: "20",
      });
      const payload = await githubJson(`/repos/${repository}/actions/workflows/${workflow}/runs?${query}`);
      const exactRuns = (payload.workflow_runs ?? []).filter((run) =>
        run.head_sha === headSha && run.event === eventName);
      const artifactsByRun = new Map();
      for (const run of exactRuns) {
        const artifacts = await githubJson(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);
        artifactsByRun.set(run.id, artifacts.artifacts ?? []);
      }
      const verdict = buildArtifactDiscoveryVerdict({
        runs: exactRuns,
        artifactsByRun,
        headSha,
        eventName,
        artifactPrefix,
      });
      if (verdict.decision === "found") {
        const { selected } = verdict;
        appendOutput({
          found: "true",
          artifact_name: selected.artifactName,
          source_run_id: selected.runId,
          source_run_attempt: selected.runAttempt,
          discovery_ms: Date.now() - discoveryStartedAt,
        });
        console.log(
          `[ci-build-artifact] ${verdict.reason} after ${Date.now() - discoveryStartedAt}ms`,
        );
        return;
      }
      // BI-149370BD: no later poll can produce evidence a terminal producer
      // never published, so stop here instead of burning the rest of the
      // deadline ahead of the same fallback build.
      if (verdict.decision === "abandon") {
        appendOutput({ found: "false", discovery_ms: Date.now() - discoveryStartedAt });
        console.warn(
          `[ci-build-artifact] ${verdict.reason} after ${Date.now() - discoveryStartedAt}ms; rebuilding`,
        );
        return;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
    }
    console.warn(`[ci-build-artifact] no exact-tree artifact appeared within ${waitSeconds}s; rebuilding`);
  } catch (error) {
    console.warn(`[ci-build-artifact] discovery unavailable (${error.message}); rebuilding`);
  }
  appendOutput({ found: "false", discovery_ms: Date.now() - discoveryStartedAt });
}

async function awaitCurrentRunArtifact(options) {
  const waitSeconds = Number(options["wait-seconds"] ?? 240);
  const terminalGraceMs = Number(options["terminal-grace-seconds"] ?? 5) * 1000;
  const artifactName = options["artifact-name"];
  const producerJobName = options["producer-job-name"] ?? "Production Build";
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!artifactName) throw new Error("await-current-run requires --artifact-name");
  if (!repository || !runId) {
    throw new Error("await-current-run requires GITHUB_REPOSITORY and GITHUB_RUN_ID");
  }
  const discoveryStartedAt = Date.now();
  const deadline = discoveryStartedAt + waitSeconds * 1000;
  let producerTerminalAt;
  try {
    while (Date.now() <= deadline) {
      const artifacts = await githubJson(
        `/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
      );
      const artifact = (artifacts.artifacts ?? []).find(
        (candidate) => candidate.name === artifactName && candidate.expired !== true,
      );
      if (artifact) {
        appendOutput({
          found: "true",
          artifact_name: artifact.name,
          source_run_id: runId,
          discovery_ms: Date.now() - discoveryStartedAt,
        });
        console.log(
          `[ci-build-artifact] current-run artifact ${artifact.name} available after `
          + `${Date.now() - discoveryStartedAt}ms`,
        );
        return;
      }

      const jobs = await githubJson(
        `/repos/${repository}/actions/runs/${runId}/jobs?filter=all&per_page=100`,
      );
      const producer = (jobs.jobs ?? []).find((job) => job.name === producerJobName);
      if (producer?.status === "completed") {
        producerTerminalAt ??= Date.now();
        // Artifact indexing can trail the upload step very briefly. Preserve a
        // small grace period, then rebuild instead of waiting out the full
        // deadline when the same-run producer is terminal without evidence.
        if (Date.now() - producerTerminalAt >= terminalGraceMs) {
          appendOutput({ found: "false", discovery_ms: Date.now() - discoveryStartedAt });
          console.warn(
            `[ci-build-artifact] same-run ${producerJobName} completed without ${artifactName}; rebuilding`,
          );
          return;
        }
      } else {
        producerTerminalAt = undefined;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    }
    console.warn(
      `[ci-build-artifact] current-run artifact ${artifactName} did not appear within `
      + `${waitSeconds}s; rebuilding`,
    );
  } catch (error) {
    console.warn(`[ci-build-artifact] current-run rendezvous unavailable (${error.message}); rebuilding`);
  }
  appendOutput({ found: "false", discovery_ms: Date.now() - discoveryStartedAt });
}

function materializeFallback(reason, startedAt) {
  rmSync(join(ROOT, "apps/web/.next"), { recursive: true, force: true });
  appendOutput({ reused: "false", reason });
  appendSummary([
    "### UX production-build input",
    "",
    `- Reuse: no (${reason})`,
    `- Discovery/download/validation: ${Date.now() - startedAt} ms`,
    "- Action: fail-safe local production build",
  ]);
  console.warn(`[ci-build-artifact] ${reason}; rebuilding`);
}

function consumeArtifact(options) {
  const startedAt = Number(process.env.DPF_BUILD_ARTIFACT_TRANSFER_STARTED_MS) || Date.now();
  const inputDir = resolve(ROOT, options["input-dir"] ?? "artifacts/downloaded-web-production-build");
  const payloadPath = join(inputDir, "web-production-build.tar.gz");
  const receiptPath = join(inputDir, "ci-build-receipt.json");
  let tempDir;
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    const payloadSha256 = sha256File(payloadPath);
    const payloadSizeBytes = statSync(payloadPath).size;
    const validation = validateBuildArtifactReceipt(receipt, {
      repository: process.env.GITHUB_REPOSITORY,
      commitSha: process.env.GITHUB_SHA || git("rev-parse", "HEAD"),
      treeSha: git("rev-parse", "HEAD^{tree}"),
      eventName: process.env.GITHUB_EVENT_NAME,
      sourceRunId: options["source-run-id"],
      toolchain: collectToolchain(),
      environmentFingerprint: collectBuildEnvironmentFingerprint(),
      payloadSha256,
      payloadSizeBytes,
    });
    if (!validation.ok) {
      materializeFallback(validation.reasons.join("; "), startedAt);
      return;
    }
    const inventory = validateArchiveEntries(runTar(["-tzf", payloadPath]).split(/\r?\n/));
    if (!inventory.ok) {
      materializeFallback(inventory.reasons.join("; "), startedAt);
      return;
    }
    tempDir = mkdtempSync(join(tmpdir(), "dpf-web-build-"));
    runTar(["-xzf", payloadPath, "-C", tempDir]);
    const standaloneWeb = join(tempDir, ".next/standalone/apps/web");
    statSync(join(standaloneWeb, ".next/BUILD_ID"));
    cpSync(join(ROOT, "apps/web/public"), join(standaloneWeb, "public"), { recursive: true });
    cpSync(join(tempDir, ".next/static"), join(standaloneWeb, ".next/static"), { recursive: true });
    const target = join(ROOT, "apps/web/.next");
    rmSync(target, { recursive: true, force: true });
    renameSync(join(tempDir, ".next"), target);
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    const elapsedMs = Date.now() - startedAt;
    appendOutput({ reused: "true", reason: "exact-tree artifact accepted", transfer_ms: elapsedMs });
    appendSummary([
      "### UX production-build input",
      "",
      "- Reuse: yes",
      `- Source run: ${receipt.workflow.runId} (attempt ${receipt.workflow.runAttempt})`,
      `- Tree: \`${receipt.source.treeSha}\``,
      `- Payload: ${payloadSizeBytes} bytes`,
      `- Download + validation + extraction: ${elapsedMs} ms`,
      `- Avoided command: \`${receipt.build.command}\``,
    ]);
    console.log(`[ci-build-artifact] exact-tree build materialized in ${elapsedMs}ms`);
  } catch (error) {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    materializeFallback(`artifact could not be materialized: ${error.message}`, startedAt);
  }
}

async function main() {
  const { mode, options } = parseArgs(process.argv.slice(2));
  if (mode === "create") createArtifact(options);
  else if (mode === "locate") await locateArtifact(options);
  else if (mode === "await-current-run") await awaitCurrentRunArtifact(options);
  else if (mode === "consume") consumeArtifact(options);
  else {
    throw new Error(
      "usage: ci-build-artifact.mjs <create|locate|await-current-run|consume> [options]",
    );
  }
}

main().catch((error) => {
  console.error(`[ci-build-artifact] ${error.message}`);
  process.exitCode = 1;
});
