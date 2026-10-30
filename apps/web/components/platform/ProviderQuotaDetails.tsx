"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProviderAccountOverviewRow } from "@/lib/inference/provider-account-view";
import { recheckProviderAccountQuota } from "@/lib/actions/provider-accounts";
import { formatInstant } from "@/lib/datetime";
import { FormStatus } from "@/components/ui/form/FormStatus";
import { SubmitButton } from "@/components/ui/form/SubmitButton";
import { fieldControlClass } from "@/components/ui/form/styles";

type QuotaDetailsProps = { connectionId: string; recovery: NonNullable<ProviderAccountOverviewRow["quotaRecovery"]>;
  canWrite: boolean; copy: Record<string, string> };
export function ProviderQuotaDetails({ connectionId, recovery, canWrite, copy }: QuotaDetailsProps) {
  const id = useId(), router = useRouter();
  const [modelId, setModelId] = useState(recovery.models.some(model => model.modelId === recovery.selectedModelId)
    ? recovery.selectedModelId! : recovery.models[0]?.modelId ?? "");
  const [hourly, setHourly] = useState(recovery.hourly);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const sourceLabels: Record<string, string> = { api: copy.capacitySourceApi, cli: copy.capacitySourceCoding, opencode: copy.capacitySourceCoding,
    oauth: copy.capacitySourceCheck, manual: copy.capacitySourceManual };
  const instant = (value: string | null) => value ? <time dateTime={value}>{formatInstant(value, { timeZone: copy.viewerTimeZone ?? "UTC" })}</time> : copy.capacityUnknownTime;
  return <details className="mt-1 text-sm">
    <summary className="cursor-pointer py-2 text-[var(--dpf-accent)]">{copy.limitDetails}</summary>
    <div className="space-y-3 rounded border border-[var(--dpf-border)] p-3">
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
          try { setResult(await recheckProviderAccountQuota(connectionId, modelId, hourly)); router.refresh(); }
          catch { setResult({ ok: false, message: copy.failed }); }
        });
      }} className="space-y-2">
        <p id={`${id}-preview`}>{copy.capacityCheckPreview}</p>
        <label className="block" htmlFor={`${id}-model`}>{copy.capacityModel}</label>
        <select id={`${id}-model`} name="modelId" className={fieldControlClass} value={modelId} disabled={pending} onChange={event => setModelId(event.target.value)}>
          {recovery.models.map(model => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}
        </select>
        <label className="flex items-center gap-2 py-2"><input type="checkbox" name="hourly" checked={hourly} disabled={pending} onChange={event => setHourly(event.target.checked)} />{copy.capacityHourly}</label>
        <SubmitButton pending={pending} pendingLabel={copy.working} disabled={!modelId}>{copy.capacityCheck}</SubmitButton>
        <FormStatus error={result && !result.ok ? result.message : null} success={result?.ok ? result.message : null} />
      </form> : null}
      {canWrite && (!recovery.canCheck || recovery.unavailable) && <p>{copy.capacityNoCheck}</p>}
    </div>
  </details>;
}
