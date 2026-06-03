import type {
  AdapterValidationResult,
  ChannelCredentialBundle,
  OutboundChannelAdapter,
  OutboundDraftLike,
  PublishResult,
} from "../contracts";
import { sendEmail, type FetchImpl } from "./client";

// Per Postmark's docs the body limit is 10 MB (after base64). Keep our cap
// well below that to leave headroom for inline attachments / quoted threads
// added by the operator's mail client. 100 KB is roughly 25 pages of plain
// text — well above any reasonable marketing email length.
const EMAIL_BODY_MAX_BYTES = 100 * 1024;
const SUPPORTED_ASSET_TYPES = new Set(["email", "marketing-email", "Email"]);

export type EmailPostmarkAdapterDeps = {
  fetchImpl?: FetchImpl;
  /** Set to true in tests/dev to skip the real HTTP call and return a fake
   *  Postmark message id. Adapter respects EMAIL_MOCK_MODE === "1"
   *  automatically. */
  mockMode?: boolean;
};

export function createEmailPostmarkAdapter(
  deps: EmailPostmarkAdapterDeps = {},
): OutboundChannelAdapter {
  const mockMode = deps.mockMode ?? process.env.EMAIL_MOCK_MODE === "1";

  return {
    channelId: "email-postmark",
    displayName: "Email (Postmark)",
    capabilities: ["draft-preview", "send-email", "receive-inbound"],
    credentialIntegrationId: "email-postmark",
    assetTypes: ["email", "marketing-email"],

    validateDraft(draft: OutboundDraftLike): AdapterValidationResult {
      if (!SUPPORTED_ASSET_TYPES.has(draft.assetType)) {
        return {
          ok: false,
          reason: `Unsupported asset type for Postmark email: ${JSON.stringify(draft.assetType)}`,
        };
      }
      if (draft.channelId !== "email" && draft.channelId !== "email-postmark") {
        return {
          ok: false,
          reason: `Unexpected channelId ${JSON.stringify(draft.channelId)} routed to email-postmark adapter`,
        };
      }
      if (Buffer.byteLength(draft.body, "utf8") > EMAIL_BODY_MAX_BYTES) {
        return {
          ok: false,
          reason: `Body exceeds Postmark practical limit (${EMAIL_BODY_MAX_BYTES} bytes)`,
        };
      }
      const { subject, to } = readEnvelope(draft);
      if (!subject) {
        return {
          ok: false,
          reason: "Email draft is missing a subject. Add a 'Subject: ...' first line or set metadata.subject.",
        };
      }
      if (!to) {
        return {
          ok: false,
          reason: "Email draft is missing a recipient. Set metadata.to to the recipient email address.",
        };
      }
      return { ok: true };
    },

    async publish(draft, credential): Promise<PublishResult> {
      const validation = this.validateDraft(draft);
      if (!validation.ok) {
        return { ok: false, error: validation.reason, retryable: false };
      }

      const { subject, body, to } = readEnvelope(draft);
      const from = readField(credential, "fromAddress");
      const replyTo = readField(credential, "replyToAddress");
      const serverToken = readToken(credential);

      if (!from) {
        return {
          ok: false,
          error: "Postmark integration is missing a verified From address. Configure it in /platform/tools/integrations/email-postmark.",
          retryable: false,
        };
      }
      if (!serverToken) {
        return {
          ok: false,
          error: "Postmark integration has no server token cached. Reconnect.",
          retryable: false,
        };
      }

      if (mockMode) {
        const fakeId = `mock_postmark_${draft.draftId.slice(0, 12)}`;
        return {
          ok: true,
          externalId: fakeId,
          externalUrl: null,
          channelMetadata: { mock: true, to, from, subject },
        };
      }

      const sendInput: Parameters<typeof sendEmail>[1] = {
        from,
        to: to!, // validated non-null above
        subject: subject!, // validated non-null above
        textBody: body,
      };
      if (replyTo) sendInput.replyTo = replyTo;
      const result = await sendEmail(serverToken, sendInput, deps.fetchImpl);
      if (!result.ok) {
        return { ok: false, error: result.error, retryable: result.retryable };
      }
      return {
        ok: true,
        externalId: result.messageId,
        externalUrl: null, // Postmark transactional sends don't have a public URL
        channelMetadata: { submittedAt: result.submittedAt ?? null },
      };
    },
  };
}

function readEnvelope(draft: OutboundDraftLike): {
  subject: string | null;
  body: string;
  to: string | null;
} {
  const metadata = (draft.metadata ?? {}) as Record<string, unknown>;
  const metadataSubject = typeof metadata["subject"] === "string" ? metadata["subject"] : null;
  const metadataTo = typeof metadata["to"] === "string" ? metadata["to"] : null;
  const lines = draft.body.split(/\r?\n/);
  let subject = metadataSubject;
  let body = draft.body;
  if (!subject) {
    const firstLine = lines[0]?.trim() ?? "";
    if (/^Subject:\s+/i.test(firstLine)) {
      subject = firstLine.replace(/^Subject:\s+/i, "").trim();
      body = lines.slice(1).join("\n").replace(/^\n+/, "");
    }
  }
  return { subject, body, to: metadataTo };
}

function readField(credential: ChannelCredentialBundle, key: string): string | null {
  const v = credential.fields[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readToken(credential: ChannelCredentialBundle): string | null {
  const v = credential.tokens["server_token"];
  return typeof v === "string" && v.length > 0 ? v : null;
}
