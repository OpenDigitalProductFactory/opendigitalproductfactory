"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { fieldControlClass } from "@/components/ui/form/styles";
import { configureProviderAccount, discoverProviderAccount, setProviderAccountEnabled } from "@/lib/actions/provider-accounts";
import { testProviderAuth } from "@/lib/actions/ai-providers";
import { disconnectProviderOAuth, startProviderOAuth } from "@/lib/actions/provider-oauth";
import { providerAccountConfigurationInput } from "@/lib/inference/provider-account-view";
import type { ProviderAccountRow } from "@/lib/inference/ai-provider-data";

type Copy = Record<string, string>;
const fieldClass = `mt-1 ${fieldControlClass}`;
const buttonClass = "rounded border border-[var(--dpf-border)] px-3 py-2 text-sm disabled:opacity-50";

/** Additional accounts never submit through the legacy default credential path. */
export function ProviderAccountConnectionForm({ account, canWrite, copy }: {
  account: ProviderAccountRow; canWrite: boolean; copy: Copy;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = { clientId: account.credential?.clientId ?? "", tokenEndpoint: account.credential?.tokenEndpoint ?? "", scope: account.credential?.scope ?? "" };
  const [draft, setDraft] = useState({ ...initial, label: account.label ?? account.providerId, secretRef: "", clientSecret: "" });
  const [flash, setFlash] = useState<{ error: boolean; text: string } | null>(null);
  const disabled = !canWrite || pending;

  function run(action: () => Promise<{ error?: string; text: string }>) {
    setFlash(null);
    startTransition(async () => {
      try {
        const result = await action();
        setFlash({ error: Boolean(result.error), text: result.error ?? result.text });
        if (!result.error) router.refresh();
      } catch {
        setFlash({ error: true, text: copy.failed });
      }
    });
  }

  async function disconnect() {
    const confirmed = await confirmDialog({ title: copy.disconnectTitle, message: copy.disconnectMessage, confirmLabel: copy.disconnect, tone: "danger" });
    if (!confirmed) return;
    run(async () => ({ ...await disconnectProviderOAuth(account.providerId, account.connectionId), text: copy.disconnected }));
  }

  function field(key: keyof typeof draft, label: string, secret = false) {
    return <label htmlFor={`${id}-${key}`} className="text-sm text-[var(--dpf-muted)]">{label}
      <input id={`${id}-${key}`} className={fieldClass} value={draft[key]} disabled={disabled}
        type={secret ? "password" : "text"} autoComplete={secret ? "new-password" : "off"}
        maxLength={key === "label" ? 120 : undefined}
        onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} />
    </label>;
  }

  return <Surface as="section" padding="sm" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="m-0 text-sm font-semibold">{copy.connection}</h2>
    <form className="mt-2 space-y-2" onSubmit={event => {
      event.preventDefault();
      if (disabled) return;
      run(async () => {
        const result = await configureProviderAccount(providerAccountConfigurationInput(account.connectionId, draft, initial));
        if (!result.ok) return { error: result.error, text: copy.saved };
        setDraft(previous => ({ ...previous, secretRef: "", clientSecret: "" }));
        return { text: copy.saved };
      });
    }}>
      <div className="grid gap-2 sm:grid-cols-2">
        {field("label", copy.accountName)}
        {account.authMethod === "api-key" && field("secretRef", copy.apiKey, true)}
        {account.authMethod === "workload-identity" && <>{field("clientId", copy.clientId)}{field("clientSecret", copy.clientSecret, true)}</>}
      </div>
      {account.authMethod === "workload-identity" && <details>
        <summary className="cursor-pointer py-2 text-sm">{copy.advanced}</summary>
        <div className="grid gap-2 sm:grid-cols-2">{field("tokenEndpoint", copy.tokenEndpoint)}{field("scope", copy.scope)}</div>
      </details>}
      <p className="m-0 text-xs text-[var(--dpf-muted)]">{copy.writeOnly}</p>
      <button className={buttonClass} type="submit" disabled={disabled}>{copy.save}</button>
    </form>
    <div className="mt-2 flex flex-wrap gap-2">
      {account.authMethod === "oauth" && <button className={buttonClass} type="button" disabled={disabled} onClick={() => run(async () => {
        const result = await startProviderOAuth(account.providerId, account.connectionId);
        if ("error" in result) return { error: result.error, text: copy.signIn };
        window.location.assign(result.authorizeUrl);
        return { text: copy.signIn };
      })}>{copy.signIn}</button>}
      <button className={buttonClass} type="button" disabled={disabled} onClick={() => run(async () => {
        const result = await testProviderAuth(account.providerId, false, account.connectionId);
        return { ...(result.ok ? {} : { error: result.message }), text: result.message };
      })}>{copy.test}</button>
      <button className={buttonClass} type="button" disabled={disabled} onClick={() => run(async () => {
        const result = await discoverProviderAccount(account.connectionId);
        return { ...(result.ok ? {} : { error: result.error }), text: copy.modelsRefreshed };
      })}>{copy.discover}</button>
      <button className={buttonClass} type="button" disabled={disabled} onClick={() => run(async () => {
        const result = await setProviderAccountEnabled(account.connectionId, account.status === "disabled");
        return { ...(result.ok ? {} : { error: result.error }), text: copy.stateSaved };
      })}>{account.status === "disabled" ? copy.enable : copy.disable}</button>
      {account.authMethod === "oauth" && <button className={buttonClass} type="button" disabled={disabled} onClick={disconnect}>{copy.disconnect}</button>}
    </div>
    {flash && <div className="mt-2" role={flash.error ? "alert" : "status"}><Notice variant={flash.error ? "error" : "success"}>{flash.text}</Notice></div>}
  </Surface>;
}
