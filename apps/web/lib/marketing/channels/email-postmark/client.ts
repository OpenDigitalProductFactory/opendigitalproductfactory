// Postmark — thin HTTP client.
//
// Three surfaces in Phase 3:
//   POST /email           — single transactional send
//   verifyInboundWebhook  — HMAC-SHA256 verification of the inbound payload
//                           using the operator's stored signing secret
//   parseInboundPayload   — typed reader of the Postmark inbound JSON shape

import { createHmac, timingSafeEqual } from "node:crypto";

export const POSTMARK_EMAIL_URL = "https://api.postmarkapp.com/email";

export type PostmarkSendInput = {
  from: string;
  to: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  replyTo?: string;
  tag?: string;
};

export type PostmarkSendResult =
  | { ok: true; messageId: string; submittedAt?: string }
  | { ok: false; status: number; error: string; retryable: boolean };

export type FetchImpl = (
  url: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

const defaultFetch: FetchImpl = (url, init) =>
  fetch(url, init) as ReturnType<FetchImpl>;

export async function sendEmail(
  serverToken: string,
  input: PostmarkSendInput,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<PostmarkSendResult> {
  const payload: Record<string, unknown> = {
    From: input.from,
    To: input.to,
    Subject: input.subject,
    MessageStream: "outbound",
  };
  if (input.textBody) payload.TextBody = input.textBody;
  if (input.htmlBody) payload.HtmlBody = input.htmlBody;
  if (input.replyTo) payload.ReplyTo = input.replyTo;
  if (input.tag) payload.Tag = input.tag;

  if (!input.textBody && !input.htmlBody) {
    return { ok: false, status: 0, error: "no_body", retryable: false };
  }

  const res = await fetchImpl(POSTMARK_EMAIL_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": serverToken,
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    const json = (await res.json()) as { MessageID?: string; SubmittedAt?: string };
    if (!json.MessageID) {
      return { ok: false, status: 200, error: "no_message_id_in_response", retryable: false };
    }
    return {
      ok: true,
      messageId: json.MessageID,
      ...(json.SubmittedAt ? { submittedAt: json.SubmittedAt } : {}),
    };
  }

  const text = await res.text().catch(() => "");
  const retryable = res.status === 429 || res.status >= 500;
  const errorTag =
    res.status === 401 ? "postmark_invalid_server_token"
    : res.status === 422 ? "postmark_invalid_payload"
    : res.status === 429 ? "postmark_rate_limited"
    : `postmark_http_${res.status}`;
  return { ok: false, status: res.status, error: `${errorTag}: ${text.slice(0, 200)}`, retryable };
}

// ─── Inbound webhook verification ───────────────────────────────────────────
//
// Postmark sets the `X-Postmark-Signature` header on inbound webhook POSTs.
// We verify it against the operator-supplied signing secret using
// HMAC-SHA256 over the raw body, timing-safe-compared to defeat
// constant-time-attack-style signature probing. If the secret is empty
// (operator hasn't configured signing yet) we REFUSE — no soft fallback.

export function verifyInboundSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  signingSecret: string;
}): boolean {
  if (!input.signatureHeader || !input.signingSecret) return false;

  let provided: Buffer;
  try {
    provided = Buffer.from(input.signatureHeader, "base64");
  } catch {
    return false;
  }
  const computed = createHmac("sha256", input.signingSecret)
    .update(input.rawBody, "utf8")
    .digest();
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(provided, computed);
}

// ─── Inbound payload parsing ────────────────────────────────────────────────

export type ParsedInboundEmail = {
  externalMessageId: string | null;
  externalThreadId: string;
  fromAddress: string | null;
  fromDisplayName: string | null;
  toAddress: string | null;
  subject: string | null;
  textBody: string;
  htmlBody: string | null;
  receivedAt: Date;
  metadata: Record<string, unknown>;
};

type PostmarkInboundShape = {
  MessageID?: string;
  Date?: string;
  Subject?: string;
  From?: string;
  FromFull?: { Email?: string; Name?: string };
  To?: string;
  ToFull?: Array<{ Email?: string; Name?: string }>;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Headers?: Array<{ Name?: string; Value?: string }>;
  MessageStream?: string;
};

export function parseInboundPayload(raw: unknown): ParsedInboundEmail | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as PostmarkInboundShape;

  const messageId = typeof p.MessageID === "string" ? p.MessageID : null;
  if (!messageId) return null;

  // Use the In-Reply-To / References header for thread continuity when
  // available; fall back to the message id itself for a new conversation.
  const headers = Array.isArray(p.Headers) ? p.Headers : [];
  const inReplyTo = headers.find((h) => h.Name === "In-Reply-To")?.Value ?? null;
  const externalThreadId = inReplyTo ?? messageId;

  const textBody =
    typeof p.StrippedTextReply === "string" && p.StrippedTextReply.length > 0
      ? p.StrippedTextReply
      : typeof p.TextBody === "string"
        ? p.TextBody
        : "";

  return {
    externalMessageId: messageId,
    externalThreadId,
    fromAddress: p.FromFull?.Email ?? p.From ?? null,
    fromDisplayName: p.FromFull?.Name ?? null,
    toAddress: p.To ?? null,
    subject: p.Subject ?? null,
    textBody,
    htmlBody: typeof p.HtmlBody === "string" ? p.HtmlBody : null,
    receivedAt: p.Date ? new Date(p.Date) : new Date(),
    metadata: {
      messageStream: p.MessageStream ?? "inbound",
      headerCount: headers.length,
    },
  };
}
