// Decision drill-in — the full audit record for one DecisionInteraction:
// what was asked, the options weighed, what was recommended and why (top
// principle contributors), flags, and any human resolution.
// Server component; queries Prisma directly.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";

import { StatusBadge } from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import { TIER_LABELS, tierForRow } from "@/lib/wiki/decision-audit";
import { buildDecisionHelp } from "@/lib/wiki/decision-help";
import { isWithdrawnHumanOutcome } from "@/lib/quality/decision-residue-staleness";
import {
  buildDecisionOriginCopy,
  resolveDecisionOrigin,
  type DecisionOriginDb,
} from "@/lib/decision/decision-origin";
import { presentProposal } from "@/lib/decision/proposal-presentation";
import { getOpenProposalForInteraction, type ProposalClient } from "@/lib/decision/resolution-proposal-store";
import { ProposalCard } from "./proposal-card";
import {
  buildOptionConsequences,
  consequencesByOption,
  parseScoredOptions,
  CONSEQUENCE_LABELS,
} from "@/lib/decision/option-consequences";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Decision record",
};

type Params = Promise<{ interactionId: string }>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type Contributor = {
  principleId: string;
  principleName: string;
  tier: string;
  contribution: number;
};

function readContributors(payload: Record<string, unknown>): Contributor[] {
  if (!Array.isArray(payload.topContributors)) return [];
  return payload.topContributors
    .map((entry) => {
      const c = asRecord(entry);
      return typeof c.principleId === "string" && typeof c.contribution === "number"
        ? {
          principleId: c.principleId,
          principleName: typeof c.principleName === "string" ? c.principleName : c.principleId,
          tier: typeof c.tier === "string" ? c.tier : "—",
          contribution: c.contribution,
        }
        : null;
    })
    .filter((c): c is Contributor => Boolean(c));
}

