"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  enrollChannelPartnerAction,
  updateChannelPartnerStandingAction,
} from "@/lib/actions/federation-links";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { DataTable, EmptyState, StatusBadge, type Column } from "@/components/ui/report-kit";

export interface PartnerBusinessRow {
  partnerId: string;
  displayName: string;
  standing: string;
  tier: string;
  linkName: string | null;
  agreementReference: string | null;
  agreementCount: number;
  entitlementCount: number;
  supportRouteCount: number;
  recognitionCount: number;
}

export interface PartnerEnrollmentLink {
  linkId: string;
  displayName: string;
}

export function PartnerBusinessPanel({
  partners,
  eligibleLinks,
}: {
  partners: PartnerBusinessRow[];
  eligibleLinks: PartnerEnrollmentLink[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [linkId, setLinkId] = useState(eligibleLinks[0]?.linkId ?? "");
  const [agreementReference, setAgreementReference] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const enroll = () => {
    if (!linkId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await enrollChannelPartnerAction({
        linkId,
        ...(agreementReference.trim() ? { agreementReference: agreementReference.trim() } : {}),
      });
      setMessage(result.ok
        ? `Reseller ${result.partnerId} enrolled. Review standing before activating it.`
        : result.message);
      if (result.ok) router.refresh();
    });
  };

  const setStanding = (partnerId: string, standing: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateChannelPartnerStandingAction(partnerId, standing);
      setMessage(result.ok ? `${partnerId} is now ${result.standing}.` : result.message);
      if (result.ok) router.refresh();
    });
  };

  const columns: Column<PartnerBusinessRow>[] = [
    {
      key: "reseller",
      header: "Reseller",
      sortAccessor: (partner) => partner.displayName,
      cell: (partner) => (
        <div>
          <p className="font-medium text-[var(--dpf-text)]">{partner.displayName}</p>
          <p className="text-xs text-[var(--dpf-muted)]">{partner.tier} · {partner.linkName ?? "No active link"}</p>
        </div>
      ),
    },
    {
      key: "standing",
      header: "Standing",
      sortAccessor: (partner) => partner.standing,
      cell: (partner) => (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={partner.standing} intent={partner.standing === "active" ? "success" : partner.standing === "suspended" || partner.standing === "at-risk" ? "warning" : "neutral"} variant="soft" />
          <select
            aria-label={`Standing for ${partner.displayName}`}
            value={partner.standing}
            disabled={pending}
            onChange={(event) => setStanding(partner.partnerId, event.target.value)}
            className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)]"
          >
            {['pending', 'active', 'at-risk', 'suspended', 'terminated'].map((standing) => <option key={standing} value={standing}>{standing}</option>)}
          </select>
        </div>
      ),
    },
    {
      key: "agreement",
      header: "Agreement",
      cell: (partner) => <span className="text-xs text-[var(--dpf-muted)]">{partner.agreementReference ?? "No reference"}</span>,
      sortAccessor: (partner) => partner.agreementReference ?? "",
    },
    {
      key: "coverage",
      header: "Business coverage",
      cell: (partner) => (
        <span className="text-xs text-[var(--dpf-muted)]">
          {partner.agreementCount} agreement{partner.agreementCount === 1 ? "" : "s"} · {partner.entitlementCount} entitlement{partner.entitlementCount === 1 ? "" : "s"} · {partner.supportRouteCount} support route{partner.supportRouteCount === 1 ? "" : "s"} · {partner.recognitionCount} recognition{partner.recognitionCount === 1 ? "" : "s"}
        </span>
      ),
    },
  ];

  return (
    <section className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4" aria-labelledby="partner-business-heading">
      <div>
        <h2 id="partner-business-heading" className="text-sm font-semibold text-[var(--dpf-text)]">Founder Hub reseller network</h2>
        <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">
          Founder Hub owns reseller enrollment, standing, agreements, offering entitlements, support routing, and contribution recognition. These business records are separate from demand sharing and Hive result intake.
        </p>
      </div>

      {message ? <p className="mt-3 text-xs text-[var(--dpf-muted)]" role="status">{message}</p> : null}

      {eligibleLinks.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <label className="text-xs text-[var(--dpf-muted)]">
            Approved channel connection
            <select
              aria-label="Approved channel connection"
              value={linkId}
              onChange={(event) => setLinkId(event.target.value)}
              className="mt-1 block rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1.5 text-sm text-[var(--dpf-text)]"
            >
              {eligibleLinks.map((link) => <option key={link.linkId} value={link.linkId}>{link.displayName}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--dpf-muted)]">
            Agreement reference (optional)
            <input
              aria-label="Agreement reference (optional)"
              value={agreementReference}
              onChange={(event) => setAgreementReference(event.target.value)}
              placeholder="Signed agreement or CRM reference"
              className="mt-1 block w-64 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1.5 text-sm text-[var(--dpf-text)]"
            />
          </label>
          <button
            type="button"
            disabled={pending || !linkId}
            onClick={enroll}
            className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--dpf-bg)] disabled:opacity-50"
          >
            {pending ? <InlineBusy label="Enrolling…" tone="current" /> : "Enroll reseller"}
          </button>
        </div>
      ) : null}

      {partners.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            size="sm"
            title="No resellers enrolled"
            description="Create and approve an upstream channel connection first, then enroll that peer here. Demand and code sharing remain independently controlled."
          />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-[var(--dpf-border)]">
          <DataTable
            columns={columns}
            rows={partners}
            getRowKey={(partner) => partner.partnerId}
            initialSort={{ key: "reseller", dir: "asc" }}
            pageSize={20}
            dense
          />
        </div>
      )}
    </section>
  );
}
