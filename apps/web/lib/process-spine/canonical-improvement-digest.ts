// BI-8996BBBB — batch verified [reference-doc] ImprovementProposal rows into a
// single backlog chore the operator can land as a canonical-source PR.

import type { PrismaClient } from "@dpf/db";

const REFERENCE_DOC_MARKER = "[reference-doc]";

export type DigestCandidate = {
  proposalId: string;
  title: string;
  description: string;
  createdAt: Date;
};

export function isReferenceDocProposal(row: { description: string; category: string }): boolean {
  return (
    row.category === "process" &&
    row.description.trim().toLowerCase().includes(REFERENCE_DOC_MARKER.toLowerCase())
  );
}

export function buildDigestBody(candidates: DigestCandidate[]): string {
  const header =
    "Canonical improvement digest — reference-doc proposals batched for a single PR against AGENTS.md, a kernel principle, or a SKILL.md.\n";
  const items = candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.proposalId} — ${c.title}\n${c.description.trim()}\n`,
    )
    .join("\n");
  return `${header}\n${items}`;
}

export async function runCanonicalImprovementDigest(prisma: PrismaClient, opts?: { max?: number }) {
  const max = opts?.max ?? 25;
  const candidates = await prisma.improvementProposal.findMany({
    where: {
      category: "process",
      status: "proposed",
      prioritizedAt: null,
      description: { contains: REFERENCE_DOC_MARKER, mode: "insensitive" },
    },
    orderBy: { createdAt: "asc" },
    take: max,
    select: {
      proposalId: true,
      title: true,
      description: true,
      createdAt: true,
    },
  });

  if (candidates.length === 0) {
    return { digested: 0, backlogItemId: null as string | null };
  }

  const { ingestBacklogItem } = await import("@/lib/operate/backlog-ingest");
  const body = buildDigestBody(candidates);
  const ingest = await ingestBacklogItem({
    title: `Canonical source digest — ${candidates.length} reference-doc proposal(s)`,
    body,
    workType: "doc",
    source: "automated-detection",
    itemIdPrefix: "DIG",
    submittedById: null,
    agentId: "process-spine-digest",
    origin: { kind: "improvement-digest", id: candidates.map((c) => c.proposalId).join(",") },
  });

  const now = new Date();
  await prisma.improvementProposal.updateMany({
    where: { proposalId: { in: candidates.map((c) => c.proposalId) } },
    data: {
      prioritizedAt: now,
      backlogItemId: ingest.itemId,
      status: "prioritized",
    },
  });

  return { digested: candidates.length, backlogItemId: ingest.itemId };
}

export async function promoteReferenceDocFindings(
  prisma: PrismaClient,
  issues: Array<{ severity: string; description: string; suggestion?: string }>,
  ctx: { userId: string; agentId?: string | null; threadId?: string | null; routeContext?: string | null },
) {
  const { extractReferenceDocIssues, referenceDocProposalBody, referenceDocProposalTitle } =
    await import("./reference-doc-promotion");
  const hits = extractReferenceDocIssues(issues);
  if (hits.length === 0) return { created: [] as string[] };

  const created: string[] = [];
  for (const issue of hits) {
    const proposalId = `IP-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
    await prisma.improvementProposal.create({
      data: {
        proposalId,
        title: referenceDocProposalTitle(issue),
        description: referenceDocProposalBody(issue),
        category: "process",
        severity: "low",
        submittedById: ctx.userId,
        agentId: ctx.agentId ?? "architecture-review",
        routeContext: ctx.routeContext ?? "build-review",
        threadId: ctx.threadId ?? null,
        observedFriction: "Architecture review surfaced a reference-doc gap.",
      },
    });
    created.push(proposalId);
  }
  return { created };
}