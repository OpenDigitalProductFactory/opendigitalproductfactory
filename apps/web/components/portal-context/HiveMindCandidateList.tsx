"use client";

import { useState, useTransition } from "react";
import { invokePortalContextHiveCandidate } from "@/lib/actions/portal-context-hive";
import type { AuthoritySummary, HiveMindCandidate, PortalContextEnvelope } from "@/lib/portal-context";

type Props = {
  candidates: HiveMindCandidate[];
  work: PortalContextEnvelope["work"];
  authority: AuthoritySummary;
  routeContext: string;
  envelopeId: string;
};

export function HiveMindCandidateList({ candidates, work, authority, routeContext, envelopeId }: Props) {
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (candidates.length === 0) {
    return <p className="text-sm text-[var(--dpf-muted)]">No recommended coworkers</p>;
  }

  const parentTaskRunId = work.taskRun?.taskRunId ?? null;
  const granted = new Set(authority.grantedToolKeys);

  function invokeCandidate(candidate: HiveMindCandidate) {
    if (!parentTaskRunId) return;
    setPendingAgentId(candidate.agentId);
    setResultMessage(null);
    startTransition(() => {
      void (async () => {
        const result = await invokePortalContextHiveCandidate({
          parentTaskRunId,
          contextId: work.taskRun?.contextId ?? null,
          routeContext,
          envelopeId,
          candidate,
          anchors: {
            buildId: work.featureBuild?.buildId ?? null,
            capsuleId: work.capsule?.capsuleId ?? null,
            backlogItemId: work.backlogItem?.backlogItemId ?? null,
            epicId: work.epic?.epicId ?? null,
          },
        });
        if (result.ok) {
          setResultMessage(result.reused ? "Existing hive task reused" : "Hive task queued");
          if (result.threadId) {
            document.dispatchEvent(new CustomEvent("open-agent-panel", {
              detail: { targetThreadId: result.threadId },
            }));
          }
        } else {
          setResultMessage(result.error);
        }
        setPendingAgentId(null);
      })();
    });
  }

  return (
    <div className="grid gap-2">
      {resultMessage && (
        <p className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
          {resultMessage}
        </p>
      )}
      <ul className="grid gap-2">
        {candidates.map((candidate) => (
          <li key={`${candidate.agentId}:${candidate.role}`} className="border-b border-[var(--dpf-border)] pb-2 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[var(--dpf-text)]">{candidate.label}</span>
                  <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-xs text-[var(--dpf-muted)]">
                    {candidate.role}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">{candidate.reason}</p>
              </div>
              <CandidateAction
                candidate={candidate}
                disabledReason={disabledReason(candidate, granted, parentTaskRunId)}
                pending={isPending && pendingAgentId === candidate.agentId}
                onInvoke={() => invokeCandidate(candidate)}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidateAction({
  candidate,
  disabledReason,
  pending,
  onInvoke,
}: {
  candidate: HiveMindCandidate;
  disabledReason: string | null;
  pending: boolean;
  onInvoke: () => void;
}) {
  if (disabledReason) {
    return (
      <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
        {disabledReason}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onInvoke}
      disabled={pending}
      className="inline-flex min-h-9 items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-accent)] transition-colors hover:border-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
    >
      {pending ? "Queuing" : actionLabel(candidate)}
    </button>
  );
}

function disabledReason(candidate: HiveMindCandidate, granted: Set<string>, parentTaskRunId: string | null): string | null {
  if (!parentTaskRunId) return "Needs task";
  const missing = candidate.requiredGrantKeys.filter((grant) => !granted.has(grant));
  if (missing.length > 0) return "Missing grant";
  return null;
}

function actionLabel(candidate: HiveMindCandidate): string {
  if (candidate.activation === "required-before-promotion") return "Ask now";
  if (candidate.activation === "ask-now") return "Ask now";
  return "Queue";
}
