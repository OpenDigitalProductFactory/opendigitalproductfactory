"use client";

// OAuthClientPeople — who holds grants under one client registration, with a
// per-person revoke (BI-0A724798). A browser-registered client like Claude
// Code is shared by everyone who connects it; this ends one person's access
// without disconnecting anyone else. The whole-client revoke stays on the row.

import { UserX } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { promptDialog } from "@/components/ui/Dialog";
import { Surface } from "@/components/ui/Surface";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { Notice } from "@/components/ui/report-kit/Notice";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { listOAuthClientPeople, revokeOAuthClientPersonGrants } from "@/lib/actions/oauth-clients";
import type { ClientPerson } from "@/lib/auth/oauth-client-people";
import { formatTimestamp } from "@/lib/datetime";

export function OAuthClientPeople({ clientId, clientName, onChanged }: { clientId: string; clientName: string; onChanged: () => void }) {
  const [people, setPeople] = useState<ClientPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const result = await listOAuthClientPeople({ clientId });
      if (result.ok) setPeople(result.data);
      else setNotice({ kind: "error", message: result.error });
      setLoading(false);
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the client changes
  useEffect(() => { setLoading(true); setNotice(null); load(); }, [clientId]);

  async function revoke(person: ClientPerson) {
    const reason = await promptDialog({
      title: "End this person's access",
      message: `${person.email} will be disconnected from ${clientName}. Everyone else stays connected. They can reconnect by signing in again. Why is their access ending?`,
      tone: "danger",
      confirmLabel: "Revoke this person's access",
      placeholder: "For example: setup account nobody uses",
      required: true,
    });
    if (!reason) return;
    startTransition(async () => {
      const result = await revokeOAuthClientPersonGrants({ clientId, userId: person.userId, reason });
      setNotice(
        result.ok
          ? { kind: "success", message: `Ended ${person.email}'s access (${result.data.revokedRefreshTokens} sign-in grant${result.data.revokedRefreshTokens === 1 ? "" : "s"}, ${result.data.revokedAccessTokens} access token${result.data.revokedAccessTokens === 1 ? "" : "s"}).` }
          : { kind: "error", message: result.error },
      );
      load();
      onChanged();
    });
  }

  const columns: Column<ClientPerson>[] = [
    { key: "email", header: "Person", cell: (row) => <span className="text-[var(--dpf-text)]">{row.email}</span> },
    { key: "live", header: "Live grants", align: "right", cell: (row) => row.liveRefreshGrants + row.liveAccessTokens },
    { key: "lastUsed", header: "Last used", cell: (row) => formatTimestamp(row.lastUsedAt, "never") },
    {
      key: "status",
      header: "Status",
      cell: (row) =>
        row.lastRevocation && row.liveRefreshGrants + row.liveAccessTokens === 0 ? (
          <span className="text-[var(--dpf-muted)]">
            Revoked {formatTimestamp(row.lastRevocation.at, "")}: {row.lastRevocation.reason.replace(/^operator_revoked_person: /, "")}
          </span>
        ) : row.liveRefreshGrants + row.liveAccessTokens > 0 ? (
          <StatusBadge intent="success" label="Connected" size="sm" />
        ) : (
          <StatusBadge intent="neutral" label="Expired" size="sm" />
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (row) =>
        row.isYou ? (
          <span className="text-sm text-[var(--dpf-muted)]">You</span>
        ) : row.liveRefreshGrants + row.liveAccessTokens > 0 ? (
          <Button variant="danger" size="sm" type="button" disabled={pending} onClick={() => revoke(row)} aria-label={`Revoke ${row.email}'s access to ${clientName}`}>
            <UserX className="h-3.5 w-3.5" aria-hidden="true" />
            Revoke this person&apos;s access
          </Button>
        ) : null,
    },
  ];

  return (
    <Surface as="section" level={2} padding="sm" rounded="md" className="mt-3" aria-label={`People connected to ${clientName}`}>
      <h3 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">People connected to {clientName}</h3>
      {notice ? <Notice variant={notice.kind} className="mb-2">{notice.message}</Notice> : null}
      <DataTable
        columns={columns}
        rows={people}
        getRowKey={(row) => row.userId}
        loading={loading}
        dense
        ariaLabel={`People connected to ${clientName}`}
        empty={<span>Nobody is connected.</span>}
      />
    </Surface>
  );
}
