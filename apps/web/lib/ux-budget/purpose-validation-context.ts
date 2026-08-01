import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
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

function resolvesInsideRepo(repoRoot: string, artifactPath: string): boolean {
  if (isAbsolute(artifactPath)) return false;
  const absolutePath = resolve(repoRoot, artifactPath);
  const fromRoot = relative(repoRoot, absolutePath);
  return (
    fromRoot.length > 0 &&
    !fromRoot.startsWith("..") &&
    !isAbsolute(fromRoot) &&
    existsSync(absolutePath)
  );
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

  return {
    contractHash: purposeContractHash(contract),
    fixtureVersion: target.fixtureVersion,
    interactionFingerprint: target.interactionFingerprint,
    relevantDependencyFingerprint: target.relevantDependencyFingerprint,
    resolvedArtifactIds: new Set(
      target.artifacts
        .filter((artifact) => resolvesInsideRepo(repoRoot, artifact.path))
        .map((artifact) => artifact.id),
    ),
  };
}
