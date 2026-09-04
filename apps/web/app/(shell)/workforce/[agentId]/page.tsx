// apps/web/app/(shell)/workforce/[agentId]/page.tsx
//
// EP-COWORKER-IDENTITY-360 (spec docs/superpowers/specs/2026-08-06-coworker-identity-360-hub-design.md)
// Phase 1 — the Coworker Identity 360: a coworker inspected as a first-class
// identity (like a Person or a Customer), not as a platform-admin record. The
// definition IS the summary at the top (what it does, why it's here, why it's
// valuable); Priority + Proactivity are set inline via the CANONICAL shared
// controls; the founder-named facets that are surfaced on a coworker's identity
// nowhere else today — Cost and "who has engaged it" — are here, each collapsed
// to a one-line summary until opened. The existing admin record
// (/platform/ai/agent/[agentId]) stays and is reached via "Manage".
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare, Settings2 } from "lucide-react";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadCoworkerRecord } from "@/lib/coworker-record/load-record";
import { getCoworkerPostureInheritance } from "@/lib/actions/golden-triangle";
import {
  loadCoworkerCostProjection,
  costGlance,
  costFacetSummary,
  hasCostActivity,
} from "@/lib/coworker-identity/cost-projection";
import { loadCoworkerEngagements } from "@/lib/coworker-identity/engagements-projection";
import { loadCoworkerTeams } from "@/lib/coworker-identity/teams-projection";
import { CoworkerPriorityControl } from "@/components/golden-triangle/CoworkerPriorityControl";
import { CoworkerProactivityNote } from "@/components/platform/coworker-record/CoworkerProactivityNote";
import { CostFacetPanel } from "@/components/platform/coworker-identity/CostFacetPanel";
import { EngagementsFacetPanel } from "@/components/platform/coworker-identity/EngagementsFacetPanel";
import { TeamsFacetPanel } from "@/components/platform/coworker-identity/TeamsFacetPanel";
import { ShareIdentity } from "@/components/platform/coworker-identity/ShareIdentity";
import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";

const AUTONOMY_LABELS: Record<number, string> = {
  0: "Human only",
  1: "Approve each action",
  2: "Review",
  3: "Autonomous",
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A collapsed-by-default facet: the summary line is all you see until you open it.
 *  When `empty`, it renders as a muted, non-openable row (no caret, no New badge)
 *  stating the empty condition — so a coworker with genuinely no data for a facet
 *  doesn't add an inviting-but-hollow click (smart progressive disclosure). */
function Facet({
  title,
  isNew,
  summary,
  empty,
  emptyLabel,
  children,
}: {
  title: string;
  isNew?: boolean;
  summary: string;
  empty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
}) {
  if (empty) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--dpf-muted)]">{title}</span>
        <span className="ml-auto text-right text-xs text-[var(--dpf-faint,var(--dpf-muted))]">
          {emptyLabel ?? "Nothing yet"}
        </span>
      </div>
    );
  }
  return (
    <details className="overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className="text-sm font-semibold text-[var(--dpf-text)]">{title}</span>
        {isNew && (
          <span className="rounded bg-[var(--dpf-accent)] px-1.5 py-0.5 text-dpf-caption font-extrabold uppercase tracking-wider text-white">
            New
          </span>
        )}
        <span className="ml-auto text-right text-xs text-[var(--dpf-muted)]">{summary}</span>
      </summary>
      <div className="border-t border-[var(--dpf-border)] px-4 py-4">{children}</div>
    </details>
  );
}

function ValueItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-dpf-caption font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{label}</div>
      <div className="mt-0.5 text-dpf-body font-medium text-[var(--dpf-text-secondary)]">{value}</div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-r border-[var(--dpf-border)] px-3.5 py-3 last:border-r-0">
      <div className="text-dpf-caption font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{label}</div>
      <div className="mt-1 text-dpf-title font-bold tabular-nums tracking-tight text-[var(--dpf-text)]">{value}</div>
      {sub && <div className="mt-0.5 text-dpf-caption text-[var(--dpf-faint,var(--dpf-muted))]">{sub}</div>}
    </div>
  );
}

