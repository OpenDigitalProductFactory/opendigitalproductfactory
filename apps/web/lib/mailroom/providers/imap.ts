// IMAP mailbox adapter (design 2026-09-09 §4.4, BI-13919D7E).
//
// RFC 9051 (IMAP4rev2) over TLS only. The cursor is `{ uidValidity, lastUid }`:
// UIDs are stable within one UIDVALIDITY generation, so "new since last poll" is
// `UID lastUid+1:*`. When the server reports a different UIDVALIDITY the cursor
// is reset and the folder is re-read from the configured start; the database's
// unique (channelId, externalMessageId) index absorbs any re-read.
//
// Library: imapflow (MIT; promise API, UID search, UIDVALIDITY on the mailbox
// object) and mailparser (MIT; MIME → text/html/attachments). Both are injected
// behind small ports so the adapter is unit-tested without a server.

import type {
  ImapMailboxSettings,
  MailAddress,
  MailboxFetchResult,
  MailboxProbeResult,
  MailboxProviderAdapter,
  MailHeaderSubset,
  NormalizedInboundMail,
} from "./types";
import { safeProviderError } from "./types";

/** The slice of imapflow's client this adapter uses. */
export interface ImapClientPort {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  /** imapflow exposes the selected mailbox's UIDVALIDITY / UIDNEXT here. */
  readonly mailbox: { uidValidity: bigint | number; uidNext?: number; exists?: number } | false;
  search(query: { uid: string }, options: { uid: true }): Promise<number[] | false>;
  fetchOne(
    seq: string,
    query: { uid: true; source: true; internalDate: true },
    options: { uid: true },
  ): Promise<{ uid: number; source?: Buffer; internalDate?: Date } | false>;
}

export type ImapClientFactory = (config: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}) => ImapClientPort;

/** The slice of mailparser this adapter uses. */
export type ParsedMailPort = {
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
  from?: { value: Array<{ address?: string; name?: string }> };
  to?: { value: Array<{ address?: string; name?: string }> } | Array<{ value: Array<{ address?: string; name?: string }> }>;
  subject?: string;
  text?: string;
  html?: string | false;
  date?: Date;
  headers: Map<string, unknown>;
  attachments?: Array<{ filename?: string; contentType?: string; size?: number }>;
};
export type MailParserPort = (source: Buffer) => Promise<ParsedMailPort>;

export interface ImapAdapterDeps {
  createClient?: ImapClientFactory;
  parse?: MailParserPort;
}

const DEFAULT_FOLDER = "INBOX";
const DEFAULT_LIMIT = 50;

async function defaultCreateClient(config: Parameters<ImapClientFactory>[0]): Promise<ImapClientPort> {
  const { ImapFlow } = await import("imapflow");
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // STARTTLS is required when the connection is not implicit TLS; a plaintext
    // fallback would send the password in the clear.
    ...(config.secure ? {} : { requireTLS: true } as object),
    auth: config.auth,
    logger: false,
  }) as unknown as ImapClientPort;
}

async function defaultParse(source: Buffer): Promise<ParsedMailPort> {
  const { simpleParser } = await import("mailparser");
  return (await simpleParser(source)) as unknown as ParsedMailPort;
}

function toAddress(entry: { address?: string; name?: string } | undefined): MailAddress | null {
  if (!entry?.address) return null;
  return { address: entry.address.trim().toLowerCase(), name: entry.name?.trim() || null };
}

function headerString(headers: Map<string, unknown>, name: string): string | undefined {
  const value = headers.get(name);
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "value" in value) {
    const inner = (value as { value: unknown }).value;
    return typeof inner === "string" ? inner : JSON.stringify(inner);
  }
  return String(value);
}

