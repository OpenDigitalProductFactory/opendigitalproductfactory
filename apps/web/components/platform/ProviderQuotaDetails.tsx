"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProviderAccountOverviewRow } from "@/lib/inference/provider-account-view";
import { recheckProviderAccountQuota, stopProviderAccountQuotaRecovery } from "@/lib/actions/provider-accounts";
import { formatInstant } from "@/lib/datetime";
import { FormStatus } from "@/components/ui/form/FormStatus";
import { SubmitButton } from "@/components/ui/form/SubmitButton";
import { SearchableSelect } from "@/components/ui/form/SearchableSelect";
import { Button } from "@/components/ui/Button";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { ExpandableCard } from "@/components/ui/report-kit/ExpandableCard";

type QuotaDetailsProps = { connectionId: string; recovery: NonNullable<ProviderAccountOverviewRow["quotaRecovery"]>;
  canWrite: boolean; copy: Record<string, string>; open?: boolean; onOpenChange?: (open: boolean) => void };
export function ProviderQuotaDetails({ connectionId, recovery, canWrite, copy, open, onOpenChange }: QuotaDetailsProps) {
  const id = useId(), router = useRouter();
  const [localOpen, setLocalOpen] = useState(false);
  const [modelId, setModelId] = useState(recovery.models.some(model => model.modelId === recovery.selectedModelId)
    ? recovery.selectedModelId! : recovery.models[0]?.modelId ?? "");
  const [hourly, setHourly] = useState(recovery.hourly);
  const [commissioned, setCommissioned] = useState(recovery.hourly);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const sourceLabels: Record<string, string> = { api: copy.capacitySourceApi, cli: copy.capacitySourceCoding, opencode: copy.capacitySourceCoding,
    oauth: copy.capacitySourceCheck, manual: copy.capacitySourceManual };
  const instant = (value: string | null) => value ? <time dateTime={value}>{formatInstant(value, { timeZone: copy.viewerTimeZone ?? "UTC" })}</time> : copy.capacityUnknownTime;
  return <ExpandableCard id={`${id}-recovery`} open={open ?? localOpen} onOpenChange={onOpenChange ?? setLocalOpen}
    summary={copy.limitDetails} headingLevel={2} className="mt-1 text-sm" panelClassName="bg-[var(--dpf-surface-1)]">
    <div className="space-y-3">
      {recovery.unavailable && <p role="status">{copy.capacityUnavailable}</p>}
      {recovery.limits.length > 0 && <ul className="m-0 list-inside space-y-1 p-0">{recovery.limits.map((limit, index) => <li key={index}>
        {limit.summary}{limit.until && <span className="block text-[var(--dpf-muted)]">{copy.capacityExpectedReset}: {instant(limit.until)}</span>}
      </li>)}</ul>}
      <dl className="space-y-1">
        <div><dt className="inline text-[var(--dpf-muted)]">{copy.capacityObserved}: </dt><dd className="inline">{instant(recovery.observedAt)}</dd></div>
        <div><dt className="inline text-[var(--dpf-muted)]">{copy.capacitySource}: </dt><dd className="inline">{sourceLabels[recovery.observationSource ?? ""] ?? copy.capacitySourceUnknown}</dd></div>
        {recovery.checkedModelId && <div><dt className="inline text-[var(--dpf-muted)]">{copy.capacityProof}: </dt><dd className="inline">{recovery.checkedModelId} · {instant(recovery.checkedAt)}</dd></div>}
        {recovery.proofExpiresAt && <div><dt className="inline text-[var(--dpf-muted)]">{copy.capacityFreshUntil}: </dt><dd className="inline">{instant(recovery.proofExpiresAt)}</dd></div>}
        {recovery.lastCheckAt && <div><dt className="inline text-[var(--dpf-muted)]">{copy.capacityLastCheck}: </dt><dd className="inline">{instant(recovery.lastCheckAt)}</dd></div>}
        {recovery.nextCheckAt && <div><dt className="inline text-[var(--dpf-muted)]">{copy.capacityNextCheck}: </dt><dd className="inline">{instant(recovery.nextCheckAt)}</dd></div>}
      </dl>
      {recovery.lastResult && <p>{recovery.lastResult}</p>}
      {recovery.usageUrl && <div className="space-y-1">
        <a className="inline-block py-2 text-[var(--dpf-accent)]" href={recovery.usageUrl} target="_blank" rel="noopener noreferrer">{copy.providerUsage}</a>
        <p>{copy.resetUnknown}</p><p className="text-[var(--dpf-muted)]">{copy.resetChoice}</p>
      </div>}
      {canWrite && recovery.canCheck && !recovery.unavailable ? <form aria-labelledby={`${id}-preview`} aria-busy={pending} onSubmit={event => {
        event.preventDefault();
        if (!modelId || pending) return;
        setResult(null);
        startTransition(async () => {
          try {
            const outcome = await recheckProviderAccountQuota(connectionId, modelId, hourly);
            setResult(outcome);
            if (outcome.ok || outcome.nextCheckAt) setCommissioned(hourly);
            router.refresh();
          }
          catch { setResult({ ok: false, message: copy.failed }); }
        });
      }} className="space-y-2">
        <p id={`${id}-preview`}>{copy.capacityCheckPreview}</p>
        <label className="block" htmlFor={`${id}-model`}>{copy.capacityModel}</label>
        <p className="text-[var(--dpf-muted)]">{copy.capacityAvailableModels}: {recovery.models.length}</p>
        <SearchableSelect id={`${id}-model`} name="modelId" value={modelId} disabled={pending} onValueChange={setModelId}
          searchLabel={copy.capacityModelSearch} placeholder={copy.capacityModel} emptyMessage={copy.capacityNoMatchingModels}
          options={recovery.models.map(model => ({ value: model.modelId, label: model.name === model.modelId ? model.modelId : `${model.name} (${model.modelId})` }))} />
        <label className="flex items-center gap-2 py-2"><input type="checkbox" name="hourly" checked={hourly} disabled={pending} onChange={event => setHourly(event.target.checked)} />{copy.capacityHourly}</label>
        <SubmitButton pending={pending} pendingLabel={copy.working} disabled={!modelId}>{copy.capacityCheck}</SubmitButton>
      </form> : null}
      {canWrite && commissioned && !recovery.unavailable && <div className="space-y-2">
        <p id={`${id}-stop-preview`}>{copy.capacityStopPreview}</p>
        <Button variant="secondary" disabled={pending} aria-busy={pending} aria-describedby={`${id}-stop-preview`} onClick={() => {
          setResult(null);
          startTransition(async () => {
            try {
              const outcome = await stopProviderAccountQuotaRecovery(connectionId);
              setResult(outcome);
              if (outcome.ok) { setHourly(false); setCommissioned(false); }
              router.refresh();
            } catch { setResult({ ok: false, message: copy.failed }); }
          });
        }}>{pending ? <InlineBusy label={copy.working} tone="current" /> : copy.capacityStop}</Button>
      </div>}
      <FormStatus className="[&[role=status]]:text-[var(--dpf-text)]" error={result && !result.ok ? result.message : null} success={result?.ok ? result.message : null} />
      {canWrite && (!recovery.canCheck || recovery.unavailable) && <p>{copy.capacityNoCheck}</p>}
    </div>
  </ExpandableCard>;
}