export default async function CoworkerIdentityPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const record = await loadCoworkerRecord(agentId);
  if (!record) return notFound();
  const { agent, runtime } = record;

  const [session, inheritance, cost, engagements, teams] = await Promise.all([
    auth(),
    getCoworkerPostureInheritance(agent.agentId),
    loadCoworkerCostProjection(runtime.agentId, { slugId: runtime.slugId }),
    loadCoworkerEngagements(runtime.agentId, runtime.id, { slugId: runtime.slugId }),
    loadCoworkerTeams(runtime.id),
  ]);

  const canWrite =
    !!session?.user &&
    can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform");

  const detailRoute = `/workforce/${encodeURIComponent(agent.agentId)}`;
  const adminRecord = `/platform/ai/agent/${encodeURIComponent(agent.agentId)}`;
  const agentCardPath = `/api/a2a/coworkers/${encodeURIComponent(agent.agentId)}`;
  const kindLabel = titleCase(agent.kind);
  const shareSummary = (() => {
    const d = (agent.description ?? "").trim();
    const base = d || `${kindLabel} coworker`;
    return base.length > 160 ? `${base.slice(0, 157)}…` : base;
  })();
  const teamName = agent.ownerships?.[0]?.team?.name ?? null;
  const skillCount = runtime.assignedSkillIds.length;
  const toolCount = runtime.heldGrantKeys.length;

  return (
    <div>
      {/* Peer framing — beside People & Customers, not inside platform admin. */}
      <nav className="mb-4 flex flex-wrap items-center gap-2 text-xs text-[var(--dpf-muted)]" aria-label="Breadcrumb">
        <Link href="/platform/ai/overview" className="text-[var(--dpf-muted)] no-underline hover:text-[var(--dpf-text)]">
          AI Coworkers
        </Link>
        <span className="text-[var(--dpf-faint,var(--dpf-muted))]">/</span>
        <span className="font-semibold text-[var(--dpf-text)]">{agent.displayName}</span>
      </nav>

      {/* HEADER = identity + the definition summary */}
      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-[var(--dpf-text)]">{agent.displayName}</h1>
              <span className="rounded-full bg-[var(--dpf-accent-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--dpf-accent)]">
                {kindLabel}
              </span>
              <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-0.5 text-xs font-semibold text-[var(--dpf-text-secondary)]">
                Autonomy: {AUTONOMY_LABELS[agent.hitlTierDefault] ?? `Tier ${agent.hitlTierDefault}`}
              </span>
            </div>
            <p className="mt-1 text-dpf-body text-[var(--dpf-muted)]">
              {kindLabel}
              {agent.portfolio?.name ? ` · ${agent.portfolio.name}` : ""}
              {agent.humanSupervisorId ? ` · reports to ${agent.humanSupervisorId}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AskCoworkerButton
              routeContext={detailRoute}
              label={`Ask ${agent.displayName}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-accent-contrast,white)] hover:brightness-95"
            >
              <MessageSquare aria-hidden className="h-4 w-4" />
              <span>{`Ask ${agent.displayName}`}</span>
            </AskCoworkerButton>
            <ShareIdentity
              displayName={agent.displayName}
              role={kindLabel}
              summary={shareSummary}
              identityPath={detailRoute}
              agentCardPath={agentCardPath}
            />
            <Link
              href={adminRecord}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
            >
              <Settings2 aria-hidden className="h-4 w-4" />
              Manage
            </Link>
          </div>
        </div>

        {/* The definition: what it does / why it's here / why it's valuable. */}
        {agent.description && (
          <p className="mt-3 max-w-[70ch] text-dpf-body-lg text-[var(--dpf-text)]">{agent.description}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
          {agent.valueStream && <ValueItem label="Value stream" value={titleCase(agent.valueStream)} />}
          {agent.delegatesTo?.length > 0 && (
            <ValueItem label="Delegates to" value={agent.delegatesTo.join(" · ")} />
          )}
          {agent.escalatesTo && <ValueItem label="Escalates to" value={agent.escalatesTo} />}
          {teamName && <ValueItem label="Owning team" value={teamName} />}
        </div>

        <details className="mt-3 border-b border-[var(--dpf-border)] pb-2">
          <summary className="min-h-11 cursor-pointer py-2 text-xs font-medium text-[var(--dpf-muted)]">
            Technical identity
          </summary>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pb-2 text-xs text-[var(--dpf-muted)]">
            <span>
              ID: <code>{agent.agentId}</code>
            </span>
            {record.gaid && (
              <span>
                GAID: <code>{record.gaid}</code>
              </span>
            )}
            {agent.slugId && (
              <span>
                Slug: <code>{agent.slugId}</code>
              </span>
            )}
            <span>{titleCase(agent.lifecycleStage)}</span>
          </div>
        </details>
      </header>

      {/* At-a-glance numbers */}
      <section
        className="grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] sm:grid-cols-3 lg:grid-cols-6"
        aria-label="At a glance"
      >
        <Kpi label="Skills" value={String(skillCount)} sub="assigned" />
        <Kpi label="Tools" value={String(toolCount)} sub="grants" />
        <Kpi
          label="Engagements"
          value={String(engagements.totals.total)}
          sub={`${engagements.totals.open} open`}
        />
        <Kpi label={`Cost · ${cost.window.days}d`} {...costGlance(cost)} />
        <Kpi
          label="Teams / rooms"
          value={String(teams.totals.total)}
          sub={teams.totals.leads > 0 ? `leads ${teams.totals.leads}` : "collaboration"}
        />
        <Kpi label="Status" value={titleCase(agent.status)} sub={titleCase(agent.lifecycleStage)} />
      </section>

      {/* Behaviour settings — summary until you change. */}
      <section className="mt-4 grid gap-3 lg:grid-cols-2" aria-label="Behaviour settings">
        <details className="overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
            <span className="text-sm font-semibold text-[var(--dpf-text)]">Priority · Cost / Quality / Time</span>
            <span className="ml-auto text-xs font-medium text-[var(--dpf-accent)]">Change ▾</span>
          </summary>
          <div className="border-t border-[var(--dpf-border)] px-4 py-4">
            <CoworkerPriorityControl agentId={agent.agentId} inheritance={inheritance} canWrite={canWrite} />
          </div>
        </details>
        <details className="overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
            <span className="text-sm font-semibold text-[var(--dpf-text)]">Proactivity</span>
            <span className="ml-auto text-xs font-medium text-[var(--dpf-accent)]">Change ▾</span>
          </summary>
          <div className="border-t border-[var(--dpf-border)] px-4 py-4">
            <CoworkerProactivityNote />
          </div>
        </details>
      </section>

      {/* Facets — collapsed to a one-line summary until opened. */}
      <div className="mt-5 flex flex-col gap-3">
        <Facet
          title="Who has engaged it"
          isNew
          empty={engagements.totals.total === 0}
          emptyLabel="No one has engaged it yet"
          summary={`${engagements.totals.total} · ${engagements.totals.people} people · ${engagements.totals.agents} agents`}
        >
          <EngagementsFacetPanel summary={engagements} />
        </Facet>

        <Facet
          title="Cost"
          isNew
          empty={!hasCostActivity(cost)}
          emptyLabel={`No recorded usage in ${cost.window.days}d`}
          summary={costFacetSummary(cost)}
        >
          <CostFacetPanel summary={cost} />
        </Facet>

        <Facet
          title="Teams & collaboration"
          isNew
          empty={teams.totals.total === 0}
          emptyLabel="Not in any team yet"
          summary={`${teams.totals.total} room${teams.totals.total === 1 ? "" : "s"}${teams.totals.leads > 0 ? ` · leads ${teams.totals.leads}` : ""}`}
        >
          <TeamsFacetPanel summary={teams} />
        </Facet>

        <Facet title="Skills & capabilities" summary={`${skillCount} skills · ${toolCount} tools`}>
          <div className="text-dpf-body text-[var(--dpf-text-secondary)]">
            <p className="m-0">
              {skillCount} skill{skillCount === 1 ? "" : "s"} and {toolCount} tool grant{toolCount === 1 ? "" : "s"}{" "}
              held.
            </p>
            <Link href={adminRecord} className="mt-3 inline-block text-xs font-semibold text-[var(--dpf-accent)]">
              Grant or revoke on the record →
            </Link>
          </div>
        </Facet>
      </div>
    </div>
  );
}
