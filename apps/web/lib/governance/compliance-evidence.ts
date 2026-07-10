// EP-8DC217EB BET-12 — generic case/run → ComplianceEvidence path.
//
// Spec: docs/superpowers/specs/2026-07-09-governance-finding-contract-design.md §
// "case→evidence generalization".
//
// The neutral home for the GRC evidence contract: any governed activity that
// wants to leave continuous ComplianceEvidence (security cases, supply-chain
// assurance runs, …) projects itself into a `ComplianceEvidenceInput` and hands
// it to `recordComplianceEvidence`. Previously this idempotent upsert lived only
// in lib/security/compliance.ts, so ComplianceEvidence was fed from security
// alone; re-homing it here lets assurance (and future sources) feed GRC too.
//
// Persistence is a thin idempotent upsert keyed on `evidenceId`.

export interface ComplianceEvidenceInput {
  evidenceId: string;
  title: string;
  evidenceType: string;
  description: string;
  status: string;
}

/** Idempotently record one piece of compliance evidence (upsert on evidenceId).
 *  Re-recording the same evidenceId refreshes title/description/status without
 *  creating a duplicate — safe to call on every run/case completion. */
export async function recordComplianceEvidence(
  input: ComplianceEvidenceInput,
): Promise<{ evidenceId: string }> {
  const { prisma } = await import("@dpf/db");
  await prisma.complianceEvidence.upsert({
    where: { evidenceId: input.evidenceId },
    update: { title: input.title, description: input.description, status: input.status },
    create: {
      evidenceId: input.evidenceId,
      title: input.title,
      evidenceType: input.evidenceType,
      description: input.description,
      status: input.status,
    },
  });
  return { evidenceId: input.evidenceId };
}
