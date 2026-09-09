// Provider adapter registry (design 2026-09-09 §5, BI-13919D7E).
//
// Keyed on the closed provider set so widening `MailboxProvider` without an
// adapter fails `pnpm --filter web build` — the same compile-time parity the
// communication channel registry uses (channel-parity.ts).

import type { MailboxProviderKey } from "@dpf/db/mailroom-enums";

import { createImapAdapter } from "./imap";
import { createMicrosoft365Adapter } from "./microsoft365";
import type { MailboxProviderAdapter } from "./types";

/** Postmark inbound streams arrive by webhook (BI-DD24A293); nothing to poll. */
const postmarkInboundAdapter: MailboxProviderAdapter<"postmark-inbound"> = {
  provider: "postmark-inbound",
  pollable: false,
  async probe(settings) {
    return settings.inboundAddress
      ? { ok: true, mailboxLabel: `Postmark inbound → ${settings.inboundAddress}` }
      : { ok: false, error: "inbound address required" };
  },
  async fetchNew() {
    return { messages: [], cursor: null };
  },
};

export type MailboxProviderAdapters = { [P in MailboxProviderKey]: MailboxProviderAdapter<P> };

export function createMailboxProviderAdapters(overrides: Partial<MailboxProviderAdapters> = {}): MailboxProviderAdapters {
  return {
    imap: overrides.imap ?? createImapAdapter(),
    microsoft365: overrides.microsoft365 ?? createMicrosoft365Adapter(),
    "postmark-inbound": overrides["postmark-inbound"] ?? postmarkInboundAdapter,
  };
}

export function mailboxProviderAdapter<P extends MailboxProviderKey>(
  adapters: MailboxProviderAdapters,
  provider: P,
): MailboxProviderAdapter<P> {
  return adapters[provider];
}
