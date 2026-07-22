// Marketing execution loop — publish service.
//
// Gated entry point for publishing an approved OutboundDraft to its
// channel adapter. Enforces:
//   - draft.status === "approved"
//   - channel adapter exists for draft.channelId
//   - IntegrationCredential row exists for adapter.credentialIntegrationId, status="connected"
//
// On success: flips draft → "published", writes OutboundPublication.
// On failure: leaves draft in "approved", returns the actionable error.

import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  assertDraftTransition,
  type OutboundDraftStatus,
} from "./execution";
import { getAdapter } from "./channels/registry";
import type { ChannelCredentialBundle } from "./channels/contracts";
import { assessArchetypeFit } from "./archetype-fit";
import { resolveOrgArchetypeCategory } from "./fit-guard";

export type PublishApprovedDraftResult =
  | {
      ok: true;
      publicationId: string;
      externalId: string;
      externalUrl: string | null;
      message: string;
    }
  | { ok: false; error: string; retryable: boolean; message: string };

export async function publishApprovedDraft(input: {
  draftId: string;
  publishedByUserId: string;
  toolExecutionId?: string | null;
}): Promise<PublishApprovedDraftResult> {
  const draft = await prisma.outboundDraft.findUnique({
    where: { draftId: input.draftId },
  });
  if (!draft) {
    return {
      ok: false,
      error: "draft_not_found",
      retryable: false,
      message: `OutboundDraft ${input.draftId} not found.`,
    };
  }

  if ((draft.status as OutboundDraftStatus) !== "approved") {
    return {
      ok: false,
      error: "draft_not_approved",
      retryable: false,
      message: `Draft is in status ${JSON.stringify(draft.status)}; only "approved" drafts can be published.`,
    };
  }

  // Archetype-fit block: software-platform / off-archetype-block content must
  // never reach a real audience, even if it somehow reached "approved".
  const fitCategory = await resolveOrgArchetypeCategory(draft.organizationId);
  const fit = assessArchetypeFit({ text: draft.body, category: fitCategory });
  if (fit.blocked) {
    return {
      ok: false,
      error: "archetype_fit_blocked",
      retryable: false,
      message: fit.summary,
    };
  }

  const adapter = getAdapter(draft.channelId);
  if (!adapter) {
    return {
      ok: false,
      error: "no_adapter",
      retryable: false,
      message: `No channel adapter registered for channelId=${JSON.stringify(draft.channelId)}.`,
    };
  }

  const credentialRow = await prisma.integrationCredential.findUnique({
    where: { integrationId: adapter.credentialIntegrationId },
  });
  if (!credentialRow || credentialRow.status !== "connected") {
    return {
      ok: false,
      error: "credential_not_connected",
      retryable: false,
      message: `Integration ${adapter.credentialIntegrationId} is not connected. Connect it in /platform/tools/integrations/${adapter.credentialIntegrationId} first.`,
    };
  }

  const fields = (decryptJson<Record<string, unknown>>(credentialRow.fieldsEnc) ?? {});
  const tokens = credentialRow.tokenCacheEnc
    ? (decryptJson<Record<string, unknown>>(credentialRow.tokenCacheEnc) ?? {})
    : {};

  const credential: ChannelCredentialBundle = {
    credentialId: credentialRow.id,
    integrationId: credentialRow.integrationId,
    provider: credentialRow.provider,
    status: credentialRow.status,
    fields,
    tokens,
  };

  const validation = adapter.validateDraft(draft);
  if (!validation.ok) {
    return {
      ok: false,
      error: "validation_failed",
      retryable: false,
      message: validation.reason,
    };
  }

  if (!adapter.publish) {
    return {
      ok: false,
      error: "publish_not_supported",
      retryable: false,
      message: `Adapter ${adapter.channelId} does not implement publish.`,
    };
  }

  // Phase 4: spend gate for paid channels. Runs BEFORE the adapter so a
  // ceiling violation can never leak through to a real ads API call.
  if (adapter.capabilities.includes("place-ad")) {
    const { assertSpendWithinCeiling } = await import("./spend-gate");
    const metadata = (draft.metadata ?? {}) as { dailyBudgetCents?: number; totalBudgetCents?: number };
    const proposedSpendCents =
      metadata.totalBudgetCents ?? metadata.dailyBudgetCents ?? 0;
    const gate = await assertSpendWithinCeiling({
      organizationId: draft.organizationId,
      channelId: adapter.channelId,
      proposedSpendCents,
    });
    if (!gate.ok) {
      return {
        ok: false,
        error: "spend_ceiling_exceeded",
        retryable: false,
        message: gate.reason,
      };
    }
  }

  const result = await adapter.publish(draft, credential);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      retryable: result.retryable,
      message: `Publish to ${adapter.displayName} failed: ${result.error}`,
    };
  }

  assertDraftTransition(draft.status as OutboundDraftStatus, "published");

  const publication = await prisma.$transaction(async (tx) => {
    const pub = await tx.outboundPublication.create({
      data: {
        draftId: draft.draftId,
        channelId: adapter.channelId,
        credentialId: credentialRow.id,
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        publishedByUserId: input.publishedByUserId,
        toolExecutionId: input.toolExecutionId ?? null,
        channelMetadata: result.channelMetadata as import("@dpf/db").Prisma.InputJsonValue | undefined,
      },
      select: { publicationId: true },
    });
    await tx.outboundDraft.update({
      where: { draftId: draft.draftId },
      data: { status: "published" },
    });
    return pub;
  });

  return {
    ok: true,
    publicationId: publication.publicationId,
    externalId: result.externalId,
    externalUrl: result.externalUrl,
    message: result.externalUrl
      ? `Published. View on channel: ${result.externalUrl}`
      : `Published. External id: ${result.externalId}`,
  };
}
