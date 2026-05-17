import { GitBranch, RefreshCcw } from "lucide-react";

import { PortalContextStrip } from "@/components/portal-context/PortalContextStrip";
import type { PortalContextEnvelope } from "@/lib/portal-context";
import { AdoptableWorktreeTable, type AdoptableWorktreeRow } from "./AdoptableWorktreeTable";
import { CreateGovernedWorkForm, type CreateGovernedWorkAction } from "./CreateGovernedWorkForm";
import { WorkCapsuleTable, type WorkCapsuleRow } from "./WorkCapsuleTable";

export function WorkControlPanel({
  capsules,
  adoptable,
  createAction,
  portalContext,
}: {
  capsules: WorkCapsuleRow[];
  adoptable: AdoptableWorktreeRow[];
  createAction: CreateGovernedWorkAction;
  portalContext?: PortalContextEnvelope | null;
}) {
  return (
    <section className="space-y-6 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Work Control</h1>
        </div>
      </div>

      <PortalContextStrip envelope={portalContext ?? null} />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            <span>Active capsules</span>
          </div>
          <div className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{capsules.length}</div>
        </div>
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            <span>Adoptable work</span>
          </div>
          <div className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{adoptable.length}</div>
        </div>
      </div>

      <CreateGovernedWorkForm action={createAction} />

      <WorkCapsuleTable capsules={capsules} />
      <AdoptableWorktreeTable rows={adoptable} />
    </section>
  );
}
