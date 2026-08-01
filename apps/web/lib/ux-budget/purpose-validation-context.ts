import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { RatifiedPurposeContract } from "./page-purpose";
import type { PurposeEvaluationContext } from "./purpose-evaluator";

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalise(child)]),
    );
  }
  return value;
}

export function purposeContractHash(contract: RatifiedPurposeContract): string {
  const {
    derived: _derived,
    validationReceipts: _receipts,
    validationTarget: _target,
    ...purposeDefinition
  } = contract;
  return createHash("sha256")
    .update(JSON.stringify(canonicalise(purposeDefinition)))
    .digest("hex");
}

export function purposeArtifactContentHash(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function resolveInsideRepo(
  repoRoot: string,
  artifactPath: string,
): string | null {
  if (isAbsolute(artifactPath)) return null;
  const absolutePath = resolve(repoRoot, artifactPath);
  if (!existsSync(absolutePath)) return null;
  const realRoot = realpathSync(repoRoot);
  const realArtifact = realpathSync(absolutePath);
  const fromRoot = relative(realRoot, realArtifact);
  return fromRoot.length > 0 && !fromRoot.startsWith("..") && !isAbsolute(fromRoot)
    ? realArtifact
    : null;
}

function artifactSetFingerprint(
  artifacts: Array<{
    id: string;
    path: string;
    actualHash: string | null;
  }>,
): string {
  const digest = createHash("sha256");
  for (const artifact of [...artifacts].sort((left, right) =>
    `${left.id}:${left.path}`.localeCompare(`${right.id}:${right.path}`),
  )) {
    digest.update(artifact.id);
    digest.update("\0");
    digest.update(artifact.path);
    digest.update("\0");
    digest.update(artifact.actualHash ?? "missing");
    digest.update("\0");
  }
  return digest.digest("hex");
}

function findRepoRoot(start: string): string {
  let current = resolve(start);
  while (dirname(current) !== current) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    current = dirname(current);
  }
  return resolve(start);
}

export function resolvePurposeEvaluationContext(
  contract: RatifiedPurposeContract,
  repoRoot = findRepoRoot(process.cwd()),
): PurposeEvaluationContext | undefined {
  const target = contract.validationTarget;
  if (!target) return undefined;

  const artifacts = target.artifacts.map((artifact) => {
    const absolutePath = resolveInsideRepo(repoRoot, artifact.path);
    return {
      ...artifact,
      actualHash: absolutePath
        ? purposeArtifactContentHash(absolutePath)
        : null,
    };
  });
  const fingerprintFor = (role: (typeof artifacts)[number]["role"]) =>
    artifactSetFingerprint(
      artifacts
        .filter((artifact) => artifact.role === role)
        .map(({ id, path, actualHash }) => ({ id, path, actualHash })),
    );

  return {
    contractHash: purposeContractHash(contract),
    fixtureVersion: fingerprintFor("fixture"),
    interactionFingerprint: fingerprintFor("interaction"),
    relevantDependencyFingerprint: fingerprintFor("dependency"),
    evidenceFingerprint: fingerprintFor("evidence"),
    resolvedArtifactIds: new Set(
      artifacts
        .filter(
          (artifact) =>
            artifact.actualHash !== null && artifact.actualHash === artifact.sha256,
        )
        .map((artifact) => artifact.id),
    ),
  };
}
