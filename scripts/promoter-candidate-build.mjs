#!/usr/bin/env node
// Candidate promoter build (BI-224F56F1, kernel decision DI-B3171A8F09DC).
//
// In the qualified portal neither the portal nor the private actuator can read
// the upgrade source, so a source-mode upgrade's candidate promoter image is
// built here: inside a short-lived container from the installed promoter image,
// which the actuator launches as the admitted "candidate" stage of a running
// self-upgrade run. The workspace is mounted read-only at /workspace, the
// Docker socket is the promoter's own, and the only output is the candidate
// image `dpf-promoter:<targetSha>`.
//
// It stages the minimal promoter build context exactly as the portal used to:
// the target's own PROMOTER_BUILD_CONTEXT_SOURCES plus Dockerfile.promoter,
// copied into a throwaway directory, so docker never walks the workspace.
//
//   node promoter-candidate-build.mjs     (input JSON in DPF_CANDIDATE_INPUT)
//
// The result is one JSON line on stdout. Exit 2 is an invalid request.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { readPromoterBuildContextSources } from "./lib/promoter-build-context-sources.mjs";
import { retryOnTransientNetwork } from "./lib/upgrade-source/transient-network.mjs";

export const CANDIDATE_WORKSPACE = "/workspace";
const PROMOTER_DOCKERFILE = "Dockerfile.promoter";
const PROMOTER_IMAGE = "dpf-promoter";
const SHA = /^[a-f0-9]{40}$/;
const BUILD_TIMEOUT_MS = 30 * 60_000;

const invalid = () => { throw new Error("candidate_request_invalid"); };

export function parseCandidateRequest(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 1024) return invalid();
  let input;
  try { input = JSON.parse(raw); } catch { return invalid(); }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1
    || typeof input.targetSha !== "string" || !SHA.test(input.targetSha)) return invalid();
  return { targetSha: input.targetSha };
}

/** A context entry must stay inside the workspace: relative, no traversal. */
export function safeContextEntry(entry) {
  if (typeof entry !== "string" || entry.length === 0 || entry.startsWith("/") || entry.includes("\0")) return false;
  const normalized = normalize(entry);
  return normalized === entry && !normalized.split("/").includes("..");
}

const defaultDocker = (args, timeoutMs) => new Promise((resolve) => {
  execFile("docker", args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
    resolve({ exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
  });
});

export async function buildCandidate(request, { root = CANDIDATE_WORKSPACE, docker = defaultDocker, retryDelayMs } = {}) {
  const sources = await readPromoterBuildContextSources(root);
  if (!sources.every(safeContextEntry)) return { ok: false, reason: "context-invalid" };
  const manifest = await readFile(join(root, "promoter-contract.json"));
  const contractDigest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
  const image = `${PROMOTER_IMAGE}:${request.targetSha}`;
  const contextDir = await mkdtemp(join(tmpdir(), "dpf-promoter-ctx-"));
  try {
    for (const file of [...sources, PROMOTER_DOCKERFILE]) {
      const dest = join(contextDir, file);
      await mkdir(dirname(dest), { recursive: true });
      await cp(join(root, file), dest);
    }
    const built = await retryOnTransientNetwork(() => docker([
      "buildx", "build", "--load", "-f", join(contextDir, PROMOTER_DOCKERFILE), "-t", image,
      "--build-arg", `DPF_PROMOTER_SOURCE_SHA=${request.targetSha}`,
      "--build-arg", `DPF_PROMOTER_CONTRACT_DIGEST=${contractDigest}`,
      contextDir,
    ], BUILD_TIMEOUT_MS), {
      failed: (result) => result.exitCode !== 0,
      output: (result) => `${result.stderr}\n${result.stdout}`,
      attempts: 3,
      baseDelayMs: retryDelayMs ?? 15_000,
    });
    if (built.exitCode !== 0) return { ok: false, reason: "build-failed", detail: built.stderr.trim().slice(-600) };
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
  const inspected = await docker(["image", "inspect", "--format", "{{.Id}}", image], 30_000);
  const imageId = inspected.stdout.trim();
  if (inspected.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId)) return { ok: false, reason: "build-unverified" };
  return { ok: true, image, imageId };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let request;
  try {
    request = parseCandidateRequest(process.env.DPF_CANDIDATE_INPUT ?? "");
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: "invalid-request" })}\n`);
    process.exit(2);
  }
  let result;
  try { result = await buildCandidate(request); } catch { result = { ok: false, reason: "build-error" }; }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
