// Research execution-on-approval (BI-8A58C65A, EP-CORPUS-BOOTSTRAP) — slice C.
//
// When a ResearchProposal is approved (slice B's onApproved seam), this runs the
// research engine (slice A) and lands the findings in the org WWWD corpus as a
// DRAFT (research trust, per BI-1378), then stamps the proposal executed/failed.
//
// Designed to run as an Inngest job (research/execute.run) off the approval, so
// the operator's approve click isn't blocked on web+LLM work. `runResearch
// Execution` is the pure, testable core; the job wrapper lives in
// queue/functions/research-execute.ts.

import { prisma } from "@dpf/db";
import { runMarketResearch } from "./market-research";
import { enrichOrgCorpus } from "./enrich-org-corpus";
import { createProductionInference } from "./inference-adapter";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type RunResearchExecutionInput = {
  proposalId: string;
  organizationId: string;
  digitalProductId: string | null;
  topic: string;
  query: string;
};

type ResearchOutcome = {
  text: string;
  sources: { title: string; url: string }[];
  empty: boolean;
};

type EnrichInput = {
  organizationId: string;
  text: string;
  title: string;
  provenance: { sourceType: "research"; sourceRef: Record<string, unknown> };
  trust: "researched";
};

export type ResearchExecutionDeps = {
  db?: {
    researchProposal: { update: (args: unknown) => Promise<unknown> };
  };
  /** Defaults to runMarketResearch (slice A). */
  research?: (input: { organizationId: string; query: string }) => Promise<ResearchOutcome>;
  /** Defaults to enrichOrgCorpus with a production inference adapter. */
  enrich?: (input: EnrichInput) => Promise<{ committed: Array<{ pageId: string; slug: string }> }>;
};

export type RunResearchExecutionResult = {
  status: "executed" | "failed";
  pagesCommitted: number;
  summary: string;
};

export async function runResearchExecution(
  input: RunResearchExecutionInput,
  deps: ResearchExecutionDeps = {},
): Promise<RunResearchExecutionResult> {
  const db = deps.db ?? (prisma as unknown as NonNullable<ResearchExecutionDeps["db"]>);
  const research = deps.research ?? ((i) => runMarketResearch(i));
  const enrich =
    deps.enrich ??
    ((i: EnrichInput) =>
      enrichOrgCorpus({
        ...i,
        infer: createProductionInference({ taskType: "market_research" }),
      }) as Promise<{ committed: Array<{ pageId: string; slug: string }> }>);

  try {
    const result = await research({ organizationId: input.organizationId, query: input.query });

    if (result.empty) {
      const summary = "No findings — web search returned nothing to add.";
      await db.researchProposal.update({
        where: { proposalId: input.proposalId },
        data: { status: "executed", executedAt: new Date(), resultSummary: summary },
      });
      return { status: "executed", pagesCommitted: 0, summary };
    }

    const enriched = await enrich({
      organizationId: input.organizationId,
      text: result.text,
      title: `Market research: ${input.topic}`,
      provenance: {
        sourceType: "research",
        sourceRef: {
          proposalId: input.proposalId,
          digitalProductId: input.digitalProductId,
          topic: input.topic,
          urls: result.sources.map((s) => s.url),
        },
      },
      trust: "researched",
    });

    const pagesCommitted = enriched?.committed?.length ?? 0;
    const summary = `Added ${pagesCommitted} draft page(s) from ${result.sources.length} source(s) — awaiting review.`;
    await db.researchProposal.update({
      where: { proposalId: input.proposalId },
      data: { status: "executed", executedAt: new Date(), resultSummary: summary },
    });
    return { status: "executed", pagesCommitted, summary };
  } catch (err) {
    const summary = `Research execution failed: ${getErrorMessage(err)}`;
    await db.researchProposal
      .update({
        where: { proposalId: input.proposalId },
        data: { status: "failed", executedAt: new Date(), resultSummary: summary },
      })
      .catch(() => undefined);
    return { status: "failed", pagesCommitted: 0, summary };
  }
}

// ─── Enqueue seam (the target of slice B's approveResearch onApproved) ────────

/** Enqueue execution for an approved proposal. Wire this into approveResearch's
 *  `onApproved` seam at the approval call site (slice E). Fire-and-forget at the
 *  call site; the Inngest job carries retries. */
export async function enqueueResearchExecution(proposal: RunResearchExecutionInput): Promise<void> {
  const { inngest } = await import("@/lib/queue/inngest-client");
  await inngest.send({ name: "research/execute.run", data: proposal });
}
