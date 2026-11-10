// Microsoft 365 mailbox adapter (design 2026-09-09 §4.4, BI-13919D7E).
//
// Reads the Inbox through the Graph messages delta query so each poll asks only
// for what changed; the returned `@odata.deltaLink` is the cursor. Reuses the
// existing client-credentials token client rather than adding a second Microsoft
// auth path (alternative-channels plan, shared rule 1).

import {
  exchangeMicrosoftGraphClientCredentials,
} from "@/lib/integrations/microsoft365-communications/token-client";
import { resolveMicrosoftGraphBaseUrl } from "@/lib/integrations/microsoft365-communications/communications-client";

import type {
  MailAddress,
  MailboxFetchResult,
  MailboxProbeResult,
  MailboxProviderAdapter,
  MailHeaderSubset,
  Microsoft365MailboxSettings,
  NormalizedInboundMail,
} from "./types";
import { safeProviderError } from "./types";
import { err, ok } from "@/lib/shared/action-result";

export type GraphMessage = {
  id: string;
  internetMessageId?: string | null;
  subject?: string | null;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string | null; name?: string | null } } | null;
  toRecipients?: Array<{ emailAddress?: { address?: string | null; name?: string | null } }>;
  body?: { contentType?: string; content?: string } | null;
  bodyPreview?: string | null;
  hasAttachments?: boolean;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  /** Present on delta pages for removed items; such entries are skipped. */
  "@removed"?: { reason?: string };
};

export type GraphDeltaPage = {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

export interface Microsoft365AdapterDeps {
  /** GET an absolute or Graph-relative URL with a bearer token; test seam. */
  graphGet?: <T>(url: string, accessToken: string) => Promise<T>;
  exchange?: typeof exchangeMicrosoftGraphClientCredentials;
}

const DEFAULT_LIMIT = 50;
const SELECT =
  "$select=id,internetMessageId,subject,receivedDateTime,from,toRecipients,body,bodyPreview,hasAttachments,internetMessageHeaders";

async function defaultGraphGet<T>(url: string, accessToken: string): Promise<T> {
  const absolute = url.startsWith("http") ? url : `${resolveMicrosoftGraphBaseUrl()}${url}`;
  const response = await fetch(absolute, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      // Ask Graph for text bodies so HTML never has to be stripped here.
      prefer: 'outlook.body-content-type="text"',
    },
  });
  if (!response.ok) throw new Error(`Graph mail read failed with status ${response.status}`);
  return (await response.json()) as T;
}

function toAddress(entry: { address?: string | null; name?: string | null } | undefined | null): MailAddress | null {
  if (!entry?.address) return null;
  return { address: entry.address.trim().toLowerCase(), name: entry.name?.trim() || null };
}

/** Pure: a Graph message → the provider-neutral shape. Exported for tests. */
export function normalizeGraphMessage(message: GraphMessage): NormalizedInboundMail {
  const headers: MailHeaderSubset = {};
  let inReplyTo: string | null = null;
  let references: string[] = [];
  for (const header of message.internetMessageHeaders ?? []) {
    const name = header.name.toLowerCase();
    if (name === "in-reply-to") inReplyTo = header.value.trim();
    else if (name === "references") references = header.value.split(/\s+/).filter(Boolean);
    else if (
      name === "auto-submitted" ||
      name === "list-id" ||
      name === "list-unsubscribe" ||
      name === "precedence" ||
      name === "x-auto-response-suppress" ||
      name === "content-type"
    ) {
      headers[name] = header.value;
    }
  }
  const isHtml = (message.body?.contentType ?? "").toLowerCase() === "html";
  const content = message.body?.content ?? "";
  return {
    providerMessageId: message.id,
    messageIdHeader: message.internetMessageId ?? null,
    inReplyTo,
    references,
    from: toAddress(message.from?.emailAddress),
    to: (message.toRecipients ?? []).map((r) => toAddress(r.emailAddress)).filter((a): a is MailAddress => a !== null),
    subject: message.subject ?? null,
    textBody: isHtml ? (message.bodyPreview ?? "") : content,
    htmlBody: isHtml ? content : null,
    receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
    headers,
    // Graph lists attachments on a separate resource; the flag is all a poll reads.
    attachments: message.hasAttachments ? [{ filename: null, contentType: null, size: null }] : [],
  };
}

export function createMicrosoft365Adapter(deps: Microsoft365AdapterDeps = {}): MailboxProviderAdapter<"microsoft365"> {
  const graphGet = deps.graphGet ?? defaultGraphGet;
  const exchange = deps.exchange ?? exchangeMicrosoftGraphClientCredentials;

  async function token(settings: Microsoft365MailboxSettings, clientSecret: string): Promise<string> {
    const result = await exchange({ tenantId: settings.tenantId, clientId: settings.clientId, clientSecret });
    return result.accessToken;
  }

  return {
    provider: "microsoft365",
    pollable: true,

    async probe(settings, secrets): Promise<MailboxProbeResult> {
      try {
        const accessToken = await token(settings, secrets.clientSecret);
        const upn = encodeURIComponent(settings.mailboxUserPrincipalName);
        const user = await graphGet<{ displayName?: string; mail?: string | null }>(
          `/v1.0/users/${upn}?$select=id,displayName,mail`,
          accessToken,
        );
        return ok({ mailboxLabel: `${user.displayName ?? settings.mailboxUserPrincipalName} · ${user.mail ?? settings.mailboxUserPrincipalName}` });
      } catch (error) {
        return err(safeProviderError(error));
      }
    },

    async fetchNew(settings, secrets, cursor, options): Promise<MailboxFetchResult<"microsoft365">> {
      const limit = options?.limit ?? DEFAULT_LIMIT;
      const accessToken = await token(settings, secrets.clientSecret);
      const upn = encodeURIComponent(settings.mailboxUserPrincipalName);
      // First read: a delta query with no cursor returns the current state, which
      // for an established mailbox is its whole history. Bound it to recent mail so
      // connecting a ten-year-old inbox does not route a decade of correspondence.
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      let url =
        cursor?.deltaLink ??
        `/v1.0/users/${upn}/mailFolders/Inbox/messages/delta?${SELECT}&$filter=receivedDateTime ge ${since}&$top=${limit}`;
      const messages: NormalizedInboundMail[] = [];
      let deltaLink: string | null = null;
      // Follow nextLink pages until the deltaLink arrives or the poll's budget is spent.
      for (let page = 0; page < 20; page += 1) {
        const body = await graphGet<GraphDeltaPage>(url, accessToken);
        for (const message of body.value ?? []) {
          if (message["@removed"]) continue;
          messages.push(normalizeGraphMessage(message));
        }
        if (body["@odata.deltaLink"]) {
          deltaLink = body["@odata.deltaLink"];
          break;
        }
        if (!body["@odata.nextLink"] || messages.length >= limit) {
          // No deltaLink yet: keep the old cursor so the next poll resumes; a
          // re-read is absorbed by the unique message-id index.
          deltaLink = cursor?.deltaLink ?? null;
          if (body["@odata.nextLink"]) deltaLink = body["@odata.nextLink"];
          break;
        }
        url = body["@odata.nextLink"];
      }
      return { messages, cursor: deltaLink ? { deltaLink } : cursor };
    },
  };
}
