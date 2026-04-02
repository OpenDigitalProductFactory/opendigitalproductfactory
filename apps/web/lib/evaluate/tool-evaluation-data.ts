import { cache } from "react";
import { prisma, Prisma } from "@dpf/db";
import type {
  EvaluationFinding,
  ReviewerRecord,
  ToolVerdict,
} from "./tool-evaluation";

export type ToolEvaluationRow = {
  id: string;
  toolName: string;
  toolType: string;
  version: string;
  sourceUrl: string;
  proposedBy: string;
  proposedAt: string;
  status: string;
  verdict: ToolVerdict | null;
  conditions: string[];
  findings: EvaluationFinding[];
  reviewers: ReviewerRecord[];
  approvedBy: string | null;
  approvedAt: string | null;
  reEvaluateAfter: string | null;
  supersedes: string | null;
};

function toRow(r: {
  id: string;
  toolName: string;
  toolType: string;
  version: string;
  sourceUrl: string;
  proposedBy: string;
  proposedAt: Date;
  status: string;
  verdict: unknown;
  conditions: unknown;
  findings: unknown;
  reviewers: unknown;
  approvedBy: string | null;
  approvedAt: Date | null;
  reEvaluateAfter: Date | null;
  supersedes: string | null;
}): ToolEvaluationRow {
  return {
    id: r.id,
    toolName: r.toolName,
    toolType: r.toolType,
    version: r.version,
    sourceUrl: r.sourceUrl,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt.toISOString(),
    status: r.status,
    verdict: r.verdict as ToolVerdict | null,
    conditions: r.conditions as string[],
    findings: r.findings as EvaluationFinding[],
    reviewers: r.reviewers as ReviewerRecord[],
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    reEvaluateAfter: r.reEvaluateAfter?.toISOString() ?? null,
    supersedes: r.supersedes,
  };
}

export const getToolEvaluations = cache(
  async (): Promise<ToolEvaluationRow[]> => {
    const rows = await prisma.toolEvaluation.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRow);
  },
);

export async function createToolEvaluation(input: {
  toolName: string;
  toolType: string;
  version: string;
  sourceUrl: string;
  proposedBy: string;
}): Promise<string> {
  const record = await prisma.toolEvaluation.create({
    data: {
      toolName: input.toolName,
      toolType: input.toolType,
      version: input.version,
      sourceUrl: input.sourceUrl,
      proposedBy: input.proposedBy,
      status: "proposed",
    },
  });
  return record.id;
}

export async function updateEvaluationFindings(
  id: string,
  findings: EvaluationFinding[],
  reviewer: ReviewerRecord,
): Promise<void> {
  const current = await prisma.toolEvaluation.findUniqueOrThrow({
    where: { id },
  });
  const existingFindings = current.findings as EvaluationFinding[];
  const existingReviewers = current.reviewers as ReviewerRecord[];

  await prisma.toolEvaluation.update({
    where: { id },
    data: {
      status: "in_review",
      findings: [...existingFindings, ...findings] as unknown as Prisma.InputJsonValue,
      reviewers: [...existingReviewers, reviewer] as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function setEvaluationVerdict(
  id: string,
  verdict: ToolVerdict,
  conditions: string[],
  reEvaluateAfter: Date,
): Promise<void> {
  await prisma.toolEvaluation.update({
    where: { id },
    data: {
      status: verdict.decision === "reject" ? "rejected" : verdict.decision,
      verdict: verdict as unknown as Prisma.InputJsonValue,
      conditions,
      reEvaluateAfter,
    },
  });
}

export async function approveEvaluation(
  id: string,
  approvedBy: string,
): Promise<void> {
  await prisma.toolEvaluation.update({
    where: { id },
    data: {
      approvedBy,
      approvedAt: new Date(),
    },
  });
}

export async function lookupApprovedTool(
  toolName: string,
): Promise<ToolEvaluationRow | null> {
  const row = await prisma.toolEvaluation.findFirst({
    where: {
      toolName,
      status: { in: ["approved", "conditional"] },
    },
    orderBy: { approvedAt: "desc" },
  });
  if (!row) return null;
  return toRow(row);
}
