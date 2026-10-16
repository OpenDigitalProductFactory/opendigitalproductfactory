// apps/web/app/(shell)/admin/settings/monitoring/page.tsx
//
// BI-8BBFE50B (slice D5 of BI-83260BB3): the operator's monitoring switch.
// Design: docs/superpowers/specs/2026-10-13-monitoring-operator-choice-design.md §6.
// State comes from observation (install-state + capability row + running
// services), not the row alone; the switch is read-only without
// manage_platform. A monitoring record that disagrees with install-state is
// named and the switch offers to match it (BI-F0C2E8F5); the switch locks only
// when the records cannot be reconciled. The admin layout already gates view_admin.
import Link from "next/link";
import { namespaceMessages } from "@dpf/i18n";
import type { MessageKey } from "@dpf/i18n";

import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { MonitoringSwitch } from "@/components/admin/MonitoringSwitch";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { LocalTime } from "@/components/ui/LocalTime";
import { Surface } from "@/components/ui/Surface";
import { StatusBadge } from "@/components/ui/report-kit";
import { auth } from "@/lib/auth";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { getT } from "@/lib/i18n/t.server";
import { can } from "@/lib/permissions";
import { loadMonitoringSwitchView } from "@/lib/platform-runtime/monitoring-switch-loader";
import type { MonitoringStatus } from "@/lib/platform-runtime/monitoring-switch-state";
import type { Intent } from "@/lib/ui-model/statusColors";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<MonitoringStatus, { intent: Intent; label: MessageKey<"admin">; explain: MessageKey<"admin"> }> = {
  on: { intent: "success", label: "monitoringSettings.status.on", explain: "monitoringSettings.explain.on" },
  off: { intent: "neutral", label: "monitoringSettings.status.off", explain: "monitoringSettings.explain.off" },
  "turning-on": { intent: "info", label: "monitoringSettings.status.turningOn", explain: "monitoringSettings.explain.turningOn" },
  "turning-off": { intent: "info", label: "monitoringSettings.status.turningOff", explain: "monitoringSettings.explain.turningOff" },
  "needs-attention": { intent: "warning", label: "monitoringSettings.status.needsAttention", explain: "monitoringSettings.explain.needsAttention" },
  unreconciled: { intent: "warning", label: "monitoringSettings.status.unreconciled", explain: "monitoringSettings.explain.unreconciled" },
};

export default async function MonitoringSettingsPage() {
  const [session, view, t, { language }] = await Promise.all([
    auth(),
    loadMonitoringSwitchView(),
    getT("admin"),
    getLocaleContext(),
  ]);
  const mayManage = Boolean(
    session?.user &&
      can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform"),
  );
  const { state, cost, lastChange } = view;
  const copy = STATUS_COPY[state.status];
  const services = state.missingServices.join(", ");
  const reasonArgs = { services };

  return (
    <div>
      {/* data-dpf-lead marks where the owner starts reading (ux-budget lead-band check). */}
      <div className="mb-6" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{t("monitoringSettings.title")}</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">{t("monitoringSettings.intro")}</p>
      </div>
      <AdminTabNav />

      <Surface as="section" aria-labelledby="monitoring-status-title" className="max-w-2xl space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="monitoring-status-title" className="text-sm font-semibold text-[var(--dpf-text)]">
            {t("monitoringSettings.title")}
          </h2>
          <StatusBadge intent={copy.intent} label={t(copy.label)} />
        </div>
        <p className="text-sm text-[var(--dpf-text)]">{t(copy.explain)}</p>

        {state.status === "needs-attention" && state.reason && (
          <p className="text-sm text-[var(--dpf-warning)]">{t(state.reason, reasonArgs)}</p>
        )}
        {state.recordMismatch && (
          <p className="text-sm text-[var(--dpf-warning)]">{t("monitoringSettings.recordMismatch")}</p>
        )}
        {(state.status === "unreconciled" || state.recordMismatch) && (
          <p className="text-xs text-[var(--dpf-muted)]">
            {view.divergenceSummary}{" "}
            <Link href="/platform/ai/runtime-health" className="text-[var(--dpf-accent)] underline-offset-2 hover:underline">
              {t("monitoringSettings.runtimeHealthLink")}
            </Link>
          </p>
        )}
        {cost && (
          <p className="text-xs text-[var(--dpf-muted)]">
            {t("monitoringSettings.cost", { memory: String(cost.memoryGb), cpus: String(cost.cpus) })}
          </p>
        )}
        {state.undecided && <p className="text-xs text-[var(--dpf-muted)]">{t("monitoringSettings.undecided")}</p>}

        <MessagesProvider locale={language} messages={{ admin: namespaceMessages(language, "admin") }}>
          {mayManage ? (
            <MonitoringSwitch
              enabled={view.enabled}
              recordMismatch={state.recordMismatch}
              canToggle={state.canToggle && view.enabledKeys !== null}
              reasonKey={state.canToggle ? null : state.reason}
              reasonArgs={reasonArgs}
            />
          ) : (
            <p className="text-xs text-[var(--dpf-muted)]">{t("monitoringSettings.readOnly")}</p>
          )}
        </MessagesProvider>
      </Surface>

      <Surface as="section" aria-labelledby="monitoring-last-change-title" className="mt-4 max-w-2xl space-y-2">
        <h2 id="monitoring-last-change-title" className="text-sm font-semibold text-[var(--dpf-text)]">
          {t("monitoringSettings.lastChange.heading")}
        </h2>
        {lastChange ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-[var(--dpf-muted)]">{t("monitoringSettings.lastChange.id")}</dt>
            <dd className="font-mono text-[var(--dpf-text)]">{lastChange.transitionId}</dd>
            <dt className="text-[var(--dpf-muted)]">{t("monitoringSettings.lastChange.status")}</dt>
            <dd className="text-[var(--dpf-text)]">
              {lastChange.status}
              {lastChange.failure ? `: ${lastChange.failure}` : ""}
            </dd>
            <dt className="text-[var(--dpf-muted)]">{t("monitoringSettings.lastChange.completed")}</dt>
            <dd className="text-[var(--dpf-text)]">
              {lastChange.completedAt ? <LocalTime value={lastChange.completedAt} /> : t("monitoringSettings.lastChange.notFinished")}
            </dd>
            {lastChange.observedServices.length > 0 && (
              <>
                <dt className="text-[var(--dpf-muted)]">{t("monitoringSettings.lastChange.services")}</dt>
                <dd className="text-[var(--dpf-text)]">{lastChange.observedServices.join(", ")}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-xs text-[var(--dpf-muted)]">{t("monitoringSettings.lastChange.none")}</p>
        )}
      </Surface>
    </div>
  );
}
