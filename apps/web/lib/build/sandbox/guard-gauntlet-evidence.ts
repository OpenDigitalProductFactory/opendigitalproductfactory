/**
 * Turn a guard-gauntlet run into a gate evidence record, keyed to the tree it
 * checked, in the shape the external-agent path already produces.
 *
 * Slice 1 makes the checks run. This makes their result COUNT: an in-platform
 * verification that leaves no record cannot be honoured by anything downstream,
 * even when it happened and passed (BI-4A9910A9).
 *
 * Two deliberate choices, both about honesty:
 *
 * 1. Keyed to the TREE, not the build. A build id says who ran it; a tree sha
 *    says what was checked. Only the second survives work moving between
 *    surfaces, which is the whole point of parity — a change started in Build
 *    Studio and finished in a worktree should not have to be re-verified.
 *
 * 2. A DISTINCT gate kind. This is the fast tier — guards only, no production
 *    build and no image, because the sandbox has no Docker socket by design and
 *    must not be given one. Recording it under the full gate's kind would let a
 *    later claim reuse it as though the heavy tier had run. It states what it is
 *    and is reusable only by something asking for the same thing.
 */
import { createHash } from "node:crypto";

import { deriveGateKey } from "@/lib/gates/gate-run-identity";

/**
 * The fast-tier gate kind. Deliberately NOT "local-integration-ci": that kind
 * means the full gauntlet plus typecheck, tests, production build and image, and
 * a record claiming it would overstate this run's coverage.
 */
export const IN_PLATFORM_PREFLIGHT_GATE_KIND = "in-platform-preflight" as const;

/**
 * The repository a gate key is scoped to. Read from configuration when present,
 * falling back to the canonical upstream — which is what a consumer install's
 * sandbox is pointed at by `start_build`, so the fallback is the common case
 * rather than a guess.
 */
export function resolveGauntletRepository(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GITHUB_REPOSITORY?.trim();
  if (configured && /^[^/\s]+\/[^/\s]+$/.test(configured)) return configured;
  return "OpenDigitalProductFactory/opendigitalproductfactory";
}

export type GauntletEvidenceInput = {
  repository: string;
  treeSha: string;
  /** Digest of exactly which guards ran and how they landed. */
  guardPlanDigest: string;
  /** Digest of the toolchain that ran them. */
  toolchainFingerprint: string;
};

/**
 * A fingerprint of the sandbox toolchain, so a record is attributable to the
 * thing that produced it. Hashed to a 64-hex digest because that is the shape
 * the gate identity requires.
 */
export function toolchainFingerprintFrom(parts: { node?: string; pnpm?: string; image?: string }): string {
  return createHash("sha256")
    .update(JSON.stringify({ node: parts.node ?? "", pnpm: parts.pnpm ?? "", image: parts.image ?? "" }))
    .digest("hex");
}

/**
 * Derive the gate key for an in-platform preflight run.
 *
 * Uses the SAME `deriveGateKey` the external path uses, so the keying is
 * identical rather than merely similar. A different `gateKind` keeps the two
 * tiers from being mistaken for one another while the derivation stays shared —
 * a second key-derivation function would be a second thing to keep in sync, and
 * they always drift.
 */
export function deriveGauntletGateKey(input: GauntletEvidenceInput): string {
  return deriveGateKey({
    repository: input.repository,
    integrationTreeSha: input.treeSha,
    evidencePlanDigest: input.guardPlanDigest,
    toolchainFingerprint: input.toolchainFingerprint,
    gateKind: IN_PLATFORM_PREFLIGHT_GATE_KIND,
  });
}

export type GauntletEvidencePayload = {
  gateKey: string;
  tier: typeof IN_PLATFORM_PREFLIGHT_GATE_KIND;
  /** What this record does NOT cover, stated in the record itself. */
  coverage: { guards: true; typecheck: false; unitTests: false; productionBuild: false; image: false };
  treeSha: string;
  workdir: string;
  passed: boolean;
  failedGuards: string[];
  output: string;
  durationMs: number;
  completedAt: string;
  gatePassed: boolean;
};

/**
 * Build the `evidence` object for `recordLocalIntegrationResult`.
 *
 * `coverage` is not decoration. A reader that assumes a gate record means "fully
 * verified" would be wrong about this one, and the record is the only place that
 * can say so — the caller is long gone by the time it is read.
 */
export function buildGauntletEvidence(input: {
  identity: GauntletEvidenceInput;
  workdir: string;
  passed: boolean;
  failedGuards: readonly string[];
  output: string;
  durationMs: number;
  completedAt?: Date;
}): GauntletEvidencePayload {
  return {
    gateKey: deriveGauntletGateKey(input.identity),
    tier: IN_PLATFORM_PREFLIGHT_GATE_KIND,
    coverage: { guards: true, typecheck: false, unitTests: false, productionBuild: false, image: false },
    treeSha: input.identity.treeSha,
    workdir: input.workdir,
    passed: input.passed,
    failedGuards: [...input.failedGuards],
    output: input.output,
    durationMs: input.durationMs,
    completedAt: (input.completedAt ?? new Date()).toISOString(),
    gatePassed: input.passed,
  };
}

/**
 * The one-line summary that lands on the timeline. Says the tier out loud, so a
 * reader scanning records is not left to infer it from a nested field.
 */
export function summarizeGauntlet(input: { passed: boolean; failedGuards: readonly string[]; treeSha: string }): string {
  const tree = input.treeSha.slice(0, 12);
  if (input.passed) return `Guard gauntlet passed (guards only, no build or image) for tree ${tree}`;
  const count = input.failedGuards.length;
  const named = input.failedGuards.slice(0, 3).join(", ");
  const more = count > 3 ? `, +${count - 3} more` : "";
  return `Guard gauntlet failed for tree ${tree}: ${count} guard(s) — ${named}${more}`;
}
