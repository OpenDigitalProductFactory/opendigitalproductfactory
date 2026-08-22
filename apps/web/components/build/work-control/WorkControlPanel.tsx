import Link from "next/link";
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
  canCreateGovernedWork = false,
  portalContext,
}: {
  capsules: WorkCapsuleRow[];
  adoptable: AdoptableWorktreeRow[];
  createAction: CreateGovernedWorkAction;
  // BI-E167A8A6: gates door 2's create form to manage_backlog holders so a
  // non-technical operator never faces a second "start work" intake they
  // cannot use. Defaults false — the create door is hidden unless granted.
  canCreateGovernedWork?: boolean;
  portalContext?: PortalContextEnvelope | null;
}) {
  return (
    <section className="space-y-6 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Work Control</h1>
        </div>
      </div>

      {/* BI-E167A8A6: state what this surface is and how it relates to the other
          Build Studio intake ("Start a new outcome"). Work Control is the governed
          engineering substrate; describing a feature in plain English lives in
          Build Studio. Making the relationship explicit is the fix for the
          dual-intake IA confusion. */}
      <p className="max-w-2xl text-sm leading-relaxed text-[var(--dpf-muted)]">
        The governed engineering substrate for Build Studio — git branches,
        worktrees, and workrooms for hands-on development and AI coding
        agents. Every build you start already manages its own workroom here. To
        describe a feature in plain English and have your AI Coworker design,
        build, and ship it, use{" "}
        <Link
          href="/build"
          className="font-medium text-[var(--dpf-accent)] hover:underline"
        >
          Start a new outcome
        </Link>{" "}
        in Build Studio.
      </p>

      <PortalContextStrip envelope={portalContext ?? null} />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            <span>Active workrooms</span>
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

      {canCreateGovernedWork ? (
        <CreateGovernedWorkForm action={createAction} />
      ) : (
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          Planning governed work directly is reserved for the manage-backlog role.
          To start new work, use{" "}
          <Link
            href="/build"
            className="font-medium text-[var(--dpf-accent)] hover:underline"
          >
            Start a new outcome
          </Link>{" "}
          in Build Studio — your AI Coworker sets up the workroom and branch for
          you.
        </div>
      )}

      <WorkCapsuleTable capsules={capsules} />
      <AdoptableWorktreeTable rows={adoptable} />
    </section>
  );
}
