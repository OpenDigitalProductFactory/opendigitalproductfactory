import { Surface } from "@/components/ui/Surface";
import { StatusBadge } from "@/components/ui/report-kit";
import type { ApprovalOutcome } from "@/lib/coworker/approval-outcome";
import { SOURCE_CATALOG } from "@dpf/i18n";

type Copy = Record<"result" | "recent" | "unavailable" | "details" | "open", string>;

/** Read-only history; these are not fresh decisions and do not enter the queue. */
export function ApprovalOutcomeHistory({ outcomes, exact = false, copy = SOURCE_CATALOG.approvals }: { outcomes: ApprovalOutcome[]; exact?: boolean; copy?: Copy }) {
  if (!outcomes.length && !exact) return null;
  return (
    <details id="approval-result" open={exact} className="scroll-mt-4">
      <summary className="cursor-pointer py-3 text-dpf-body font-dpf-medium text-dpf-text">
        {exact ? copy.result : copy.recent}
      </summary>
      <div className="space-y-3">
        {!outcomes.length ? <p className="text-dpf-body text-dpf-muted">{copy.unavailable}</p> : null}
        {outcomes.map((outcome) => (
          <Surface key={outcome.envelopeId} padding="sm" rounded="md">
            <StatusBadge label={outcome.label} intent={outcome.state === "executed" ? "success" : "neutral"} />
            <p className="mt-2 text-dpf-body text-dpf-text">{outcome.nextAction}</p>
            <details className="mt-2 text-dpf-caption text-dpf-muted">
              <summary className="cursor-pointer py-2">{copy.details}</summary>
              <p className="break-all">{outcome.envelopeId}</p>
              <time dateTime={outcome.createdAtIso}>{outcome.createdAtIso}</time>
              <p><a className="underline" href={outcome.inboxHref}>{copy.open}</a></p>
            </details>
          </Surface>
        ))}
      </div>
    </details>
  );
}
