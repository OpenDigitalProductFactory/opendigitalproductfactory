"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataTable, FilterBar, StatusBadge, type Column } from "@/components/ui/report-kit";
import { FormStatus } from "@/components/ui/form/FormStatus";
import { SubmitButton } from "@/components/ui/form/SubmitButton";
import { Surface } from "@/components/ui/Surface";
import { fieldControlClass } from "@/components/ui/form/styles";
import { addProviderAccount } from "@/lib/actions/provider-accounts";
import { completeProviderAccountSetup } from "@/lib/actions/provider-account-setup";
import { providerAccountHref, type ProviderAccountOverviewRow } from "@/lib/inference/provider-account-view";
import { ProviderQuotaDetails } from "./ProviderQuotaDetails";
export type { ProviderAccountOverviewRow } from "@/lib/inference/provider-account-view";

export type ProviderAccountCatalogRow = {
  providerId: string; name: string; summary: string; supportedAuthMethods: string[];
};
const buttonClass = "rounded border border-[var(--dpf-border)] px-3 py-2 text-sm disabled:opacity-50";
const fieldClass = `mt-1 ${fieldControlClass}`;
const supportedMethods = ["api_key", "oauth2_authorization_code", "oauth2_client_credentials"];
function supportsAccount(provider: ProviderAccountCatalogRow | undefined) {
  return Boolean(provider?.supportedAuthMethods.some(method => supportedMethods.includes(method)));
}

