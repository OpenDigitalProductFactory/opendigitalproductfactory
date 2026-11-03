import { getT } from "@/lib/i18n/t.server";
import { LocalTime } from "@/components/ui/LocalTime";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import type { DeliveryAgreementView } from "@/lib/work-management/delivery-agreement";

/** Detail of the existing outcome band, never a second completion authority. */
export async function WorkroomDeliveryAgreement({ view }: { view: DeliveryAgreementView | null | undefined }) {
  if (!view) return null;
  const t = await getT("deliveryAgreements");
  const delivered = view.disposition === "delivered";
  return (
    <div className="mt-2 text-dpf-body text-dpf-muted">
      <StatusBadge size="md" intent={delivered ? "success" : view.disposition === "closed-without-handoff" ? "warning" : "info"}
        label={delivered ? t("delivered") : view.disposition === "closed-without-handoff" ? t("handoffMissing") : t("inProgress")} />
      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-dpf-medium text-dpf-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dpf-accent">
          {t("details")}
        </summary>
        <div className="space-y-4 pb-2">
          <p>{t("agreed")} <LocalTime value={view.capturedAt} mode="datetime" />.</p>
          {view.objectiveChanged ? <Notice variant="info">{t("changed")}</Notice> : null}
          {view.acceptance ? <section aria-label={t("acceptanceAria")}>
            <h3 className="font-dpf-semibold text-dpf-text">{t("acceptance")}</h3>
            <ul className="mt-2 list-disc space-y-2 ps-5">{view.acceptance.criteria.map((criterion, i) => <li key={i}>{criterion}</li>)}</ul>
            <p className="mt-2 break-all text-dpf-caption">{t("sourceIdentity", { digest: view.acceptance.digest })}</p>
          </section> : <p>{t("noAcceptance")}</p>}
          <section aria-label={t("contextAria")}>
            <h3 className="font-dpf-semibold text-dpf-text">{t("context")}</h3>
            <p>{view.context.peerRef ?? t("unresolvedPeer")}</p>
            <Notice variant={view.context.guidanceState === "unavailable" ? "warn" : "info"}>{view.context.reason}</Notice>
            <p className="mt-2">{t("checked")} <LocalTime value={view.context.checkedAt} mode="datetime" />.</p>
            {view.context.sourceRefs.length ? <ul className="mt-2 break-words text-dpf-caption">{view.context.sourceRefs.map(ref => <li key={ref}>{ref}</li>)}</ul> : null}
          </section>
          {view.handoff ? <section aria-label={t("handoff")}>
            <h3 className="font-dpf-semibold text-dpf-text">{t("handoff")}</h3>
            <p>{view.handoff.summary}</p>
            <p>{t("completed")} <LocalTime value={view.handoff.completedAt} mode="datetime" />.</p>
            <p className="break-words">{t("evidence", { refs: view.handoff.evidenceRefs.join(", ") })}</p>
            {view.followOnRefs.length ? <><p className="mt-2">{t("followOn")}</p>
              <ul>{view.followOnRefs.map(ref => <li key={ref}>{/^BI-[A-Z0-9-]+$/i.test(ref)
                ? <a className="inline-flex min-h-11 items-center text-dpf-accent underline" href={`/ops/backlog/${encodeURIComponent(ref)}`}>{ref}</a> : ref}</li>)}</ul></> : null}
          </section> : null}
        </div>
      </details>
    </div>
  );
}
