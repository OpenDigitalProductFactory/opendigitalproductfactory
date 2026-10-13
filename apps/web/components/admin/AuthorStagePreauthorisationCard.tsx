"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { ConsequenceNotice, FormStatus, TextareaField } from "@/components/ui/form";
import { ExpandableCard, StatusBadge } from "@/components/ui/report-kit";
import { grantAuthorStagePreauthorisation, revokeAuthorStagePreauthorisation } from "@/lib/actions/author-stage-preauthorisation";
import type { AuthorStagePreauthorisationView } from "@/lib/work-management/author-stage-preauthorisation-view";
import { useT } from "@/lib/i18n/use-t";

// BI-8A32EBFF: where an operator lets the Workroom drive give funded author
// stages to an agent, or stops it. Same shape as the acceptance sweep's close
// card (AcceptanceSweepCloseAuthorisationCard): collapsed to a title, an On/Off
// badge and one status line; the explanation, provenance and reason form open
// behind the shared ExpandableCard. Copy: "admin" catalog, authorStagePreauthorisation.

type T = ReturnType<typeof useT<"admin">>;

function Provenance({ t, view }: { t: T; view: AuthorStagePreauthorisationView }) {
  if (!view.grant) return null;
  const term = "text-[var(--dpf-muted)]";
  const detail = "text-[var(--dpf-text)]";
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className={term}>{t("authorStagePreauthorisation.allowedBy")}</dt>
      <dd className={detail}>
        {view.grant.by}, <LocalTime value={view.grant.at} />
      </dd>
      <dt className={term}>{t("authorStagePreauthorisation.reason")}</dt>
      <dd className={detail}>{view.grant.reason}</dd>
      {view.revocation && (
        <>
          <dt className={term}>{t("authorStagePreauthorisation.stoppedBy")}</dt>
          <dd className={detail}>
            {view.revocation.by}, <LocalTime value={view.revocation.at} />
            {view.revocation.reason ? `: ${view.revocation.reason}` : ""}
          </dd>
        </>
      )}
    </dl>
  );
}

function Summary({ t, view, on }: { t: T; view: AuthorStagePreauthorisationView; on: boolean }) {
  if (on && view.grant) {
    return <>{t("authorStagePreauthorisation.summary.on", { by: view.grant.by })} <LocalTime value={view.grant.at} mode="date" />.</>;
  }
  if (view.recordProblem) return <>{t("authorStagePreauthorisation.summary.recordProblem")}</>;
  if (view.revocation) {
    return <>{t("authorStagePreauthorisation.summary.stopped", { by: view.revocation.by })} <LocalTime value={view.revocation.at} mode="date" />.</>;
  }
  return <>{t("authorStagePreauthorisation.summary.off")}</>;
}

export function AuthorStagePreauthorisationCard({ view }: { view: AuthorStagePreauthorisationView }) {
  const t = useT("admin");
  const router = useRouter();
  const [reason, setReason] = useState("");
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
        const result = on ? await revokeAuthorStagePreauthorisation({ reason }) : await grantAuthorStagePreauthorisation({ reason });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setReason("");
        setSuccess(t(on ? "authorStagePreauthorisation.successRevoke" : "authorStagePreauthorisation.successGrant"));
        router.refresh();
      } catch {
        setError(t("authorStagePreauthorisation.notPermitted"));
      }
    });
  };

  return (
    <div className="max-w-xl" data-testid="author-stage-preauthorisation">
      <ExpandableCard
        id="author-stage-preauthorisation"
        open={open}
        onOpenChange={setOpen}
        headingLevel={2}
        panelClassName="space-y-4"
        summary={
          <>
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--dpf-text)]">{t("authorStagePreauthorisation.heading")}</span>
              <StatusBadge intent={on ? "success" : "neutral"} label={t(on ? "authorStagePreauthorisation.on" : "authorStagePreauthorisation.off")} />
            </span>
            <span className={`mt-1 block text-xs ${view.recordProblem ? "text-[var(--dpf-warning)]" : "text-[var(--dpf-muted)]"}`}>
              <Summary t={t} view={view} on={on} />
            </span>
          </>
        }
      >
        <p className="text-xs text-[var(--dpf-muted)]">{t("authorStagePreauthorisation.intro")}</p>
        {view.recordProblem && <p className="text-xs text-[var(--dpf-warning)]">{t("authorStagePreauthorisation.recordProblem")}</p>}
        <Provenance t={t} view={view} />
        <div className="space-y-3">
          <TextareaField
            name="author-stage-preauthorisation-reason"
            label={t(on ? "authorStagePreauthorisation.reasonRevoke" : "authorStagePreauthorisation.reasonGrant")}
            value={reason}
            onValueChange={setReason}
            required
            rows={2}
            hint={t("authorStagePreauthorisation.reasonHint", { min: String(view.minReasonLength) })}
          />
          <ConsequenceNotice
            summary={t(on ? "authorStagePreauthorisation.consequence.summaryRevoke" : "authorStagePreauthorisation.consequence.summaryGrant")}
            what={t("authorStagePreauthorisation.consequence.what")}
            who={t("authorStagePreauthorisation.consequence.who")}
            reversibility={t(on ? "authorStagePreauthorisation.consequence.reversibilityRevoke" : "authorStagePreauthorisation.consequence.reversibilityGrant")}
            recovery={t("authorStagePreauthorisation.consequence.recovery")}
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
            {t(isPending ? "authorStagePreauthorisation.saving" : on ? "authorStagePreauthorisation.stop" : "authorStagePreauthorisation.allow")}
          </Button>
        </div>
      </ExpandableCard>
    </div>
  );
}