export function ProviderAccountsOverview({ rows, catalog, firstRun, canWrite, copy }: {
  rows: ProviderAccountOverviewRow[]; catalog: ProviderAccountCatalogRow[];
  firstRun: boolean; canWrite: boolean; copy: Record<string, string>;
}) {
  const id = useId();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [showCatalog, setShowCatalog] = useState(firstRun);
  const [newProvider, setNewProvider] = useState<ProviderAccountCatalogRow | null>(null);
  const [label, setLabel] = useState("");
  const [method, setMethod] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addProviderRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (showCatalog && !firstRun) catalogRef.current?.querySelector("input")?.focus(); }, [showCatalog, firstRun]);
  useEffect(() => {
    if (newProvider) { formRef.current?.querySelector("input")?.focus(); return; }
    const trigger = accountTriggerRef.current;
    accountTriggerRef.current = null;
    if (trigger) (trigger.isConnected ? trigger : addProviderRef.current)?.focus();
  }, [newProvider]);
  const normalized = search.trim().toLocaleLowerCase();
  const visibleRows = rows.filter(row => `${row.label} ${row.providerName} ${row.allowedWork} ${row.statusLabel}`.toLocaleLowerCase().includes(normalized));
  const catalogById = new Map(catalog.map(provider => [provider.providerId, provider]));
  const firstAccountByProvider = new Map<string, string>();
  for (const account of visibleRows) {
    if (!firstAccountByProvider.has(account.providerId)) firstAccountByProvider.set(account.providerId, account.connectionId);
  }
  const columns: Column<ProviderAccountOverviewRow>[] = [
    { key: "account", header: copy.accountName, mobileFullWidth: true, hideMobileLabel: true, cell: row => <div>
      <Link href={providerAccountHref(row)} className="font-medium text-[var(--dpf-accent)]">{row.label}</Link>
      <div className="text-xs text-[var(--dpf-muted)]">{row.providerName} · <StatusBadge intent={row.statusIntent ?? "neutral"} label={row.statusLabel} /></div>
      {row.resolvesPhases.length > 0 && <div className="text-xs text-[var(--dpf-muted)]">{copy.resolvesPhases} {row.resolvesPhases.join(", ")}</div>}
    </div>, sortAccessor: row => `${row.providerName} ${row.label}` },
    { key: "allowed", header: copy.allowedWork, cell: row => <div>
      <StatusBadge intent="neutral" label={row.allowedWork} />
      <div className="mt-1 text-xs text-[var(--dpf-muted)]">{row.allowedWorkSummary}</div>
    </div> },
    { key: "models", header: copy.models, cell: row => <div>{row.modelSummary}
      {row.capabilitySummary && <div className="text-xs text-[var(--dpf-muted)]">{row.capabilitySummary}</div>}
    </div> },
    { key: "capacity", header: copy.capacity, mobileFullWidth: true, cell: row => <div>{row.capacitySummary}
      {row.quotaRecovery && <ProviderQuotaDetails key={row.connectionId} connectionId={row.connectionId} recovery={row.quotaRecovery} canWrite={canWrite} copy={copy} />}
      {!row.quotaRecovery && row.resetSummary && <div className="text-xs text-[var(--dpf-muted)]">{row.resetSummary}</div>}
    </div> },
    { key: "manage", header: copy.manage, mobileFullWidth: true, hideMobileLabel: true, cell: row => <div className="flex flex-wrap gap-2">
      <Link href={providerAccountHref(row)} data-owner-first-next-action={!canWrite && row.connectionId === visibleRows[0]?.connectionId ? "" : undefined} className="py-2 text-[var(--dpf-accent)]">{copy.manage}</Link>
      {canWrite && firstAccountByProvider.get(row.providerId) === row.connectionId
        && supportsAccount(catalogById.get(row.providerId)) &&
        <button type="button" className={buttonClass} disabled={pending} onClick={event => beginAccount(catalogById.get(row.providerId)!, event.currentTarget)}>{copy.addAccount}</button>}
    </div> },
  ];

  function beginAccount(provider: ProviderAccountCatalogRow, trigger: HTMLButtonElement) {
    accountTriggerRef.current = trigger;
    setNewProvider(provider);
    setMethod(provider.supportedAuthMethods.find(auth => supportedMethods.includes(auth)) ?? "");
    setLabel("");
    setError(null);
    setSuccess(null);
    formRef.current?.querySelector("input")?.focus();
  }

  return <section className="space-y-3" aria-label={copy.connection} aria-busy={pending}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <FilterBar facets={[{ kind: "search", key: "query", placeholder: copy.searchAccounts }]} value={{ query: search }} onChange={next => setSearch(next.query ?? "")} resultCount={visibleRows.length} />
      {canWrite && <button ref={addProviderRef} type="button" data-owner-first-next-action className={buttonClass} disabled={pending} aria-expanded={showCatalog} aria-controls={`${id}-catalog`} onClick={() => setShowCatalog(!showCatalog)}>{copy.addProvider}</button>}
    </div>
    <DataTable columns={columns} rows={visibleRows} getRowKey={row => row.connectionId} empty={copy.noAccounts} dense responsive ariaLabel={copy.connection} />
    {showCatalog && <Surface padding="sm"><div ref={catalogRef} id={`${id}-catalog`}>
      <h2 className="m-0 text-sm font-semibold">{copy.catalog}</h2>
      {firstRun && canWrite && <SubmitButton type="button" className="mt-2" pending={pending} pendingLabel={copy.working} onClick={() => {
        setError(null);
        setSuccess(null);
        startTransition(async () => {
        try {
          const result = await completeProviderAccountSetup();
          if (!result.ok) { setError(result.error); return; }
          setShowCatalog(false);
          setSuccess(copy.setupComplete);
          router.refresh();
        } catch { setError(copy.failed); }
        });
      }}>{copy.finishLocal}</SubmitButton>}
      <FilterBar className="my-2" facets={[{ kind: "search", key: "query", placeholder: copy.searchProviders }]} value={{ query: catalogSearch }} onChange={next => setCatalogSearch(next.query ?? "")} />
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.filter(provider => `${provider.name} ${provider.summary}`.toLocaleLowerCase().includes(catalogSearch.trim().toLocaleLowerCase())).map(provider => <li key={provider.providerId} className="rounded border border-[var(--dpf-border)] p-2">
          <Link className="inline-block py-2 font-medium text-[var(--dpf-accent)]" href={`/platform/ai/providers/${encodeURIComponent(provider.providerId)}`}>{provider.name}</Link>
          <p className="m-0 text-xs text-[var(--dpf-muted)]">{provider.summary}</p>
          {canWrite && supportsAccount(provider) && <button type="button" className={`${buttonClass} mt-2`} disabled={pending} onClick={event => beginAccount(provider, event.currentTarget)}>{copy.addAccount}</button>}
        </li>)}
      </ul>
    </div></Surface>}
    {newProvider && <Surface padding="sm"><form ref={formRef} aria-labelledby={`${id}-new`} onSubmit={event => {
      event.preventDefault();
      if (!canWrite || pending) return;
      setError(null);
      setSuccess(null);
      startTransition(async () => {
        try {
          const result = await addProviderAccount({ providerId: newProvider.providerId, label, authMethod: method });
          if (!result.ok) { setError(result.error); return; }
          router.push(`/platform/ai/providers/${encodeURIComponent(newProvider.providerId)}?account=${encodeURIComponent(result.data.connectionId)}`);
          router.refresh();
        } catch { setError(copy.failed); }
      });
    }}>
      <h2 id={`${id}-new`} className="m-0 text-sm font-semibold">{copy.addAccount} · {newProvider.name}</h2>
      <div className="my-2 grid gap-2 sm:grid-cols-2">
        <label className="text-sm">{copy.accountName}<input name="label" className={fieldClass} required maxLength={120} value={label} disabled={pending} onChange={event => setLabel(event.target.value)} /></label>
        <label className="text-sm">{copy.authMethod}<select name="authMethod" className={fieldClass} value={method} disabled={pending} onChange={event => setMethod(event.target.value)}>
          {newProvider.supportedAuthMethods.filter(auth => supportedMethods.includes(auth)).map(auth => <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" key={auth} value={auth}>{auth === "api_key" ? copy.apiKeyMethod : auth === "oauth2_authorization_code" ? copy.oauthMethod : copy.workloadMethod}</option>)}
        </select></label>
      </div>
      <div className="flex gap-2"><SubmitButton pending={pending} pendingLabel={copy.working} disabled={!method || !label.trim()}>{copy.addAccount}</SubmitButton>
        <button type="button" className={buttonClass} disabled={pending} onClick={() => setNewProvider(null)}>{copy.cancel}</button></div>
    </form></Surface>}
    <FormStatus error={error} success={success} />
  </section>;
}
