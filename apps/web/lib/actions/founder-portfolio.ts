"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  dispositionFounderDemandCluster,
  promoteFounderDemandOrigin,
  proposeFounderDemandCluster,
} from "@/lib/federation/founder-portfolio";
import { resolvePrincipalIdForUser } from "@/lib/identity/principal-linking";

const DEMAND_PATH = "/ops/demand";

export type FounderPortfolioActionResult =
  | { ok: true; message: string; itemId?: string }
  | { ok: false; error: string };

async function actorPrincipalId(): Promise<string> {
  const { userId } = await requireCapability("manage_backlog");
  return (await resolvePrincipalIdForUser(userId)) ?? userId;
}

export async function proposeFounderDemandClusterAction(input: {
  title: string;
  mirrorIds: string[];
}): Promise<FounderPortfolioActionResult> {
  await actorPrincipalId();
  try {
    const result = await proposeFounderDemandCluster(input);
    revalidatePath(DEMAND_PATH);
    return { ok: true, message: `Created ${result.clusterId} for founder review.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to create the cluster." };
  }
}

export async function promoteFounderDemandOriginAction(memberId: string): Promise<FounderPortfolioActionResult> {
  const principalId = await actorPrincipalId();
  try {
    await promoteFounderDemandOrigin(memberId, principalId);
    revalidatePath(DEMAND_PATH);
    return { ok: true, message: "Promoted this nonproduction origin into the production portfolio." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to promote this origin." };
  }
}

export async function dispositionFounderDemandClusterAction(input: {
  clusterId: string;
  disposition: "accepted" | "rejected" | "archived";
  note?: string;
}): Promise<FounderPortfolioActionResult> {
  const principalId = await actorPrincipalId();
  try {
    const result = await dispositionFounderDemandCluster({ ...input, principalId });
    revalidatePath(DEMAND_PATH);
    revalidatePath("/ops");
    return {
      ok: true,
      message: input.disposition === "accepted"
        ? `Accepted into ${result.canonicalBacklogItem?.itemId ?? "the local backlog"}.`
        : `Cluster ${input.disposition}.`,
      ...(result.canonicalBacklogItem?.itemId ? { itemId: result.canonicalBacklogItem.itemId } : {}),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to record the disposition." };
  }
}
