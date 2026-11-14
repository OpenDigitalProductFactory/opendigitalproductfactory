"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { SelectField } from "@/components/ui/form/SelectField";
import { TextField } from "@/components/ui/form/TextField";
import { Notice } from "@/components/ui/report-kit";
import { loadPlatformFundingSetupAction, confirmPlatformFundingOwnerAction } from "@/lib/actions/portfolio-budget";
import { useT } from "@/lib/i18n/use-t";
import type { PlatformFundingSetupView } from "@/lib/portfolio/platform-funding-setup";

/** Initial ownership is a separate decision from changing an allocation or binding work. */
export function PlatformFundingSetup() {
  const t = useT("portfolio");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PlatformFundingSetupView | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"read" | "confirm" | null>(null);
  const inFlight = useRef(false);
  const selected = view?.organizations.find((organization) => organization.id === organizationId);

  function failureMessage(code: string) {
    if (code === "funding-setup-stale") return t("fundingSetup.stale");
    if (code === "funding-setup-not-authorized" || code === "funding-setup-human-required") return t("fundingSetup.denied");
    if (code === "funding-setup-owner-recorded" || code === "funding-setup-conflict") return t("fundingSetup.conflict");
    if (code === "funding-setup-invalid-input") return t("fundingSetup.invalid");
    return t("fundingSetup.unavailable");
  }

  function readReason(code: string) {
    if (code === "installation-unavailable") return t("fundingSetup.installationUnavailable");
    if (code === "profile-unavailable") return t("fundingSetup.profileUnavailable");
    if (code === "allocation-unavailable") return t("fundingSetup.allocationUnavailable");
    return code;
  }

  async function load(afterOrganizationId?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("read"); setError(null); setAttested(false);
    try {
      const result = await loadPlatformFundingSetupAction(afterOrganizationId);
      if (!result.ok) {
        setError(failureMessage(result.error)); setMustReload(true);
        if (result.error === "funding-setup-not-authorized" || result.error === "funding-setup-human-required") setView(null);
        return;
      }
      const next = result.data;
      const sameOwner = view?.installationId === next.installationId
        && view?.person?.principalId === next.person?.principalId
        && view?.profile?.currentVersionId === next.profile?.currentVersionId
        && view?.profile?.ownerPrincipalId === next.profile?.ownerPrincipalId
        && view?.profile?.ownerOrganizationId === next.profile?.ownerOrganizationId;
      // Keep only the selected prior option beside the new bounded page. Browsing
      // never grows a select containing every organization on the installation.
      const retained = afterOrganizationId && sameOwner && next.status === "available" && selected
        && !next.organizations.some((organization) => organization.id === selected.id) ? [selected] : [];
      const organizations = [...retained, ...next.organizations];
      setView({ ...next, organizations });
      setOrganizationId(organizations.some((organization) => organization.id === organizationId)
        ? organizationId : organizations.length === 1 ? organizations[0]!.id : "");
      setMustReload(false);
    } catch {
      setError(t("fundingSetup.unavailable")); setMustReload(true);
    } finally {
      inFlight.current = false; setBusy(null);
    }
  }

  async function confirmOwnership() {
    if (inFlight.current || mustReload || view?.status !== "available" || !selected || !attested || !reason.trim()) return;
    inFlight.current = true; setBusy("confirm"); setError(null);
    try {
      const result = await confirmPlatformFundingOwnerAction({ organizationId: selected.id, expectedDigest: selected.expectedDigest, attestation: true, reason: reason.trim() });
      if (!result.ok) {
        setError(failureMessage(result.error)); setMustReload(true); setAttested(false);
        return;
      }
      setSaved(true); setView(null); setAttested(false); router.refresh();
    } catch {
      // A lost reply may follow a committed write. Read its current state before
      // offering another confirmation; never resubmit an uncertain ownership act.
      setError(t("fundingSetup.uncertain")); setMustReload(true); setAttested(false);
    } finally {
      inFlight.current = false; setBusy(null);
    }
  }

  return <div data-surface-node-id="platform-funding-setup" className="space-y-3 border-t border-dpf-border pt-3">
    <Button variant="ghost" data-surface-node-id="platform-funding-setup-toggle" aria-expanded={open} aria-controls="platform-funding-setup-content" onClick={() => {
      setOpen(!open);
      if (!open && !view && !saved) void load();
    }}>{t("fundingSetup.show")}</Button>
    {open ? <div id="platform-funding-setup-content" className="max-w-xl space-y-4">
      {busy ? <p role="status" className="text-dpf-body text-dpf-text">{t(busy === "confirm" ? "fundingSetup.saving" : "fundingSetup.loading")}</p> : null}
      {saved ? <p role="status" className="text-dpf-body text-dpf-text">{t("fundingSetup.saved")}</p> : null}
      {error ? <p role="alert" className="text-dpf-body text-dpf-text">{error}</p> : null}
      {view?.status === "available" && view.person && view.profile ? <>
        <p className="text-dpf-body text-dpf-text">{t("fundingSetup.intro")}</p>
        <p className="text-dpf-body"><span className="font-dpf-semibold">{t("fundingSetup.person")}: </span>{view.person.displayName}</p>
        {view.organizations.length > 0 ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void confirmOwnership(); }}>
          <SelectField name="platform-funding-organization" data-surface-node-id="platform-funding-organization" label={t("fundingSetup.organization")} value={organizationId} options={view.organizations.map((organization) => ({ value: organization.id, label: organization.name }))} placeholder={t("fundingSetup.chooseOrganization")} required disabled={busy !== null} onValueChange={(value) => { setOrganizationId(value); setAttested(false); }} />
          {selected ? <>
            <p className="text-dpf-body text-dpf-text">{t("fundingSetup.consequence", { person: view.person.displayName, organization: selected.name })}</p>
            <p className="text-dpf-body text-dpf-text">{t(selected.allocation.source === "explicit" ? "fundingSetup.explicit" : "fundingSetup.default")}</p>
            <p className="font-dpf-semibold text-dpf-body">{t("investment.targetMix", { repair: selected.allocation.policy.refactorPercent, newWork: 100 - selected.allocation.policy.refactorPercent })}</p>
            {!selected.allocation.active ? <Notice variant="warn">{t("fundingSetup.inactive")}</Notice> : null}
            <p className="text-dpf-body text-dpf-text">{t("fundingSetup.preservation")}</p>
            <TextField name="platform-funding-reason" data-surface-node-id="platform-funding-reason" label={t("fundingSetup.reason")} value={reason} onValueChange={setReason} required disabled={busy !== null} maxLength={2000} />
            <label className="flex items-start gap-2 text-dpf-body text-dpf-text">
              <input type="checkbox" data-surface-node-id="platform-funding-attestation" className="mt-1" checked={attested} onChange={(event) => setAttested(event.target.checked)} disabled={busy !== null || mustReload} />
              {t("fundingSetup.attestation")}
            </label>
            <OwnershipRecord view={view} organizationId={selected.id} expectedDigest={selected.expectedDigest} />
            {selected.allocation.revision ? <dl className="space-y-2 text-dpf-caption text-dpf-text">
              <div><dt>{t("fundingSetup.effective")}</dt><dd><LocalTime value={selected.allocation.revision.effectiveAt} /></dd></div>
              <div><dt>{t("fundingSetup.expires")}</dt><dd>{selected.allocation.revision.expiresAt ? <LocalTime value={selected.allocation.revision.expiresAt} /> : t("fundingSetup.noExpiry")}</dd></div>
            </dl> : null}
            <Button type="submit" data-surface-node-id="platform-funding-confirm" disabled={busy !== null || mustReload || !attested || !reason.trim()}>{t("fundingSetup.confirm")}</Button>
          </> : null}
        </form> : <Notice variant="warn">{t("fundingSetup.noOrganizations")}</Notice>}
        {view.nextCursor ? <Button variant="ghost" data-surface-node-id="platform-funding-more-organizations" disabled={busy !== null || mustReload} onClick={() => void load(view.nextCursor!)}>{t("investment.more")}</Button> : null}
      </> : null}
      {view && (view.status !== "available" || !view.person || !view.profile) ? <Notice variant={view.status === "already-recorded" ? "info" : "warn"} title={t(view.status === "already-recorded" ? "fundingSetup.recorded" : view.status === "partial-or-conflicting" ? "fundingSetup.conflictHeading" : "fundingSetup.unavailableHeading")}>
        {view.reason ? <p>{readReason(view.reason)}</p> : <p>{t(view.status === "already-recorded" ? "fundingSetup.recordedBody" : view.status === "partial-or-conflicting" ? "fundingSetup.conflictBody" : "fundingSetup.unavailable")}</p>}
        <OwnershipRecord view={view} />
      </Notice> : null}
      <Button variant="secondary" data-surface-node-id="platform-funding-setup-reload" disabled={busy !== null} onClick={() => void load()}>{t("fundingSetup.reload")}</Button>
    </div> : null}
  </div>;
}

function OwnershipRecord({ view, organizationId, expectedDigest }: { view: PlatformFundingSetupView; organizationId?: string; expectedDigest?: string }) {
  const t = useT("portfolio");
  const records = [
    [t("fundingSetup.installation"), view.installationId],
    [t("fundingSetup.profile"), view.profile?.profileId],
    [t("fundingSetup.personRecord"), view.person?.principalId],
    [t("fundingSetup.organizationRecord"), organizationId],
    [t("fundingSetup.currentOwner"), view.profile?.ownerPrincipalId],
    [t("fundingSetup.currentOrganization"), view.profile?.ownerOrganizationId],
    [t("fundingSetup.policyVersion"), view.profile?.currentVersionId],
    [t("fundingSetup.stateCheck"), expectedDigest],
  ];
  return <details><summary data-surface-node-id="platform-funding-record-toggle" className="cursor-pointer py-3 text-dpf-body text-dpf-accent">{t("fundingSetup.recordDetails")}</summary>
    <dl className="space-y-2 break-words text-dpf-caption text-dpf-text">{records.map(([label, value]) => <div key={label}><dt className="font-dpf-semibold">{label}</dt><dd>{value ?? t("fundingSetup.notRecorded")}</dd></div>)}</dl>
  </details>;
}
