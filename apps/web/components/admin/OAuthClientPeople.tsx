"use client";

// OAuthClientPeople — who holds grants under one client registration, with a
// per-person revoke (BI-0A724798). A browser-registered client like Claude
// Code is shared by everyone who connects it; this ends one person's access
// without disconnecting anyone else. The whole-client revoke stays on the row.

import { UserX } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { promptDialog } from "@/components/ui/Dialog";
import { Surface } from "@/components/ui/Surface";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { Notice } from "@/components/ui/report-kit/Notice";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { listOAuthClientPeople, revokeOAuthClientPersonGrants } from "@/lib/actions/oauth-clients";
import type { ClientPerson } from "@/lib/auth/oauth-client-people";
import { formatTimestamp } from "@/lib/datetime";
import { useT } from "@/lib/i18n/use-t";

export function OAuthClientPeople({
  clientId,
  clientName,
  registeredAt,
  onChanged,
}: {
  clientId: string;
  clientName: string;
  /** ISO time the registration was created; with the client id it tells same-named registrations apart (BI-287D3EFD). */
  registeredAt: string;
  onChanged: () => void;
}) {
  const [people, setPeople] = useState<ClientPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useT("admin");
  const headingRef = useRef<HTMLHeadingElement>(null);

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

  // The panel renders below the whole keys table; bring it to the operator so
  // the registration it names is the one they see (BI-287D3EFD).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [clientId]);
  // Scroll the whole panel, not just its heading, and only once its people
  // have loaded: scrolling the loading skeleton left the loaded rows, and
  // their revoke buttons, below the fold.
  useEffect(() => {
    if (!loading) headingRef.current?.closest("section")?.scrollIntoView({ block: "nearest" });
  }, [clientId, loading]);

  async function revoke(person: ClientPerson) {
    const reason = await promptDialog({
      title: t("oauthClientPeople.dialogTitle"),
      message: t("oauthClientPeople.dialogMessage", { email: person.email, client: clientName }),
      tone: "danger",
      confirmLabel: t("oauthClientPeople.revoke"),
      placeholder: t("oauthClientPeople.dialogPlaceholder"),
      required: true,
    });
    if (!reason) return;
    startTransition(async () => {
      const result = await revokeOAuthClientPersonGrants({ clientId, userId: person.userId, reason });
      setNotice(
        result.ok
          ? {
              kind: "success",
              message: t("oauthClientPeople.revokedNotice", {
                email: person.email,
                grants: result.data.revokedRefreshTokens,
                tokens: result.data.revokedAccessTokens,
              }),
            }
          : { kind: "error", message: result.error },
      );
      load();
      onChanged();
    });
  }

  const columns: Column<ClientPerson>[] = [
    { key: "email", header: t("oauthClientPeople.colPerson"), cell: (row) => <span className="text-[var(--dpf-text)]">{row.email}</span> },
    { key: "live", header: t("oauthClientPeople.colLive"), align: "right", cell: (row) => row.liveRefreshGrants + row.liveAccessTokens },
    { key: "lastUsed", header: t("oauthClientPeople.colLastUsed"), cell: (row) => formatTimestamp(row.lastUsedAt, t("oauthClientPeople.never")) },
    {
      key: "status",
      header: t("oauthClientPeople.colStatus"),
      cell: (row) =>
        row.lastRevocation && row.liveRefreshGrants + row.liveAccessTokens === 0 ? (
          <span className="text-[var(--dpf-muted)]">
            {t("oauthClientPeople.revoked", {
              when: formatTimestamp(row.lastRevocation.at, ""),
              reason: row.lastRevocation.reason.replace(/^operator_revoked_person: /, ""),
            })}
          </span>
        ) : row.liveRefreshGrants + row.liveAccessTokens > 0 ? (
          <StatusBadge intent="success" label={t("oauthClientPeople.connected")} size="sm" />
        ) : (
          <StatusBadge intent="neutral" label={t("oauthClientPeople.expired")} size="sm" />
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("oauthClientPeople.colActions")}</span>,
      align: "right",
      cell: (row) =>
        row.isYou ? (
          <span className="text-sm text-[var(--dpf-muted)]">{t("oauthClientPeople.you")}</span>
        ) : row.liveRefreshGrants + row.liveAccessTokens > 0 ? (
          <Button variant="danger" size="sm" type="button" disabled={pending} onClick={() => revoke(row)} aria-label={t("oauthClientPeople.revokeAria", { email: row.email, client: clientName })}>
            <UserX className="h-3.5 w-3.5" aria-hidden="true" />
            {t("oauthClientPeople.revoke")}
          </Button>
        ) : null,
    },
  ];

  return (
    <Surface as="section" level={2} padding="sm" rounded="md" className="mt-3" aria-label={t("oauthClientPeople.regionLabel", { client: clientName, clientId })}>
      <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-[var(--dpf-text)] focus:outline-none">
        {t("oauthClientPeople.heading", { client: clientName })}
      </h3>
      <p className="mb-2 font-mono text-xs text-[var(--dpf-muted)]">
        {t("oauthClientPeople.registration", { clientId, when: formatTimestamp(registeredAt, "") })}
      </p>
      {notice ? <Notice variant={notice.kind} className="mb-2">{notice.message}</Notice> : null}
      <DataTable
        columns={columns}
        rows={people}
        getRowKey={(row) => row.userId}
        loading={loading}
        dense
        ariaLabel={t("oauthClientPeople.regionLabel", { client: clientName, clientId })}
        empty={<span>{t("oauthClientPeople.empty")}</span>}
      />
    </Surface>
  );
}
