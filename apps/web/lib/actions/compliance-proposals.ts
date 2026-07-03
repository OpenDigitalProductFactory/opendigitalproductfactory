"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  type ComplianceActionResult,
  requireViewCompliance,
  requireManageCompliance,
  getSessionEmployeeId,
  logComplianceAction,
} from "@/lib/actions/compliance-helpers";
import {
  validateProposalPayload,
  parseControlMappingPayload,
  type ProposalKind,
  type ProposalStatus,
} from "@/lib/compliance-proposal";

// Phase 5 — compliance-coworker write-WITH-APPROVAL. The coworker PROPOSES a GRC
// change (staging, low-risk → view capability); a human APPROVES it (→ manage
// capability), and approval commits via the existing create/link primitives.

function generateProposalId(): string {
  return `PROP-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export async function proposeComplianceChange(input: {
  kind: ProposalKind;
  payload: unknown;
  rationale?: string | null;
  proposedByAgentId?: string | null;
}): Promise<ComplianceActionResult> {
  // Proposing is staging only — a coworker with view access may propose.
  await requireViewCompliance();
  const error = validateProposalPayload(input.kind, input.payload);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.complianceProposal.create({
    data: {
      proposalId: generateProposalId(),
      kind: input.kind,
      status: "pending",
      payload: input.payload as object,
      rationale: input.rationale ?? null,
      proposedByAgentId: input.proposedByAgentId ?? null,
      proposedByEmployeeId: employeeId,
    },
  });
  await logComplianceAction("proposal", record.id, "created", employeeId, input.proposedByAgentId ?? null, {
    notes: `proposed ${input.kind}`,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Change proposed for review.", id: record.id };
}

export async function listComplianceProposals(status?: ProposalStatus) {
  await requireViewCompliance();
  return prisma.complianceProposal.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function approveComplianceProposal(
  id: string,
  reviewNotes?: string | null,
): Promise<ComplianceActionResult> {
  // Approving commits an authoritative write — human-in-the-loop only.
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();
  const proposal = await prisma.complianceProposal.findUniqueOrThrow({ where: { id } });
  if (proposal.status !== "pending") {
    return { ok: false, message: `Proposal is already ${proposal.status}.` };
  }

  let committedEntityId: string | null = null;

  if (proposal.kind === "control-mapping") {
    const mapping = parseControlMappingPayload(proposal.payload);
    if (!mapping) return { ok: false, message: "Malformed control-mapping payload." };
    const existing = await prisma.controlObligationLink.findUnique({
      where: { controlId_obligationId: { controlId: mapping.controlId, obligationId: mapping.obligationId } },
    });
    const link =
      existing ??
      (await prisma.controlObligationLink.create({
        data: { controlId: mapping.controlId, obligationId: mapping.obligationId },
      }));
    committedEntityId = link.id;
  } else {
    // regulation / obligation proposals stage for authoring; committing them
    // routes through the dedicated create actions (createRegulation / the
    // onboarding wizard), so approval here only records the decision.
    return { ok: false, message: `Approval-commit for '${proposal.kind}' routes through its authoring form.` };
  }

  await prisma.complianceProposal.update({
    where: { id },
    data: { status: "approved", reviewedByEmployeeId: employeeId, reviewNotes: reviewNotes ?? null, committedEntityId },
  });
  await logComplianceAction("proposal", id, "status-changed", employeeId, null, {
    field: "status",
    newValue: "approved",
    notes: reviewNotes ?? undefined,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Proposal approved and committed.", id: committedEntityId ?? undefined };
}

export async function rejectComplianceProposal(
  id: string,
  reviewNotes?: string | null,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();
  const proposal = await prisma.complianceProposal.findUniqueOrThrow({ where: { id } });
  if (proposal.status !== "pending") {
    return { ok: false, message: `Proposal is already ${proposal.status}.` };
  }
  await prisma.complianceProposal.update({
    where: { id },
    data: { status: "rejected", reviewedByEmployeeId: employeeId, reviewNotes: reviewNotes ?? null },
  });
  await logComplianceAction("proposal", id, "status-changed", employeeId, null, {
    field: "status",
    newValue: "rejected",
    notes: reviewNotes ?? undefined,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Proposal rejected." };
}