export default async function DecisionRecordPage({ params }: { params: Params }) {
  const { interactionId } = await params;

  const row = await prisma.decisionInteraction.findUnique({
    where: { interactionId },
    include: {
      profile: { select: { kind: true, name: true, profileId: true } },
      escalationCapture: true,
      deferralCapture: true,
    },
  });
  if (!row) notFound();

  // Where the decision came from, and what each option would cost. Both
  // degrade to nothing rather than guessing: an unresolvable origin says so,
  // and an unscored row keeps the bare option list it has always had.
  const origin = await resolveDecisionOrigin(prisma as unknown as DecisionOriginDb, row);
  const originCopy = buildDecisionOriginCopy(origin);
  const consequences = consequencesByOption(
    buildOptionConsequences(parseScoredOptions(row.scoredOptions)),
  );
  // A drafted resolution, when one exists. Absent for every decision no panel
  // has looked at, and the page reads exactly as it did before in that case.
  const proposalRow = await getOpenProposalForInteraction(
    prisma as unknown as ProposalClient,
    row.id,
  );
  // The panel roster lives on the run, not on the proposal — read it there so
  // the card can never claim a coworker the run did not actually seat.
  const panelRoster = proposalRow?.deliberationRunId
    ? (
      await prisma.deliberationOutcome.findUnique({
        where: { deliberationRunId: proposalRow.deliberationRunId },
        select: { branchRoster: true },
      })
    )?.branchRoster ?? null
    : null;
  const proposal = proposalRow
    ? presentProposal({
      proposalId: proposalRow.proposalId,
      actionKind: proposalRow.actionKind,
      status: proposalRow.status,
      lifecycle: proposalRow.lifecycle,
      summary: proposalRow.summary,
      draftPayload: proposalRow.draftPayload,
      dissent: proposalRow.dissent,
      confidence: proposalRow.confidence,
      panelRoster,
    })
    : null;

  const tier = tierForRow(row);
  const tierLabel = TIER_LABELS[tier];
  const payload = asRecord(row.outcomePayload);
  const optionDescriptions = asRecord(payload.optionDescriptions);
  const contributors = readContributors(payload);
  const options = Array.isArray(row.options)
    ? row.options.filter((o): o is string => typeof o === "string")
    : [];
  const contextMissing = row.question.trim().length === 0;
  // Insufficient-signal consults (every contribution zero) carry no real
  // recommendation. New records set the explicit payload flag; records from
  // before the guard existed are recognised by their all-zero composite +
  // margin so the misleading "recommended" chip disappears from history too.
  const insufficientSignal =
    payload.insufficientSignal === true ||
    (typeof payload.recommendedOptionId === "string" &&
      payload.composite === 0 &&
      payload.margin === 0);
  const recommendedOptionId =
    !insufficientSignal && typeof payload.recommendedOptionId === "string"
      ? payload.recommendedOptionId
      : null;
  // Caller attribution — who brought this decision (client UA token /
  // coworker agent / thread), so the row matches back to the activity.
  const caller = asRecord(payload.caller);
  const callerParts = [
    typeof caller.client === "string" && caller.client ? caller.client : null,
    typeof caller.agentId === "string" && caller.agentId ? `agent ${caller.agentId}` : null,
    typeof caller.threadId === "string" && caller.threadId ? `thread ${caller.threadId}` : null,
    typeof caller.apiTokenId === "string" && caller.apiTokenId ? `token ${caller.apiTokenId}` : null,
    typeof payload.callingSurface === "string" && payload.callingSurface
      ? `surface ${payload.callingSurface}`
      : null,
  ].filter((p): p is string => p !== null);

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      <header className="mb-6">
        <Link href="/coworker-decisions/decisions" className="text-sm text-[var(--dpf-accent)] hover:underline">
          ← Decision log
        </Link>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <StatusBadge
            intent={tier === "wwmd" ? "info" : tier === "wwwd" ? "accent" : "neutral"}
            label={`${tierLabel.code} — ${tierLabel.expansion}`}
            variant="soft"
          />
          <StatusBadge domain="decisionOutcome" status={row.outcomeType} />
          <StatusBadge domain="decisionRisk" status={row.riskTier} variant="soft" />
          {row.principleConflict ? (
            <StatusBadge intent="danger" label="principle conflict" variant="soft" />
          ) : null}
          {insufficientSignal ? (
            <StatusBadge intent="warning" label="insufficient signal" variant="soft" />
          ) : null}
        </div>
        <h1 className="mt-3 text-xl font-semibold text-[var(--dpf-text)]">
          {row.question || "Incomplete record"}
        </h1>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          <LocalTime value={row.createdAt} /> · {row.profile?.name ?? row.profileId} ·{" "}
          {row.routeContext ?? "—"} · {row.domainClass} · {row.interactionId}
        </p>
        {callerParts.length > 0 ? (
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Caller: {callerParts.join(" · ")}
          </p>
        ) : null}
      </header>

      {/* Where this came from — the work behind the question (BI-6700AF66). */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-2">
          {originCopy.heading}
        </h2>
        {originCopy.unresolved ? (
          <p className="text-sm text-[var(--dpf-muted)]">{originCopy.unresolved}</p>
        ) : (
          <dl className="rounded-lg border border-[var(--dpf-border)] p-3 text-sm">
            {originCopy.lines.map((line) => (
              <div key={line.label} className="flex gap-2 py-0.5">
                <dt className="w-40 shrink-0 text-xs text-[var(--dpf-muted)]">{line.label}</dt>
                <dd className="min-w-0 text-[var(--dpf-text)]">
                  {line.href ? (
                    <Link href={line.href} className="text-[var(--dpf-accent)] hover:underline">
                      {line.value}
                    </Link>
                  ) : (
                    line.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {originCopy.basis ? (
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{originCopy.basis}</p>
        ) : null}
        {originCopy.recurrence ? (
          <p className="mt-1 text-xs text-[var(--dpf-warning)]">{originCopy.recurrence}</p>
        ) : null}
      </section>

      {/* Options weighed */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-2">
          Options weighed
        </h2>
        {options.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No options recorded.</p>
        ) : (
          <ul className="space-y-2">
            {options.map((optionId) => {
              const description = optionDescriptions[optionId];
              const isRecommended = optionId === recommendedOptionId;
              return (
                <li
                  key={optionId}
                  className={`rounded-lg border p-3 ${
                    isRecommended
                      ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)]"
                      : "border-[var(--dpf-border)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-[var(--dpf-text)]">{optionId}</span>
                    {isRecommended ? (
                      <StatusBadge intent="success" label="recommended" variant="soft" />
                    ) : null}
                  </div>
                  {typeof description === "string" && description ? (
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">{description}</p>
                  ) : null}
                  {(() => {
                    // Only present when the gate scored real feature vectors
                    // AND the option separates from the field. Otherwise the
                    // option renders exactly as it did before.
                    const c = consequences.get(optionId);
                    if (!c) return null;
                    return (
                      <div className="mt-2 flex flex-col gap-1 text-xs">
                        {c.strengths.length > 0 ? (
                          <p className="text-[var(--dpf-muted)]">
                            <span className="text-[var(--dpf-success)]">
                              {CONSEQUENCE_LABELS.strengths}
                            </span>
                            {`: ${c.strengths.join("; ")}.`}
                          </p>
                        ) : null}
                        {c.costs.length > 0 ? (
                          <p className="text-[var(--dpf-muted)]">
                            <span className="text-[var(--dpf-warning)]">
                              {CONSEQUENCE_LABELS.costs}
                            </span>
                            {`: ${c.costs.join("; ")}.`}
                          </p>
                        ) : null}
                      </div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Why */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-2">
          Why
        </h2>
        <p className="text-sm text-[var(--dpf-text)] whitespace-pre-wrap">
          {row.rationale || "No rationale recorded."}
        </p>
        {insufficientSignal ? (
          <p className="mt-2 text-sm text-[var(--dpf-warning)]">
            No option was actually scored: every principle contribution was
            zero, so no recommendation stands. This usually means the consult
            was submitted without per-option feature values. The decision
            needs an owner decision — or a re-run with scoreable options.
          </p>
        ) : null}
        {contributors.length > 0 ? (
          <div className="mt-3 rounded-lg border border-[var(--dpf-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--dpf-muted)] border-b border-[var(--dpf-border)]">
                  <th className="px-3 py-2 font-medium">Principle</th>
                  <th className="px-3 py-2 font-medium">Tier</th>
                  <th className="px-3 py-2 font-medium text-right">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((c) => (
                  <tr key={c.principleId} className="border-b border-[var(--dpf-border)] last:border-0">
                    <td className="px-3 py-2 text-[var(--dpf-text)]">{c.principleName}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{c.tier}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        c.contribution < 0 ? "text-[var(--dpf-error)]" : "text-[var(--dpf-text)]"
                      }`}
                    >
                      {c.contribution.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* Human resolution */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-2">
          Employee review
        </h2>
        {proposal ? (
          <div className="mb-3">
            <ProposalCard proposal={proposal} />
          </div>
        ) : null}
        {row.escalationCapture ? (
          <div className="rounded-lg border border-[var(--dpf-border)] p-3 text-sm">
            <p className="text-[var(--dpf-text)]">
              {row.escalationCapture.answer ?? "(resolved without an answer text)"}
            </p>
            {row.escalationCapture.rationale ? (
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                {row.escalationCapture.rationale}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-[var(--dpf-muted)]">
              Resolved <LocalTime value={row.escalationCapture.createdAt} />
            </p>
          </div>
        ) : row.deferralCapture ? (
          <p className="text-sm text-[var(--dpf-muted)]">
            Deferred — {row.deferralCapture.gapReason}. The perspective lacks material to answer;
            adding stance/principle coverage closes this gap.
          </p>
        ) : (
          // Plain-language "what do I do about this?" guidance (BI-404E9BEA) —
          // deterministic, so it holds even when the model runtime is down.
          (() => {
            const help = buildDecisionHelp({
              outcomeType: row.outcomeType,
              tier,
              riskTier: row.riskTier,
              principleConflict: row.principleConflict,
              insufficientSignal,
              hasBuild: Boolean(row.buildId),
              resolved: row.humanOutcome !== null,
              contextMissing,
              withdrawn: isWithdrawnHumanOutcome(row.humanOutcome),
              origin: { interactionId: row.interactionId, domainClass: row.domainClass },
            });
            const needsAction = help.steps.length > 0;
            return (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  needsAction ? "border-[var(--dpf-accent)]" : "border-[var(--dpf-border)]"
                }`}
              >
                <p className="text-[var(--dpf-text)]">{help.meaning}</p>
                <p className="mt-2 text-[var(--dpf-muted)]">{help.urgency}</p>
                {needsAction ? (
                  <ol className="mt-3 space-y-1.5 list-decimal pl-5">
                    {help.steps.map((step) => (
                      <li key={step.label} className="text-[var(--dpf-text)]">
                        {step.href ? (
                          <Link href={step.href} className="text-[var(--dpf-accent)] hover:underline">
                            {step.label}
                          </Link>
                        ) : (
                          step.label
                        )}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            );
          })()
        )}
      </section>
    </div>
  );
}
