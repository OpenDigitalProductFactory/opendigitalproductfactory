"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@dpf/i18n";

import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { ConsequenceNotice, FormStatus, TextField, TextareaField } from "@/components/ui/form";
import { ExpandableCard, StatusBadge } from "@/components/ui/report-kit";
import {
  grantAcceptanceSweepCloseAuthorisation,
  revokeAcceptanceSweepCloseAuthorisation,
} from "@/lib/actions/acceptance-sweep-close-authorisation";
import type { CloseAuthorisationView } from "@/lib/backlog/acceptance-sweep/close-authorisation-view";
import { useT } from "@/lib/i18n/use-t";

// BI-C2467A2E: the one screen where an operator lets the daily acceptance sweep
// close items whose completion gate already allows it, or stops it. It calls
// the existing governed server actions (BI-45D3BBF4); the page renders it only
// for people holding both manage_platform and manage_backlog, and the actions
// check both again. Copy lives in the "admin" catalog under closeAuthorisation;
// the page provides that namespace.
//
// Progressive disclosure (PR #6070 UX route sweep): on arrival the card shows
// only its title, the On/Off badge and one status line, so it adds a dozen words
// and no field to /admin/platform-development. The explanation, the who/when/why
// detail, the limit and the reason form open behind the shared ExpandableCard.

/** The sweep's disabledReason codes, worded from the catalog. */
const OFF_REASON_KEY: Record<string, MessageKey<"admin">> = {
  "not-recorded": "closeAuthorisation.offReason.notRecorded",
  revoked: "closeAuthorisation.offReason.revoked",
  malformed: "closeAuthorisation.offReason.malformed",
  "out-of-scope": "closeAuthorisation.offReason.outOfScope",
  "operator-not-authorised": "closeAuthorisation.offReason.operatorNotAuthorised",
  "agent-not-granted": "closeAuthorisation.offReason.agentNotGranted",
  unavailable: "closeAuthorisation.offReason.unavailable",
};

type T = ReturnType<typeof useT<"admin">>;

function lastRunOutcome(t: T, lastRun: NonNullable<CloseAuthorisationView["lastRun"]>): string {
  if (!lastRun.closingWasOn) {
    const why = t((lastRun.offReason && OFF_REASON_KEY[lastRun.offReason]) || "closeAuthorisation.offReason.other");
    return t("closeAuthorisation.lastRunNothing", { why });
  }
  return [
    t("closeAuthorisation.lastRunClosed", { closed: String(lastRun.closed) }),
    lastRun.refused ? t("closeAuthorisation.lastRunRefused", { refused: String(lastRun.refused) }) : null,
    lastRun.deferredByLimit ? t("closeAuthorisation.lastRunDeferred", { deferred: String(lastRun.deferredByLimit) }) : null,
  ].filter(Boolean).join(", ");
}

function LastRun({ t, lastRun }: { t: T; lastRun: CloseAuthorisationView["lastRun"] }) {
  if (!lastRun) return <p className="text-xs text-[var(--dpf-muted)]">{t("closeAuthorisation.lastRunNone")}</p>;
  return (
    <p className="text-xs text-[var(--dpf-muted)]">
      {t("closeAuthorisation.lastRunPrefix")} <LocalTime value={lastRun.ranAt} />: {lastRunOutcome(t, lastRun)}
    </p>
  );
}

function Provenance({ t, view, on }: { t: T; view: CloseAuthorisationView; on: boolean }) {
  if (!view.grant) return null;
  const term = "text-[var(--dpf-muted)]";
  const detail = "text-[var(--dpf-text)]";
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className={term}>{t("closeAuthorisation.allowedBy")}</dt>
      <dd className={detail}>
        {view.grant.by}, <LocalTime value={view.grant.at} />
      </dd>
      <dt className={term}>{t("closeAuthorisation.reason")}</dt>
      <dd className={detail}>{view.grant.reason}</dd>
      {on && (
        <>
          <dt className={term}>{t("closeAuthorisation.limit")}</dt>
          <dd className={detail}>{t("closeAuthorisation.limitValue", { limit: String(view.limit) })}</dd>
        </>
      )}
      {view.revocation && (
        <>
          <dt className={term}>{t("closeAuthorisation.stoppedBy")}</dt>
          <dd className={detail}>
            {view.revocation.by}, <LocalTime value={view.revocation.at} />
            {view.revocation.reason ? `: ${view.revocation.reason}` : ""}
          </dd>
        </>
      )}
    </dl>
  );
}

