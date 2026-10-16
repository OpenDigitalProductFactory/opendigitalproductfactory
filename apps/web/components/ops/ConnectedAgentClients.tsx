"use client";

import { EmptyState, StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { useT } from "@/lib/i18n/use-t";
import type { ClientStanding, ConnectedClientRow, ConnectedClientsView } from "@/lib/agent-toolchain/connected-clients";

// BI-E7974C18 — which AI coding clients connect to this install, and whether
// each one loaded the agent tools this update ships (design 2026-10-07 §5.2c).
// The data comes from connection observations, never a client report. Copy
// lives in the "upgrade" catalog, which the page provides.

const HOUR_MS = 60 * 60 * 1000;

const STANDING_INTENT: Record<ClientStanding, "success" | "warning" | "danger" | "neutral"> = {
  current: "success",
  stale: "warning",
  "below-floor": "danger",
  undeclared: "neutral",
  silent: "neutral",
};

type T = ReturnType<typeof useT<"upgrade">>;

function lastSeenWords(t: T, lastSeen: Date, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - new Date(lastSeen).getTime());
  if (elapsed < HOUR_MS) return t("agentClients.lastSeenRecent");
  if (elapsed < 24 * HOUR_MS) return t("agentClients.lastSeenHours", { count: Math.floor(elapsed / HOUR_MS) });
  return t("agentClients.lastSeenDays", { count: Math.floor(elapsed / (24 * HOUR_MS)) });
}

function clientName(t: T, row: ConnectedClientRow): string {
  if (!row.product) return t("agentClients.unidentified");
  return row.probable ? t("agentClients.probably", { name: row.product }) : row.product;
}

function Shell({ t, intro, children }: { t: T; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <Surface as="section" rounded="xl" padding="md" className="space-y-3" data-component="connected-agent-clients">
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{t("agentClients.title")}</h2>
        <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">{intro}</p>
      </div>
      {children}
    </Surface>
  );
}

function ClientItem({ t, row, now }: { t: T; row: ConnectedClientRow; now: Date }) {
  const details = [
    row.loadedVersion ? t("agentClients.toolsVersion", { version: row.loadedVersion }) : t("agentClients.toolsVersionUnknown"),
    t(`agentClients.signIn.${row.authMode}`),
    lastSeenWords(t, row.lastSeen, now),
  ];
  return (
    <li className="space-y-1 px-3 py-2" data-standing={row.standing}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-[var(--dpf-text)]">{clientName(t, row)}</span>
        <StatusBadge intent={STANDING_INTENT[row.standing]} label={t(`agentClients.standing.${row.standing}.label`)} uppercase={false} />
      </div>
      <p className="text-xs text-[var(--dpf-muted)]">
        {details.join(" · ")}
        {row.loadedFingerprint ? (
          <span className="font-mono"> ({t("agentClients.fingerprint", { value: row.loadedFingerprint })})</span>
        ) : null}
      </p>
      {row.standing === "current" ? null : (
        <p className="text-xs text-[var(--dpf-muted)]">{t(`agentClients.standing.${row.standing}.explanation`)}</p>
      )}
    </li>
  );
}

export function ConnectedAgentClients({ view, now }: { view: ConnectedClientsView | null; now: Date }) {
  const t = useT("upgrade");
  if (!view || !view.release) {
    return (
      <Shell t={t} intro={t("agentClients.intro")}>
        {view ? (
          <EmptyState size="sm" title={t("agentClients.noPack")} />
        ) : (
          <EmptyState size="sm" title={t("agentClients.unavailable")} description={t("agentClients.unavailableHint")} />
        )}
      </Shell>
    );
  }

  const intro = [
    t("agentClients.intro"),
    t("agentClients.introRelease", { version: view.release.packVersion }),
    t("agentClients.fingerprintHint"),
  ].join(" ");

  if (view.clients.length === 0) {
    return (
      <Shell t={t} intro={intro}>
        <EmptyState size="sm" title={t("agentClients.empty")} description={t("agentClients.emptyHint")} />
      </Shell>
    );
  }

  const upToDate = view.clients.filter((row) => row.standing === "current").length;
  return (
    <Shell t={t} intro={intro}>
      <p className="text-xs font-medium text-[var(--dpf-text)]">
        {t("agentClients.summary", { current: upToDate, total: view.clients.length })}
      </p>
      <ul className="divide-y divide-[var(--dpf-border)] rounded-lg border border-[var(--dpf-border)]">
        {view.clients.map((row) => (
          <ClientItem key={row.credentialRef} t={t} row={row} now={now} />
        ))}
      </ul>
      {view.truncated ? (
        <p className="text-xs text-[var(--dpf-muted)]">{t("agentClients.truncated", { count: view.clients.length })}</p>
      ) : null}
    </Shell>
  );
}
