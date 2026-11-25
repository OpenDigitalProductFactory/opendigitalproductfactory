import type { ReactNode } from "react";
import { Notice } from "@/components/ui/report-kit/Notice";
import { LocalTime } from "@/components/ui/LocalTime";
import { useT } from "@/lib/i18n/use-t";
import type { UploadsBackupReadiness as UploadsReadinessData } from "@/lib/operate/backups/readiness";

export function UploadsBackupReadiness({ readiness }: { readiness: UploadsReadinessData }) {
  const t = useT("admin");
  const { lastRun, capturePair, pairedRestore } = readiness;
  const pairText = capturePair.status === "paired"
    ? t(capturePair.uploadsRunId === lastRun?.id ? "backups.uploads.latestPair" : "backups.uploads.earlierPair")
    : t(capturePair.status === "unverified" ? "backups.uploads.unverifiedPair" : "backups.uploads.noPair");

  return (
    <section className="grid gap-dpf-sm border-t border-dpf-border pt-dpf-sm" aria-labelledby="uploads-readiness">
      <h3 id="uploads-readiness" className="text-dpf-body font-dpf-semibold text-dpf-text">
        {t("backups.uploads.heading")}
      </h3>
      <dl className="grid gap-dpf-sm">
        <ReadinessLine label={t("backups.uploads.lastRun")} value={lastRun
          ? <>{t(`backups.uploads.run.${lastRun.status}`)} · <LocalTime value={lastRun.startedAt} /></>
          : t("backups.uploads.noRuns")} />
        <ReadinessLine label={t("backups.uploads.capturedPair")} value={pairText} />
        {pairedRestore.status === "no-unfinished" && (
          <ReadinessLine label={t("backups.uploads.pairedRestore")} value={t("backups.uploads.noUnfinished")} />
        )}
      </dl>
      {pairedRestore.status === "unreadable" && (
        <Notice variant="warn" title={t("backups.uploads.unreadable")}>
          {t("backups.uploads.followRecovery")}
        </Notice>
      )}
      {pairedRestore.status === "unfinished" && (
        <Notice variant="warn" title={t("backups.uploads.unfinished")}>
          <p>{t(pairedRestore.operations.some(({ stage }) =>
            stage === "postgres-restored" || stage === "uploads-started" || stage === "uploads-restored")
            ? "backups.uploads.postgresRestored"
            : "backups.uploads.lastConfirmedStep")}</p>
          <p>{t("backups.uploads.followRecovery")}</p>
        </Notice>
      )}
    </section>
  );
}

function ReadinessLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-dpf-2xs sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-dpf-sm">
      <dt className="text-dpf-caption font-dpf-medium text-dpf-muted uppercase">{label}</dt>
      <dd className="min-w-0 text-dpf-text">{value}</dd>
    </div>
  );
}
