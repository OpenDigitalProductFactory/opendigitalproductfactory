"use client";

import { EmptyState, Notice, StatusBadge } from "@/components/ui/report-kit";
import { useT } from "@/lib/i18n/use-t";
import type { WorkroomView } from "@/lib/work-management/room-types";

const disclosureClass = "min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-dpf-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]";

/** Present the authorized profile; composing requirements never assesses them. */
export function WorkroomReviewRequirements({ profile }: { profile?: WorkroomView["reviewProfile"] }) {
  const source = profile?.source;
  const subject = profile?.subject?.status === "resolved" ? profile.subject : null;
  const t = useT("workrooms");

  return (
    <section aria-label={t("reviewProfile.section")} className="rounded-dpf-xl border border-dpf-border bg-dpf-surface-1">
      <details>
        <summary className={disclosureClass}>{t("reviewProfile.requirements")}</summary>
        <div className="space-y-4 border-t border-dpf-border px-4 py-4">
          <StatusBadge intent="neutral" label={t("reviewProfile.notAssessed")} variant="soft" />
          <p className="text-sm text-dpf-muted">{t("reviewProfile.organizationFit")}</p>
          <p className="text-sm text-dpf-muted">{t("reviewProfile.requirementsBoundary")}</p>
          {!source ? (
            <EmptyState size="sm" bordered={false} title={t("reviewProfile.missingTitle")}
              description={t("reviewProfile.missingDescription")} />
          ) : source.status !== "resolved" ? (
            <Notice variant="warn" title={source.status === "unsupported"
              ? t("reviewProfile.unsupported") : t("reviewProfile.conflicting")}>
              <p>{t("reviewProfile.reconcile")}</p>
            </Notice>
          ) : null}
          {source ? (
            <>
              <ul className="space-y-4">
                {source.requirements.map((requirement) => (
                  <li key={requirement.ref} className="space-y-2 border-s-2 border-dpf-border ps-3 text-sm">
                    <p className="font-dpf-medium text-dpf-text">{requirement.outcome}</p>
                    <p className="text-dpf-muted">{t("reviewProfile.compareAgainst", { denominator: requirement.denominator })}</p>
                    <details>
                      <summary className="min-h-11 cursor-pointer py-3 text-dpf-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
                        {t("reviewProfile.evidenceDisclosure")}
                      </summary>
                      <dl className="space-y-2 break-words text-dpf-muted">
                        <div><dt>{t("reviewProfile.evidence")}</dt><dd>{requirement.evidence.join(", ") || t("reviewProfile.notRecorded")}</dd></div>
                        <div><dt>{t("reviewProfile.failures")}</dt><dd>{requirement.criticalFailures.join(", ") || t("reviewProfile.notRecorded")}</dd></div>
                        <div><dt>{t("reviewProfile.inheritedFrom")}</dt><dd>{requirement.provenance.join(", ")}</dd></div>
                        {requirement.maxAgeSeconds !== undefined ? (
                          <div><dt>{t("reviewProfile.maximumAge")}</dt><dd>{t("reviewProfile.seconds", { count: requirement.maxAgeSeconds })}</dd></div>
                        ) : null}
                      </dl>
                    </details>
                  </li>
                ))}
              </ul>
              <details>
                <summary className="min-h-11 cursor-pointer py-3 text-sm text-dpf-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
                  {t("reviewProfile.identityDisclosure")}
                </summary>
                <dl className="space-y-2 break-all text-sm text-dpf-muted">
                  <div><dt>{t("reviewProfile.definition")}</dt><dd>{source.identity
                    ? t("reviewProfile.definitionVersion", { source: source.identity.sourceKey, version: source.identity.definitionVersion }) : t("reviewProfile.unavailable")}</dd></div>
                  <div><dt>{t("reviewProfile.subjectScope")}</dt><dd>{t(subject ? "reviewProfile.subjectFound" : "reviewProfile.subjectUnavailable")}</dd></div>
                  {subject ? (
                    <>
                      <div><dt>{t("reviewProfile.subjectOrganization")}</dt><dd>{subject.organizationId}</dd></div>
                      <div><dt>{t("reviewProfile.subjectArchetype")}</dt><dd>{subject.primary.slug} · {subject.primary.category}</dd></div>
                      <div><dt>{t("reviewProfile.subjectComposition")}</dt><dd>{t("reviewProfile.subjectCompositionCounts", {
                        unresolved: subject.compositions.filter(row => row.applicability === "unknown").length,
                        excluded: subject.compositions.filter(row => row.applicability === "excluded").length,
                      })}</dd></div>
                      <div><dt>{t("reviewProfile.subjectFingerprint")}</dt><dd>{subject.fingerprint}</dd></div>
                    </>
                  ) : null}

                  <div><dt>{t("reviewProfile.fingerprint")}</dt><dd>{source.fingerprint ?? t("reviewProfile.unresolved")}</dd></div>
                  <div><dt>{t("reviewProfile.sources")}</dt><dd>{source.provenance.join(", ")}</dd></div>
                  <div><dt>{t("reviewProfile.references")}</dt><dd>{source.conflicts.join(", ") || t("reviewProfile.noConflicts")}</dd></div>
                </dl>
              </details>
            </>
          ) : null}
        </div>
      </details>
      <details className="border-t border-dpf-border">
        <summary className={disclosureClass}>{t("reviewProfile.improvement")}</summary>
        <div className="space-y-2 border-t border-dpf-border px-4 py-4 text-sm text-dpf-muted">
          <p>{t("reviewProfile.noAssessment")}</p>
          <p>{t("reviewProfile.assessmentNeeds")}</p>
          <p>{t("reviewProfile.receiptBoundary")}</p>
        </div>
      </details>
    </section>
  );
}
