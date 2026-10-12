"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/use-t";
import type { ProviderWithCredential } from "@/lib/ai-provider-types";
import type { ProviderRoutingControlView } from "@/lib/routing/provider-routing-control";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { LocalTime } from "@/components/ui/LocalTime";
import { Surface } from "@/components/ui/Surface";
import { ProviderStatusToggle } from "./ProviderStatusToggle";

export function ProviderRoutingControlPanel({ pw, view, canWrite }: { pw: ProviderWithCredential; view: ProviderRoutingControlView; canWrite: boolean }) {
  const p = pw.provider;
  const t = useT("setup");
  const sibling = p.providerId === "chatgpt" ? "codex" : p.providerId === "codex" ? "chatgpt" : null;
  return <Surface as="section" aria-labelledby="provider-routing-heading" className="mb-5">
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <h2 id="provider-routing-heading" className="text-base font-semibold text-[var(--dpf-text)]">{t("providerRouting.heading")}</h2>
      <StatusBadge domain="routingEligibility" status={view.eligibility.state} label={view.eligibility.label} uppercase={false} />
    </div>
    <p className="text-sm text-[var(--dpf-muted)]">{view.eligibility.reason}</p>
    {view.restrictions.length > 0 && <ul className="my-3 space-y-2 text-sm text-[var(--dpf-text)]">{view.restrictions.map(r => <li key={r.key}>
      {r.summary} {r.until ? <><span className="text-[var(--dpf-muted)]">{r.key === "operator" ? t("providerRouting.pauseEnds") : t("providerRouting.nextAttempt")} </span><time dateTime={r.until}><LocalTime value={r.until} /></time></> : r.key === "operator" ? t("providerRouting.indefinite") : null}
    </li>)}</ul>}
    {canWrite && <div className="mt-4"><ProviderStatusToggle providerId={p.providerId} endpointType={p.endpointType} initialStatus={p.status} initialPause={p.operatorPause} initialConnectionStatus={p.defaultConnectionStatus} /></div>}
    <p className="mt-3 text-xs text-[var(--dpf-muted)]">{t("providerRouting.pauseExplanation")}</p>
    {sibling && <p className="mt-3 text-sm text-[var(--dpf-muted)]">{t("providerRouting.sharedAuth")} <Link className="text-[var(--dpf-accent)] underline underline-offset-2" href={`/platform/ai/providers/${sibling}`}>{sibling === "codex" ? t("providerRouting.manageSignIn") : t("providerRouting.manageChatGPT")}</Link>.</p>}
    <details className="mt-3 text-sm text-[var(--dpf-muted)]"><summary className="cursor-pointer">{t("providerRouting.details")}</summary><p className="mt-2">{view.healthSummary}</p>{view.weeklyHint && <p>{view.weeklyHint}</p>}<p>{t("providerRouting.workloadRules")}</p></details>
  </Surface>;
}
