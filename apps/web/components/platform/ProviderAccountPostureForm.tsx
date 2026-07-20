"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProviderConnectionPosture } from "@/lib/actions/ai-providers";

type AccountClass = "regular" | "business-team" | "enterprise" | "unknown";

export function ProviderAccountPostureForm({
  providerId,
  canWrite,
  initial,
}: {
  providerId: string;
  canWrite: boolean;
  initial: { accountClass: string; noTraining: boolean | null; enabledRegions: string[] } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [accountClass, setAccountClass] = useState<AccountClass>(
    initial?.accountClass === "regular" || initial?.accountClass === "business-team" || initial?.accountClass === "enterprise"
      ? initial.accountClass
      : "unknown",
  );
  const [noTraining, setNoTraining] = useState(initial?.noTraining == null ? "unknown" : initial.noTraining ? "yes" : "no");
  const [regions, setRegions] = useState((initial?.enabledRegions ?? []).join(", "));
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section aria-labelledby="account-posture-heading" className="mb-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 id="account-posture-heading" className="m-0 text-sm font-semibold text-[var(--dpf-text)]">Connected account and data terms</h2>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">Tell DPF what account is connected. This declaration helps routing, but is not a substitute for a DPA, BAA, supplier contract, or provider evidence.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-xs text-[var(--dpf-muted)]">Account type
          <select className="mt-1 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 text-[var(--dpf-text)]" value={accountClass} disabled={!canWrite || pending} onChange={(event) => setAccountClass(event.target.value as AccountClass)}>
            <option value="unknown">I am not sure</option>
            <option value="regular">Personal / individual</option>
            <option value="business-team">Business / team</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>
        <label className="text-xs text-[var(--dpf-muted)]">No training on company data
          <select className="mt-1 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 text-[var(--dpf-text)]" value={noTraining} disabled={!canWrite || pending} onChange={(event) => setNoTraining(event.target.value)}>
            <option value="unknown">Not verified</option>
            <option value="yes">Provider terms say yes</option>
            <option value="no">No / opt-in only</option>
          </select>
        </label>
        <label className="text-xs text-[var(--dpf-muted)]">Enabled processing regions
          <input className="mt-1 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 text-[var(--dpf-text)]" value={regions} disabled={!canWrite || pending} placeholder="eu, uk" onChange={(event) => setRegions(event.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={!canWrite || pending} className="rounded bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-[var(--dpf-on-accent)] disabled:opacity-50" onClick={() => startTransition(async () => {
          const result = await updateProviderConnectionPosture({
            providerId,
            accountClass,
            noTraining: noTraining === "unknown" ? null : noTraining === "yes",
            enabledRegions: regions.split(","),
          });
          setMessage(result.error ?? "Account declaration saved. DPF will keep unproven workloads blocked.");
          if (!result.error) router.refresh();
        })}>Save account declaration</button>
        {message && <p role="status" className="m-0 text-xs text-[var(--dpf-muted)]">{message}</p>}
      </div>
    </section>
  );
}
