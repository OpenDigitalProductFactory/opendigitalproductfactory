"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import {
  adoptIncomingDemand,
  setIncomingDemandDisposition,
  type DemandExchangeDb,
} from "@/lib/federation/demand-exchange";
import {
  forwardIncomingDemandToLink,
  selectLocalDemandForLink,
  unselectLocalDemandForLink,
  type ChannelDemandDb,
} from "@/lib/federation/channel-demand";
import { queueDemandResponse, type DemandResponseDb } from "@/lib/federation/demand-response";
import { resolveFederationIdentity, type FederationIdentityDb } from "@/lib/federation/demand-identity";
import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";
import { requireCapability } from "@/lib/actions/shared/guards";

const DEMAND_PATH = "/ops/demand";

export type FederatedDemandActionResult =
  | { ok: true; disposition: "observed" | "followed" | "adopted"; itemId?: string }
  | { ok: false; error: string };

export async function setFederatedDemandFollowAction(
  mirrorId: string,
  followed: boolean,
): Promise<FederatedDemandActionResult> {
  await requireCapability("manage_backlog");
  try {
    const result = await setIncomingDemandDisposition(
      prisma as unknown as DemandExchangeDb,
      mirrorId,
      followed ? "followed" : "observed",
    );
    revalidatePath(DEMAND_PATH);
    return { ok: true, disposition: result.disposition as "observed" | "followed" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to update shared demand." };
  }
}

export async function adoptFederatedDemandAction(mirrorId: string): Promise<FederatedDemandActionResult> {
  await requireCapability("manage_backlog");
  try {
    const result = await adoptIncomingDemand(
      prisma as unknown as DemandExchangeDb,
      mirrorId,
      (input) => ingestBacklogItem(input),
    );
    revalidatePath(DEMAND_PATH);
    revalidatePath("/ops");
    return { ok: true, disposition: "adopted", itemId: result.itemId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to adopt shared demand." };
  }
}

export type FederatedDemandShareResult =
  | { ok: true; action: "queued" | "noop"; message: string }
  | { ok: false; error: string };

export async function shareLocalDemandWithLinkAction(input: {
  linkId: string;
  itemId: string;
  allowForwardToFounder?: boolean;
}): Promise<FederatedDemandShareResult> {
  await requireCapability("manage_backlog");
  if (!input.linkId?.trim() || !input.itemId?.trim()) {
    return { ok: false, error: "Choose a demand item and connection." };
  }
  try {
    const now = new Date();
    const result = await selectLocalDemandForLink(
      prisma as unknown as ChannelDemandDb,
      {
        linkId: input.linkId.trim(),
        itemId: input.itemId.trim(),
        attribution: "pseudonymous",
        allowForwardToFounder: input.allowForwardToFounder === true,
        ...(input.allowForwardToFounder
          ? { forwardingExpiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000).toISOString() }
          : {}),
        now,
      },
    );
    revalidatePath(DEMAND_PATH);
    return {
      ok: true,
      action: result.action,
      message: input.allowForwardToFounder
        ? "Queued with pseudonymous attribution and a 90-day founder-forwarding grant."
        : "Queued for this connection only; transitive forwarding is not permitted.",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to share demand." };
  }
}

export async function stopSharingLocalDemandWithLinkAction(input: {
  linkId: string;
  itemId: string;
}): Promise<FederatedDemandShareResult> {
  await requireCapability("manage_backlog");
  try {
    const result = await unselectLocalDemandForLink(
      prisma as unknown as ChannelDemandDb,
      { linkId: input.linkId.trim(), itemId: input.itemId.trim(), now: new Date() },
    );
    revalidatePath(DEMAND_PATH);
    return {
      ok: true,
      action: result.action,
      message: result.action === "noop" ? "This item was not shared on that connection." : "Withdrawal queued.",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to stop sharing demand." };
  }
}

export async function forwardFederatedDemandAction(input: {
  mirrorId: string;
  targetLinkId: string;
}): Promise<FederatedDemandShareResult> {
  await requireCapability("manage_backlog");
  try {
    const result = await forwardIncomingDemandToLink(
      prisma as unknown as ChannelDemandDb,
      { mirrorId: input.mirrorId.trim(), targetLinkId: input.targetLinkId.trim(), now: new Date() },
    );
    revalidatePath(DEMAND_PATH);
    return {
      ok: true,
      action: result.action,
      message: result.action === "noop"
        ? "Founder already has this version queued."
        : "Curated demand queued for Founder Hub with original provenance preserved.",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to forward demand." };
  }
}

export async function respondToFederatedDemandAction(input: {
  mirrorId: string;
  kind: "interest" | "help-offer";
}): Promise<FederatedDemandShareResult> {
  await requireCapability("manage_backlog");
  try {
    const identity = await resolveFederationIdentity(prisma as unknown as FederationIdentityDb);
    const result = await queueDemandResponse(
      prisma as unknown as DemandResponseDb,
      {
        mirrorId: input.mirrorId.trim(),
        kind: input.kind,
        identity,
        ...(input.kind === "help-offer"
          ? { message: "Our organization can help investigate, reproduce, or validate this demand." }
          : {}),
        now: new Date(),
      },
    );
    revalidatePath(DEMAND_PATH);
    return {
      ok: true,
      action: result.action,
      message: input.kind === "help-offer" ? "Help offer queued for the source installation." : "Interest queued for the source installation.",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to respond to demand." };
  }
}
