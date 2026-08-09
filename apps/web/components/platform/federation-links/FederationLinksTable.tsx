"use client";

import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";
import type { FederationLinkRow } from "./FederationLinksAdminClient";

type IntroducerField = "offersIntroductions" | "acceptsIntroductions";

export function FederationLinksTable({
  rows,
  isPending,
  onApprove,
  onQuarantine,
  onRevoke,
  onEnvironment,
  onIntroducerPolicy,
}: {
  rows: FederationLinkRow[];
  isPending: boolean;
  onApprove: (row: FederationLinkRow) => void;
  onQuarantine: (row: FederationLinkRow) => void;
  onRevoke: (row: FederationLinkRow) => void;
  onEnvironment: (row: FederationLinkRow, value: FederationLinkRow["environmentClass"]) => void;
  onIntroducerPolicy: (row: FederationLinkRow, field: IntroducerField, checked: boolean) => void;
}) {
  const columns: Column<FederationLinkRow>[] = [
    {
      key: "peer",
      header: "Peer",
      sortAccessor: (row) => row.displayName,
      cell: (row) => <>{row.displayName}{row.peerOrganizationRef && <span className="ml-1 text-[var(--dpf-muted)]">({row.peerOrganizationRef})</span>}</>,
    },
    { key: "role", header: "Role", sortAccessor: (row) => row.role, cell: (row) => row.role },
    { key: "state", header: "State", sortAccessor: (row) => row.linkState, cell: (row) => <StatusBadge domain="federationLinkState" status={row.linkState} /> },
    { key: "approvals", header: "Approvals", cell: (row) => <>ours {row.approvedLocal ? "✓" : "—"} · peer {row.approvedPeer ? "✓" : "—"}</> },
    {
      key: "scope",
      header: "Shared scope",
      cell: (row) => <>
        <div className="flex flex-wrap gap-1">
          {row.sharedSlices.map((slice) => <span key={slice} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[var(--dpf-text)]">{slice}</span>)}
        </div>
        <span className="mt-0.5 block text-[var(--dpf-muted)]">retain: {row.sharedRetention}</span>
      </>,
    },
    {
      key: "environment",
      header: "Environment",
      cell: (row) => <select
        aria-label={`Environment for ${row.displayName}`}
        value={row.environmentClass}
        disabled={isPending || row.linkState === "revoked"}
        onChange={(event) => onEnvironment(row, event.target.value as FederationLinkRow["environmentClass"])}
        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)] disabled:opacity-50"
      >
        <option value="production">production</option>
        <option value="development">development</option>
        <option value="test">test</option>
      </select>,
    },
    {
      key: "introductions",
      header: "Introductions",
      cell: (row) => <div className="text-[var(--dpf-muted)]">
        {(["acceptsIntroductions", "offersIntroductions"] as const).map((field) => <label key={field} className="block whitespace-nowrap">
          <input type="checkbox" className="mr-1" checked={row[field]}
            disabled={isPending || row.linkState !== "trusted"}
            onChange={(event) => onIntroducerPolicy(row, field, event.target.checked)} />
          {field === "acceptsIntroductions" ? "Accept candidates" : "Offer candidates"}
        </label>)}
      </div>,
    },
    { key: "url", header: "Peer URL", mono: true, cell: (row) => row.peerAuthorityUrl },
    {
      key: "actions",
      header: "Actions",
      cell: (row) => <div className="flex flex-wrap gap-1">
        {row.linkState === "pending" && <button type="button" onClick={() => onApprove(row)} disabled={isPending}
          className="rounded bg-[var(--dpf-success)] px-2 py-1 font-medium text-[var(--dpf-bg)] disabled:opacity-50">Approve</button>}
        {(row.linkState === "pending" || row.linkState === "trusted") && <button type="button" onClick={() => onQuarantine(row)} disabled={isPending}
          className="rounded bg-[var(--dpf-warning)] px-2 py-1 font-medium text-[var(--dpf-bg)] disabled:opacity-50">Quarantine</button>}
        {row.linkState !== "revoked" && <button type="button" onClick={() => onRevoke(row)} disabled={isPending}
          className="rounded bg-[var(--dpf-error)] px-2 py-1 font-medium text-[var(--dpf-bg)] disabled:opacity-50">Revoke</button>}
      </div>,
    },
  ];

  return <>
    <p className="text-xs text-[var(--dpf-muted)]">
      <span className="font-medium text-[var(--dpf-text)]">Shared scope</span> is exactly what crosses each link to the peer — the minimum-necessary projection enforced at egress. Nothing outside it leaves this deployment.
    </p>
    <div className="overflow-x-auto">
      <DataTable
        rows={rows}
        columns={columns}
        getRowKey={(row) => row.linkId}
        empty="No federation links yet. Find an installation above, or use recovery options."
        initialSort={{ key: "peer", dir: "asc" }}
        pageSize={20}
        dense
        ariaLabel="Federation connections"
      />
    </div>
  </>;
}