/** Pure: a parsed MIME message → the provider-neutral shape. Exported for tests. */
export function normalizeParsedMail(
  parsed: ParsedMailPort,
  uid: number,
  internalDate: Date | undefined,
): NormalizedInboundMail {
  const toList = Array.isArray(parsed.to) ? parsed.to.flatMap((t) => t.value) : (parsed.to?.value ?? []);
  const references =
    typeof parsed.references === "string"
      ? parsed.references.split(/\s+/).filter(Boolean)
      : (parsed.references ?? []);
  const headers: MailHeaderSubset = {};
  for (const name of ["auto-submitted", "list-id", "list-unsubscribe", "precedence", "x-auto-response-suppress", "content-type"] as const) {
    const value = headerString(parsed.headers, name);
    if (value) headers[name] = value;
  }
  return {
    providerMessageId: String(uid),
    messageIdHeader: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references,
    from: toAddress(parsed.from?.value?.[0]),
    to: toList.map(toAddress).filter((a): a is MailAddress => a !== null),
    subject: parsed.subject ?? null,
    textBody: parsed.text ?? "",
    htmlBody: typeof parsed.html === "string" ? parsed.html : null,
    receivedAt: parsed.date ?? internalDate ?? new Date(),
    headers,
    attachments: (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? null,
      contentType: a.contentType ?? null,
      size: typeof a.size === "number" ? a.size : null,
    })),
  };
}

export function createImapAdapter(deps: ImapAdapterDeps = {}): MailboxProviderAdapter<"imap"> {
  const createClient = deps.createClient;
  const parse = deps.parse ?? defaultParse;

  async function withClient<T>(
    settings: ImapMailboxSettings,
    password: string,
    fn: (client: ImapClientPort) => Promise<T>,
  ): Promise<T> {
    const config = {
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: password },
    };
    const client = createClient ? createClient(config) : await defaultCreateClient(config);
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  return {
    provider: "imap",
    pollable: true,

    async probe(settings, secrets): Promise<MailboxProbeResult> {
      try {
        return await withClient(settings, secrets.password, async (client) => {
          const lock = await client.getMailboxLock(settings.folder ?? DEFAULT_FOLDER);
          try {
            const box = client.mailbox;
            const label = box ? `${settings.user} · ${settings.folder ?? DEFAULT_FOLDER} (${box.exists ?? 0} messages)` : settings.user;
            return { ok: true as const, mailboxLabel: label };
          } finally {
            lock.release();
          }
        });
      } catch (error) {
        return { ok: false, error: safeProviderError(error) };
      }
    },

    async fetchNew(settings, secrets, cursor, options): Promise<MailboxFetchResult<"imap">> {
      const limit = options?.limit ?? DEFAULT_LIMIT;
      return withClient(settings, secrets.password, async (client) => {
        const lock = await client.getMailboxLock(settings.folder ?? DEFAULT_FOLDER);
        try {
          const box = client.mailbox;
          if (!box) throw new Error("mailbox did not open");
          const uidValidity = String(box.uidValidity);
          // A changed UIDVALIDITY invalidates every UID we hold; start over.
          const startUid = cursor && cursor.uidValidity === uidValidity ? cursor.lastUid + 1 : 1;
          const found = await client.search({ uid: `${startUid}:*` }, { uid: true });
          // `UID n:*` on an empty range still returns the last message when n exceeds
          // UIDNEXT-1; filter to what is actually new.
          const uids = (found || []).filter((uid) => uid >= startUid).sort((a, b) => a - b).slice(0, limit);
          const messages: NormalizedInboundMail[] = [];
          let lastUid = cursor && cursor.uidValidity === uidValidity ? cursor.lastUid : 0;
          for (const uid of uids) {
            const raw = await client.fetchOne(String(uid), { uid: true, source: true, internalDate: true }, { uid: true });
            if (!raw || !raw.source) continue;
            const parsed = await parse(raw.source);
            messages.push(normalizeParsedMail(parsed, uid, raw.internalDate));
            lastUid = Math.max(lastUid, uid);
          }
          return { messages, cursor: { uidValidity, lastUid } };
        } finally {
          lock.release();
        }
      });
    },
  };
}
