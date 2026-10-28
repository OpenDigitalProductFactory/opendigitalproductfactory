"use client";

// AccountAgentAccessPanel — every agent credential one account still holds,
// across every client, with one governed control to end it (BI-DB506554).
// A handover moves work, not access, so a handed-over account keeps its
// tokens, its app sign-ins and the automated-tool keys it owns until an
// operator ends them here. The per-client People panel stays for ending one
// person's access under one app.

import { UserX } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { promptDialog } from "@/components/ui/Dialog";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { Notice } from "@/components/ui/report-kit/Notice";
import { endAccountAgentAccessAction, listAccountAgentAccessAction } from "@/lib/actions/oauth-clients";
import type { AccountAgentAccess } from "@/lib/auth/account-agent-access";
import { formatTimestamp } from "@/lib/datetime";
import { useT } from "@/lib/i18n/use-t";
import { AGENT_ACCESS_PANEL } from "@/lib/navigation/admin-location";

type PersonalToken = AccountAgentAccess["personalTokens"][number];
type ClientGrant = AccountAgentAccess["clientGrants"][number];
type OwnedClient = AccountAgentAccess["ownedCredentialsClients"][number];

export function AccountAgentAccessPanel({ initialAccount }: { initialAccount?: string | null }) {
  const t = useT("admin");
  const [account, setAccount] = useState(initialAccount ?? "");
  const [view, setView] = useState<AccountAgentAccess | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  // Closed on arrival (lib/ux-budget disclosure region): the page is already
  // long. A link that names an account opens it.
  const [open, setOpen] = useState(Boolean(initialAccount));

  function load(key: string, keepNotice = false) {
    if (!key.trim()) return;
    startTransition(async () => {
      const result = await listAccountAgentAccessAction({ account: key });
      if (!keepNotice) setNotice(null);
      if (result.ok) setView(result.data);
      else {
        setView(null);
        setNotice({ kind: "error", message: result.error });
      }
    });
  }

  // A link from the handover plan opens the panel on that account.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once for the linked account
  useEffect(() => { if (initialAccount) load(initialAccount); }, [initialAccount]);

  async function end(current: AccountAgentAccess) {
    const reason = await promptDialog({
      title: t("accountAgentAccess.dialogTitle"),
      message: t("accountAgentAccess.dialogMessage", { email: current.account.email }),
      tone: "danger",
      confirmLabel: t("accountAgentAccess.end"),
      placeholder: t("accountAgentAccess.dialogPlaceholder"),
      required: true,
    });
    if (!reason) return;
    startTransition(async () => {
      const result = await endAccountAgentAccessAction({ userId: current.account.userId, reason });
      setNotice(
        result.ok
          ? {
              kind: "success",
              message: t("accountAgentAccess.endedNotice", {
                email: current.account.email,
                tokens: result.data.revokedAccessTokens,
                grants: result.data.revokedRefreshTokens,
                clients: result.data.revokedCredentialsClients,
              }),
            }
          : { kind: "error", message: result.error },
      );
      load(current.account.email, true);
    });
  }

  const never = t("accountAgentAccess.never");
  const personalColumns: Column<PersonalToken>[] = [
    { key: "name", header: t("accountAgentAccess.colName"), cell: (row) => <span className="text-[var(--dpf-text)]">{row.name}</span> },
    { key: "token", header: t("accountAgentAccess.colToken"), cell: (row) => <span className="font-mono text-xs">{row.prefix}…{row.tokenSuffix ?? ""}</span> },
    { key: "lastUsed", header: t("accountAgentAccess.colLastUsed"), cell: (row) => formatTimestamp(row.lastUsedAt, never) },
  ];
  const clientColumns: Column<ClientGrant>[] = [
    { key: "app", header: t("accountAgentAccess.colApp"), cell: (row) => <span className="text-[var(--dpf-text)]">{row.clientName}</span> },
    { key: "clientId", header: t("accountAgentAccess.colClientId"), cell: (row) => <span className="font-mono text-xs">{row.clientId}</span> },
    { key: "access", header: t("accountAgentAccess.colAccessTokens"), align: "right", cell: (row) => row.liveAccessTokens },
    { key: "grants", header: t("accountAgentAccess.colGrants"), align: "right", cell: (row) => row.liveRefreshGrants },
    { key: "lastUsed", header: t("accountAgentAccess.colLastUsed"), cell: (row) => formatTimestamp(row.lastUsedAt, never) },
  ];
  const ownedColumns: Column<OwnedClient>[] = [
    { key: "name", header: t("accountAgentAccess.colName"), cell: (row) => <span className="text-[var(--dpf-text)]">{row.clientName}</span> },
    { key: "clientId", header: t("accountAgentAccess.colClientId"), cell: (row) => <span className="font-mono text-xs">{row.clientId}</span> },
    { key: "lastUsed", header: t("accountAgentAccess.colLastUsed"), cell: (row) => formatTimestamp(row.lastUsedAt, never) },
    { key: "created", header: t("accountAgentAccess.colCreated"), cell: (row) => formatTimestamp(row.createdAt, "") },
  ];

  const totals = view?.totals;
  const anyLive = !!totals && totals.personalTokens + totals.oauthAccessTokens + totals.refreshGrants + totals.credentialsClients > 0;

  return (
    <Surface id={AGENT_ACCESS_PANEL.anchor} level={1} padding="none" rounded="xl" className="mt-6 scroll-mt-6">
      <details open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none px-4 py-3 text-base font-semibold text-[var(--dpf-text)]">
        {t("accountAgentAccess.heading")}
      </summary>
      <div className="px-4 pb-4">
      <p className="max-w-3xl text-sm text-[var(--dpf-muted)]">{t("accountAgentAccess.intro")}</p>

      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(event) => { event.preventDefault(); load(account); }}
        aria-label={t("accountAgentAccess.heading")}
      >
        <div className="min-w-0 flex-1 basis-64">
          <TextField
            name="account"
            inputMode="email"
            label={t("accountAgentAccess.accountLabel")}
            hint={t("accountAgentAccess.accountHint")}
            value={account}
            onValueChange={setAccount}
            autoComplete="off"
            required
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending || !account.trim()}>
          {pending && !view ? t("accountAgentAccess.loading") : t("accountAgentAccess.show")}
        </Button>
      </form>

      {notice ? <Notice variant={notice.kind} className="mt-3">{notice.message}</Notice> : null}

      {view ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-[var(--dpf-text)]">{view.account.email}</p>
            {view.account.workHandedOverAt ? (
              <Notice variant="warn" className="mt-1">{t("accountAgentAccess.handedOver", { when: formatTimestamp(view.account.workHandedOverAt, "") })}</Notice>
            ) : null}
            {!view.account.isActive ? <p className="text-sm text-[var(--dpf-muted)]">{t("accountAgentAccess.inactive")}</p> : null}
          </div>

          {!anyLive ? (
            <p className="text-sm text-[var(--dpf-muted)]">{t("accountAgentAccess.nothingLive")}</p>
          ) : (
            <>
              {view.personalTokens.length > 0 ? (
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-[var(--dpf-text)]">{t("accountAgentAccess.personalHeading")}</h3>
                  <DataTable columns={personalColumns} rows={view.personalTokens} getRowKey={(row) => row.id} dense ariaLabel={t("accountAgentAccess.personalHeading")} />
                </div>
              ) : null}
              {view.clientGrants.length > 0 ? (
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-[var(--dpf-text)]">{t("accountAgentAccess.clientsHeading")}</h3>
                  <DataTable columns={clientColumns} rows={view.clientGrants} getRowKey={(row) => row.clientId} dense ariaLabel={t("accountAgentAccess.clientsHeading")} />
                </div>
              ) : null}
              {view.ownedCredentialsClients.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{t("accountAgentAccess.ownedHeading")}</h3>
                  <p className="mb-1 text-xs text-[var(--dpf-muted)]">{t("accountAgentAccess.ownedHint")}</p>
                  <DataTable columns={ownedColumns} rows={view.ownedCredentialsClients} getRowKey={(row) => row.clientId} dense ariaLabel={t("accountAgentAccess.ownedHeading")} />
                </div>
              ) : null}
              {view.account.isYou ? (
                <p className="text-sm text-[var(--dpf-muted)]">{t("accountAgentAccess.you")}</p>
              ) : (
                <Button type="button" variant="danger" disabled={pending} onClick={() => end(view)}>
                  <UserX className="h-4 w-4" aria-hidden="true" />
                  {t("accountAgentAccess.end")}
                </Button>
              )}
            </>
          )}
        </div>
      ) : null}
      </div>
      </details>
    </Surface>
  );
}
