import type { HostPostureView } from "@/lib/install/host-posture";
import { Surface } from "@/components/ui/Surface";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge } from "@/components/ui/report-kit";
import { getT } from "@/lib/i18n/t.server";

/**
 * BI-3E2F87FA — whether the computer running the platform is set up to keep it
 * serving: plugged in, never sleeping on power, Docker starting at sign-in.
 * Read at sign-in by the host start script; advice only, nothing is changed.
 */
export async function HostPosturePanel({ view }: { view: HostPostureView | null }) {
  const t = await getT("portfolio");
  const note = "mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]";
  return (
    <Surface as="section" level={2} rounded="xl" id="host-posture" aria-labelledby="host-posture-heading">
      <h2 id="host-posture-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        {t("hostPosture.heading")}
      </h2>
      {view === null ? <p className={note}>{t("hostPosture.notReported")}</p> : null}
      {view !== null ? (
        <>
          <p className={note}>
            {t("hostPosture.readAt")} <LocalTime value={view.observedAt} />
          </p>
          <p className={note}>{view.checks.length > 0 ? t("hostPosture.adviceOnly") : t("hostPosture.noChecks")}</p>
        </>
      ) : null}
      {view !== null && view.checks.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {view.checks.map((check) => (
            <Surface as="li" padding="sm" key={check.id} data-check={check.id} className="space-y-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{check.label}</p>
                <StatusBadge domain="hostPosture" status={check.state} label={t(`hostPosture.state.${check.state}`)} variant="soft" />
              </div>
              <p className="text-xs text-[var(--dpf-muted)]">{check.detail}</p>
              {check.fix ? <p className="text-xs text-[var(--dpf-text)]">{check.fix}</p> : null}
            </Surface>
          ))}
        </ul>
      ) : null}
    </Surface>
  );
}