/** The one status line visible on arrival. */
function Summary({ t, view, on }: { t: T; view: CloseAuthorisationView; on: boolean }) {
  const lastClosed =
    view.lastRun?.closingWasOn ? ` ${t("closeAuthorisation.summary.lastClosed", { closed: String(view.lastRun.closed) })}` : "";
  if (on && view.grant) {
    return (
      <>
        {t("closeAuthorisation.summary.on", { by: view.grant.by })} <LocalTime value={view.grant.at} mode="date" />.{lastClosed}
      </>
    );
  }
  if (view.recordProblem) return <>{t("closeAuthorisation.summary.recordProblem")}</>;
  if (view.revocation) {
    return (
      <>
        {t("closeAuthorisation.summary.stopped", { by: view.revocation.by })} <LocalTime value={view.revocation.at} mode="date" />.
      </>
    );
  }
  return <>{t("closeAuthorisation.summary.off")}</>;
}

export function AcceptanceSweepCloseAuthorisationCard({ view }: { view: CloseAuthorisationView }) {
  const t = useT("admin");
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [limit, setLimit] = useState(String(view.limit));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const on = view.state === "on";
  const reasonShort = reason.trim().length < view.minReasonLength;

  const submit = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = on
          ? await revokeAcceptanceSweepCloseAuthorisation({ reason })
          : await grantAcceptanceSweepCloseAuthorisation({ reason, maxClosuresPerRun: Number(limit) });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setReason("");
        setSuccess(t(on ? "closeAuthorisation.successRevoke" : "closeAuthorisation.successGrant"));
        router.refresh();
      } catch {
        setError(t("closeAuthorisation.notPermitted"));
      }
    });
  };

  return (
    <div className="max-w-xl" data-testid="acceptance-close-authorisation">
      <ExpandableCard
        id="acceptance-close-authorisation"
        open={open}
        onOpenChange={setOpen}
        headingLevel={2}
        panelClassName="space-y-4"
        summary={
          <>
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--dpf-text)]">{t("closeAuthorisation.heading")}</span>
              <StatusBadge intent={on ? "success" : "neutral"} label={t(on ? "closeAuthorisation.on" : "closeAuthorisation.off")} />
            </span>
            <span className={`mt-1 block text-xs ${view.recordProblem ? "text-[var(--dpf-warning)]" : "text-[var(--dpf-muted)]"}`}>
              <Summary t={t} view={view} on={on} />
            </span>
          </>
        }
      >
        <p className="text-xs text-[var(--dpf-muted)]">{t("closeAuthorisation.intro")}</p>

        {view.recordProblem && <p className="text-xs text-[var(--dpf-warning)]">{t("closeAuthorisation.recordProblem")}</p>}

        <Provenance t={t} view={view} on={on} />
        <LastRun t={t} lastRun={view.lastRun} />

        <div className="space-y-3">
          <TextareaField
            name="close-authorisation-reason"
            label={t(on ? "closeAuthorisation.reasonRevoke" : "closeAuthorisation.reasonGrant")}
            value={reason}
            onValueChange={setReason}
            required
            rows={2}
            hint={t("closeAuthorisation.reasonHint", { min: String(view.minReasonLength) })}
          />
          {!on && (
            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--dpf-accent)]">
                {t("closeAuthorisation.limitDisclosure", { limit })}
              </summary>
              <TextField
                className="mt-2"
                name="close-authorisation-limit"
                label={t("closeAuthorisation.limitField")}
                type="number"
                min={1}
                max={view.maxLimit}
                value={limit}
                onValueChange={setLimit}
                hint={t("closeAuthorisation.limitHint", { max: String(view.maxLimit) })}
              />
            </details>
          )}
          <ConsequenceNotice
            summary={t(on ? "closeAuthorisation.consequence.summaryRevoke" : "closeAuthorisation.consequence.summaryGrant")}
            what={t("closeAuthorisation.consequence.what")}
            who={t("closeAuthorisation.consequence.who")}
            reversibility={t(on ? "closeAuthorisation.consequence.reversibilityRevoke" : "closeAuthorisation.consequence.reversibilityGrant")}
            recovery={t("closeAuthorisation.consequence.recovery")}
          />
          <FormStatus error={error} success={success} />
          <Button
            type="button"
            variant={on ? "danger" : "primary"}
            size="sm"
            onClick={submit}
            disabled={isPending || reasonShort}
            aria-busy={isPending || undefined}
          >
            {t(isPending ? "closeAuthorisation.saving" : on ? "closeAuthorisation.stop" : "closeAuthorisation.allow")}
          </Button>
        </div>
      </ExpandableCard>
    </div>
  );
}
