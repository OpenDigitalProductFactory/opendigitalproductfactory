// EP-WIKI-001 Phase 2.3b: end-to-end ingest pipeline.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 2.3)
//
// Glues together the three engine modules an agent has to call to take
// a raw source from "file on disk" to "draft overlay pages":
//
//   1. ingestRawSourceFromFile (Phase 2.1) — upsert RawSource row +
//      WikiIngestEvent audit. No LLM, no wiki pages touched.
//   2. proposeWikiDiff         (Phase 2.2) — three-pass LLM extraction
//      (abstract / claims / stances+heuristics). Returns structured
//      proposals; pure engine.
//   3. commitIngestProposal    (Phase 2.3a) — turn the proposal into
//      WikiPage / WikiPageRevision / WikiPageSource rows under the
//      requesting org's overlay. Kernel pages stay PR-only.
//
// Two modes the caller picks:
//   - "propose" returns the WikiDiffProposal without writing anything.
//     The agent (or the `wiki_ingest` MCP tool wrapper) can render it
//     for human review before committing.
//   - "commit" runs the full pipeline; the result includes both the
//     proposal and the commit summary.
//
// Inference is dependency-injected. Production wiring uses the adapter
// in `./inference-adapter`; tests pass a stub `InferenceCallable`.

import { prisma } from "@dpf/db";
import {
  ingestRawSourceFromFile,
  type IngestRawSourceFromFileInput,
  type IngestRawSourceResult,
} from "./ingest";
import {
  proposeWikiDiff,
  type InferenceCallable,
  type WikiDiffProposal,
} from "./proposal";
import { loadExistingSlugSnapshot } from "./schema-context";
import {
  commitIngestProposal,
  type CommitProposalResult,
} from "./proposal-commit";

// ─── Types ──────────────────────────────────────────────────────────────────

export type IngestPipelineMode = "propose" | "commit";

export type RunIngestPipelineInput = {
  /**
   * Source-layer ingest inputs forwarded to `ingestRawSourceFromFile`.
   * The caller controls filePath, override sourceKey/sourceType, and
   * attribution (agentId/userId).
   */
  source: IngestRawSourceFromFileInput;
  /** Org for the overlay commit. Required in "commit" mode. */
  organizationId: string | null;
  mode: IngestPipelineMode;
  /** Production wiring via createProductionInference(); tests inject stubs. */
  infer: InferenceCallable;
  /**
   * Forwarded to `commitIngestProposal`. Default 0.5; below this, claims
   * are dropped instead of committed (visible in `result.skipped`).
   */
  acceptThreshold?: number;
  /**
   * Forwarded to `commitIngestProposal`. Default 0.3 — appends that grow
   * a page body by more than this fraction need human approval. Larger
   * rewrites surface as `commit.errors` rather than auto-applying.
   */
  maxBodyDeltaRatio?: number;
};

export type RunIngestPipelineResult = {
  source: IngestRawSourceResult;
  proposal: WikiDiffProposal;
  /** Present only in "commit" mode. */
  commit: CommitProposalResult | null;
};

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Run the full ingest pipeline. `commit` mode requires `organizationId`
 * because kernel writes are PR-only (spec §4); `propose` mode works
 * regardless because nothing is written to wiki pages.
 */
export async function runIngestPipeline(
  input: RunIngestPipelineInput,
): Promise<RunIngestPipelineResult> {
  if (input.mode === "commit" && input.organizationId === null) {
    throw new Error(
      "runIngestPipeline: commit mode requires an organizationId — kernel pages are PR-only per spec §4.",
    );
  }

  // 1. Source-layer ingest (Phase 2.1).
  const source = await ingestRawSourceFromFile(prisma, input.source);

  // 2. Read the just-upserted RawSource so the proposer has the body.
  const rawRow = (await prisma.rawSource.findFirst({
    where: { id: source.rawSourceId },
    select: {
      sourceKey: true,
      title: true,
      abstract: true,
      excerpt: true,
    },
  })) as
    | { sourceKey: string; title: string; abstract: string | null; excerpt: string | null }
    | null;
  if (!rawRow) {
    throw new Error(
      `runIngestPipeline: just-ingested RawSource ${source.rawSourceId} missing — DB inconsistent.`,
    );
  }

  // 3. Load the existing-slug snapshot for the relevant scope.
  //    Propose mode: maintainer-wide (sees kernel + every overlay so we
  //    avoid suggesting slugs that are already in use anywhere).
  //    Commit mode: scoped to the target org so overlay+kernel resolution
  //    matches what the commit step sees.
  const snapshot = await loadExistingSlugSnapshot(prisma, {
    organizationId: input.mode === "commit" ? input.organizationId : undefined,
  });

  // 4. Run the proposal engine (Phase 2.2).
  const proposal = await proposeWikiDiff({
    source: {
      sourceKey: rawRow.sourceKey,
      title: rawRow.title,
      body: rawRow.excerpt ?? "",
      abstract: rawRow.abstract,
    },
    snapshot,
    infer: input.infer,
  });

  if (input.mode === "propose") {
    return { source, proposal, commit: null };
  }

  // 5. Commit (Phase 2.3a). organizationId is non-null here per the
  //    runtime gate at the top of the function.
  const commit = await commitIngestProposal(prisma, {
    rawSourceId: source.rawSourceId,
    sourceKey: rawRow.sourceKey,
    proposal,
    organizationId: input.organizationId!,
    agentId: input.source.agentId ?? null,
    userId: input.source.userId ?? null,
    kernelVersion: input.source.kernelVersion ?? null,
    acceptThreshold: input.acceptThreshold,
    maxBodyDeltaRatio: input.maxBodyDeltaRatio,
  });

  return { source, proposal, commit };
}

// ─── Compact summary ────────────────────────────────────────────────────────

/**
 * Render a `RunIngestPipelineResult` into a short human-readable string
 * suitable for an MCP tool reply or a CLI status line. Keeps the
 * verbosity bounded so it fits in chat output without truncation.
 */
export function summarizePipelineResult(
  result: RunIngestPipelineResult,
): string {
  const lines: string[] = [];
  const verb = result.source.isNew ? "Ingested" : "Re-ingested";
  lines.push(
    `${verb} ${result.source.sourceKey} (id=${result.source.rawSourceId}, type=${result.source.sourceType}).`,
  );
  lines.push(
    `Proposal: ${result.proposal.claims.length} claim(s), ${result.proposal.stances.length} stance(s), ${result.proposal.heuristics.length} heuristic(s)` +
      (result.proposal.parseErrors.length > 0
        ? `; ${result.proposal.parseErrors.length} parse error(s)`
        : "") +
      ".",
  );
  if (result.commit) {
    lines.push(
      `Committed: ${result.commit.createdPageSlugs.length} new + ${result.commit.updatedPageSlugs.length} updated overlay page(s); ${result.commit.skippedLowConfidence.length} skipped (low confidence)` +
        (result.commit.errors.length > 0
          ? `; ${result.commit.errors.length} commit error(s)`
          : "") +
        `. Audit event ${result.commit.eventId}.`,
    );
    if (result.commit.createdPageSlugs.length > 0) {
      lines.push(
        `New: ${result.commit.createdPageSlugs.slice(0, 8).join(", ")}` +
          (result.commit.createdPageSlugs.length > 8 ? ", …" : ""),
      );
    }
  } else {
    lines.push("Mode: propose (no commit; nothing written to wiki pages).");
  }
  return lines.join("\n");
}
