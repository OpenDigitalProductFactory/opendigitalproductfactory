// apps/web/app/(shell)/employee/recruiting/page.tsx
//
// Recruiting pipeline (BI-9CC44DC7) — the human-facing "one funnel" over the
// merged dual-read read model: native Applications plus Greenhouse-sourced
// staged rows, deduped by the MasterDataSourceRef crosswalk. Read-only; the
// same getRecruitingPipeline the coworker tool (BI-E64D11AE) uses, so the page
// and the tool never drift. The (shell)/employee layout gates view_employee.
//
// Design grounding: Absorb spec §4 Phase 2; operator-signed-off HTML prototype
// (2026-08-06). Ratified purpose contract: lib/ux-budget/purpose-contracts/recruiting-pipeline.ts.

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import {
  getRecruitingPipeline,
  type RecruitingPipelineClient,
} from "@/lib/recruiting/pipeline-read-model";
import {
  listRecruitingRequisitions,
  type RequisitionsReadClient,
} from "@/lib/recruiting/requisitions-read-model";
import { RecruitingPipelinePanel } from "@/components/recruiting/RecruitingPipelinePanel";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RecruitingPipelinePage({ searchParams }: Props) {
  await auth(); // (shell)/employee layout gates view_employee; render read-only.
  const params = await searchParams;
  const requisitionId =
    typeof params.requisitionId === "string" && params.requisitionId.length > 0
      ? params.requisitionId
      : undefined;

  const [pipeline, requisitions] = await Promise.all([
    getRecruitingPipeline(prisma as unknown as RecruitingPipelineClient, { requisitionId }),
    listRecruitingRequisitions(prisma as unknown as RequisitionsReadClient),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="space-y-1">
        <a className="text-xs text-[var(--dpf-accent)] underline" href="/employee">
          &larr; People
        </a>
        <h1 className="text-lg font-semibold text-[var(--dpf-text)]">Recruiting pipeline</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          One funnel across natively-created applications and Greenhouse-sourced candidates not yet
          promoted &mdash; deduped so an imported candidate and its native row appear once.
        </p>
      </header>
      <RecruitingPipelinePanel
        pipeline={pipeline}
        requisitions={requisitions}
        selectedRequisitionId={requisitionId ?? null}
      />
    </div>
  );
}
