"use client";

// Connect-a-mailbox form (design 2026-09-09 §4.9, BI-727D5FD9).
// Probes the provider before anything is saved; a failed probe shows the safe
// provider error and saves nothing. Credentials go only into this form, never
// into chat.

import { useActionState, useState } from "react";

import type { ConnectMailboxResult } from "@/lib/mailroom/mailbox-form";
import { connectMailbox } from "@/app/(shell)/workspace/mailroom/actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/report-kit/Notice";

export type ExpectedMailboxOption = { purposeKey: string; label: string; examples: string[]; why: string };

type Provider = "imap" | "microsoft365" | "postmark-inbound";

const FIELD = "w-full rounded-md border border-[var(--dpf-border)] bg-transparent px-3 py-2 text-sm text-[var(--dpf-text)]";
const LABEL = "block text-xs font-medium text-[var(--dpf-text-muted)] mb-1";

export function MailboxConnectForm({ purposes, defaultPurposeKey }: { purposes: ExpectedMailboxOption[]; defaultPurposeKey?: string }) {
  const [provider, setProvider] = useState<Provider>("imap");
  const [state, action, pending] = useActionState<ConnectMailboxResult | null, FormData>(connectMailbox, null);

  return (
    <form action={action} className="space-y-4" aria-label="Connect a mailbox">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="mailbox-provider">Provider</label>
          <select id="mailbox-provider" name="provider" className={FIELD} value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="imap">IMAP (Gmail, Outlook.com, most mail servers)</option>
            <option value="microsoft365">Microsoft 365 (Graph)</option>
            <option value="postmark-inbound">Postmark inbound stream</option>
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="mailbox-purpose">What this mailbox is for</label>
          <select id="mailbox-purpose" name="purposeKey" className={FIELD} defaultValue={defaultPurposeKey ?? purposes[0]?.purposeKey}>
            {purposes.map((p) => (
              <option key={p.purposeKey} value={p.purposeKey}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="mailbox-address">Mailbox address</label>
          <input id="mailbox-address" name="address" type="email" required className={FIELD} placeholder="adopt@your-rescue.org" autoComplete="off" />
        </div>
        <div>
          <label className={LABEL} htmlFor="mailbox-interval">Read every (minutes)</label>
          <input id="mailbox-interval" name="pollIntervalMinutes" type="number" min={5} max={1440} defaultValue={60} className={FIELD} />
        </div>
      </div>

      {provider === "imap" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="imap-host">IMAP server</label>
            <input id="imap-host" name="host" required className={FIELD} placeholder="imap.gmail.com" autoComplete="off" />
          </div>
          <div>
            <label className={LABEL} htmlFor="imap-port">Port</label>
            <input id="imap-port" name="port" type="number" defaultValue={993} className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="imap-user">Login (blank = the address)</label>
            <input id="imap-user" name="user" className={FIELD} autoComplete="off" />
          </div>
          <div>
            <label className={LABEL} htmlFor="imap-password">Password or app password</label>
            <input id="imap-password" name="password" type="password" required className={FIELD} autoComplete="new-password" />
          </div>
          <div>
            <label className={LABEL} htmlFor="imap-folder">Folder</label>
            <input id="imap-folder" name="folder" defaultValue="INBOX" className={FIELD} />
          </div>
        </div>
      ) : provider === "microsoft365" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="ms-tenant">Tenant id</label>
            <input id="ms-tenant" name="tenantId" required className={FIELD} autoComplete="off" />
          </div>
          <div>
            <label className={LABEL} htmlFor="ms-client">Application (client) id</label>
            <input id="ms-client" name="clientId" required className={FIELD} autoComplete="off" />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="ms-secret">Client secret</label>
            <input id="ms-secret" name="clientSecret" type="password" required className={FIELD} autoComplete="new-password" />
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--dpf-text-muted)]">
          Point the Postmark inbound stream at this install&apos;s webhook; messages sent to the address above will enter the Mailroom.
        </p>
      )}

      <div>
        <label className={LABEL} htmlFor="mailbox-name">Shown as (optional)</label>
        <input id="mailbox-name" name="displayName" className={FIELD} placeholder="Adoptions inbox" />
      </div>

      {state && !state.ok ? <Notice variant="error" title="Not connected">{state.error}</Notice> : null}
      {state && state.ok ? (
        <Notice variant="success" title="Mailbox connected">
          {state.data.mailboxLabel}. {state.data.firstRead}
        </Notice>
      ) : null}

      <Button type="submit" disabled={pending}>{pending ? "Checking the mailbox…" : "Test and connect"}</Button>
    </form>
  );
}
