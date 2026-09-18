import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@/lib/shared/canonical-json";

// Structure detects absent evidence; the independent reviewer judges credibility.
const narrative = z.string().trim().min(20).max(12_000);
const refs = z.array(z.string().trim().min(1)).min(1).max(100);
export const failureAnalysisSchema = z.object({
  schemaVersion: z.literal(1), capsuleId: z.string().min(1),
  headTreeHash: z.string().regex(/^[a-f0-9]{40}$/), diffDigest: z.string().regex(/^[a-f0-9]{64}$/),
  design: z.object({ reference: z.string().regex(/^.+@[a-f0-9]{40}$/), analysis: narrative }).strict(),
  scope: narrative,
  affectedPeople: narrative, invariants: narrative, boundaries: narrative,
  eliminated: z.array(z.object({ opportunity: narrative, mechanism: narrative, evidenceIds: refs }).strict()).max(100),
  noEliminationRationale: narrative.optional(),
  scenarios: z.array(z.object({
    key: z.string().min(1), trigger: narrative, effect: narrative,
    severity: z.enum(["low", "medium", "high", "critical"]), exposure: narrative,
    prevention: narrative, containment: narrative, detection: narrative, recovery: narrative,
    evidenceIds: refs,
    residualRisk: z.object({ owner: z.string().trim().min(1),
      disposition: z.enum(["mitigated", "accepted", "deferred", "blocked"]), rationale: narrative,
      authorityEvidenceId: z.string().min(1).optional(), followUpReference: z.string().min(1).optional(),
    }).strict(),
  }).strict()).min(1).max(100),
}).strict();
export type FailureAnalysis = z.infer<typeof failureAnalysisSchema>;
export type FailureAnalysisIdentity = Pick<FailureAnalysis, "capsuleId" | "headTreeHash" | "diffDigest">;

/** Supplied by the trusted evidence adapter, never accepted from an MCP caller. */
export interface FailureVerificationEvidence extends FailureAnalysisIdentity {
  id: string; status: string; expected: string; observed: string; completedAt: string;
}

export function validateFailureAnalysis(value: unknown, identity: FailureAnalysisIdentity,
  evidence: readonly FailureVerificationEvidence[]) {
  const parsed = failureAnalysisSchema.safeParse(value);
  const reasons: string[] = [];
  if (!parsed.success) return { valid: false, reasons: ["missing-or-malformed-failure-analysis"], digest: null, analysis: null };
  const analysis = parsed.data;
  for (const key of ["capsuleId", "headTreeHash", "diffDigest"] as const) {
    if (analysis[key] !== identity[key]) reasons.push(`failure-analysis-${key}-mismatch`);
  }
  if (!analysis.eliminated.length && !analysis.noEliminationRationale) reasons.push("elimination-rationale-missing");
  if (/\b(?:every|all) possible failures? (?:has|have|is|are|was|were|been|now|completely|fully| )*eliminated\b|\bzero risk\b/i.test(canonicalJson(analysis))) {
    reasons.push("unsupported-exhaustive-safety-claim");
  }
  if (new Set(analysis.scenarios.map(s => s.key)).size !== analysis.scenarios.length) reasons.push("duplicate-scenario-key");
  const ids = [...new Set([...analysis.eliminated, ...analysis.scenarios].flatMap(s => s.evidenceIds))].sort();
  const resolved: FailureVerificationEvidence[] = [];
  for (const id of ids) {
    const matches = evidence.filter(e => e.id === id);
    const row = matches[0];
    if (matches.length !== 1 || !row) { reasons.push(`missing-or-ambiguous-evidence:${id}`); continue; }
    if (row.capsuleId !== identity.capsuleId || row.headTreeHash !== identity.headTreeHash || row.diffDigest !== identity.diffDigest) reasons.push(`stale-evidence:${id}`);
    if (row.status !== "passed" || !Number.isFinite(Date.parse(row.completedAt)) || !row.expected.trim() || !row.observed.trim()) reasons.push(`unverified-evidence:${id}`);
    resolved.push(row);
  }
  for (const scenario of analysis.scenarios) {
    // A narrative is never an authority receipt. Until an existing acceptance
    // authority is resolved by the boundary, accepted/deferred risks stay closed.
    if (scenario.residualRisk.disposition !== "mitigated") reasons.push(`risk-disposition-requires-authority:${scenario.key}`);
  }
  return { valid: reasons.length === 0, reasons,
    digest: createHash("sha256").update(canonicalJson({ analysis, evidence: resolved })).digest("hex"), analysis };
}
