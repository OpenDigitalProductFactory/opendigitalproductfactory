import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  PROMOTER_DOCKERFILE,
  stageMinimalPromoterBuildContext,
} from "./promoter-build-context";

export const SELF_UPGRADE_CALLER_PROTOCOL_VERSION = 1;
export const PROMOTER_CONTRACT_SCHEMA_VERSION = 1;

export type ResolvedPromoterArtifact = Readonly<{
  digest: `sha256:${string}`;
  sourceSha: string;
  contractSchema: 1;
  contractDigest: `sha256:${string}`;
  callerProtocol: Readonly<{ min: number; max: number }>;
}>;

export type PromoterArtifactValidationInput = {
  targetSha: string;
  callerProtocol: number;
  digest: string;
  manifest: string;
  labels: Record<string, string | undefined>;
  computedContractDigest: string;
};

export type ArtifactDockerResult = { exitCode: number; stdout: string; stderr: string };
export type ArtifactDockerRunner = (args: string[]) => Promise<ArtifactDockerResult>;

const DEFAULT_PROMOTER_IMAGE = "dpf-promoter";

function isLocalPromoterReference(image: string): boolean {
  return image === DEFAULT_PROMOTER_IMAGE || /^dpf-promoter:[A-Za-z0-9._-]+$/.test(image);
}

function requireDockerSuccess(result: ArtifactDockerResult, operation: string): string {
  if (result.exitCode !== 0) {
    throw new Error(`${operation}_failed: ${(result.stderr || result.stdout).trim().slice(-500)}`);
  }
  return result.stdout;
}

export async function buildCandidatePromoterArtifactImage(
  params: { sourcePath: string; targetSha: string; promoterImage?: string },
  runDocker: ArtifactDockerRunner,
): Promise<string> {
  if ((params.promoterImage?.trim() || DEFAULT_PROMOTER_IMAGE) !== DEFAULT_PROMOTER_IMAGE) {
    return params.promoterImage!.trim();
  }
  const manifest = await readFile(join(params.sourcePath, "promoter-contract.json"));
  const contractDigest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
  const targetImage = `${DEFAULT_PROMOTER_IMAGE}:${params.targetSha}`;
  // Stage ONLY the promoter build inputs into a throwaway minimal context so
  // `docker build` never enumerates the whole upgrade workspace (apps/packages/
  // docs) — the `readdirent … cannot allocate memory` OOM that bricked
  // SUR-BF75ED2A on a lean host (PR #4199). The staged file list is the shared
  // PROMOTER_BUILD_CONTEXT_* source-of-truth, so it can't drift from
  // Dockerfile.promoter's COPY list. This mirrors the JIT rebuild's tar-context
  // (PROMOTER_JIT_BUILD_SCRIPT); it just sources from the target-sha checkout
  // instead of the portal's baked-in /promoter/ layout.
  const contextDir = await stageMinimalPromoterBuildContext(params.sourcePath);
  try {
    requireDockerSuccess(await runDocker([
      "buildx", "build", "--load",
      "-f", join(contextDir, PROMOTER_DOCKERFILE), "-t", targetImage,
      "--build-arg", `DPF_PROMOTER_SOURCE_SHA=${params.targetSha}`,
      "--build-arg", `DPF_PROMOTER_CONTRACT_DIGEST=${contractDigest}`,
      contextDir,
    ]), "promoter_candidate_build");
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
  return targetImage;
}

export async function resolveCandidatePromoterArtifact(
  params: { promoterImage?: string; targetSha: string; callerProtocol?: number },
  runDocker: ArtifactDockerRunner,
): Promise<ResolvedPromoterArtifact> {
  const configured = params.promoterImage?.trim() || DEFAULT_PROMOTER_IMAGE;
  const reference = configured.includes("@sha256:") || configured.startsWith("sha256:")
    ? configured
    : `${configured.replace(/:[^/:]+$/, "")}:${params.targetSha}`;
  if (!isLocalPromoterReference(configured)) {
    requireDockerSuccess(await runDocker(["pull", reference]), "promoter_pull");
  }
  const inspectText = requireDockerSuccess(
    await runDocker(["image", "inspect", reference, "--format", "{{json .}}"]),
    "promoter_inspect",
  ).trim();
  let inspect: { Id?: string; RepoDigests?: string[]; Config?: { Labels?: Record<string, string> } };
  try { inspect = JSON.parse(inspectText); } catch { throw new Error("promoter_inspect_invalid_json"); }
  const digest = inspect.RepoDigests?.map((value) => value.split("@")[1]).find(Boolean) ?? inspect.Id;
  if (!digest) throw new Error("promoter_digest_missing");
  const manifest = requireDockerSuccess(
    await runDocker(["run", "--rm", "--entrypoint", "cat", digest, "/app/promoter-contract.json"]),
    "promoter_contract_read",
  );
  return validateResolvedPromoterArtifact({
    targetSha: params.targetSha,
    callerProtocol: params.callerProtocol ?? SELF_UPGRADE_CALLER_PROTOCOL_VERSION,
    digest,
    manifest,
    labels: inspect.Config?.Labels ?? {},
    computedContractDigest: `sha256:${createHash("sha256").update(manifest).digest("hex")}`,
  });
}

export function validateResolvedPromoterArtifact(
  input: PromoterArtifactValidationInput,
): ResolvedPromoterArtifact {
  if (!/^sha256:[a-f0-9]{64}$/.test(input.digest)) throw new Error("promoter_artifact_not_immutable");
  let manifest: unknown;
  try { manifest = JSON.parse(input.manifest); } catch { throw new Error("promoter_contract_invalid_json"); }
  if (!manifest || typeof manifest !== "object") throw new Error("promoter_contract_missing");
  const contract = manifest as Record<string, unknown>;
  if (contract.schemaVersion !== PROMOTER_CONTRACT_SCHEMA_VERSION) throw new Error("promoter_contract_schema_unsupported");
  const range = contract.callerProtocol as { min?: unknown; max?: unknown } | undefined;
  if (!range || typeof range.min !== "number" || typeof range.max !== "number" || range.min > range.max) {
    throw new Error("promoter_contract_protocol_invalid");
  }
  if (input.callerProtocol < range.min || input.callerProtocol > range.max) throw new Error("promoter_caller_protocol_unsupported");
  const sourceSha = input.labels["org.opencontainers.image.revision"];
  if (!sourceSha || sourceSha !== input.targetSha) throw new Error("promoter_source_sha_mismatch");
  if (input.labels["org.opendpf.promoter.contract-schema"] !== String(contract.schemaVersion)) {
    throw new Error("promoter_contract_schema_label_mismatch");
  }
  const contractDigest = input.labels["org.opendpf.promoter.contract-digest"];
  if (!contractDigest || contractDigest !== input.computedContractDigest || !/^sha256:[a-f0-9]{64}$/.test(contractDigest)) {
    throw new Error("promoter_contract_digest_mismatch");
  }
  return Object.freeze({
    digest: input.digest as `sha256:${string}`,
    sourceSha,
    contractSchema: PROMOTER_CONTRACT_SCHEMA_VERSION,
    contractDigest: contractDigest as `sha256:${string}`,
    callerProtocol: Object.freeze({ min: range.min, max: range.max }),
  });
}
