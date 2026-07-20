"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import {
  adoptIncomingDemand,
  setIncomingDemandDisposition,
  type DemandExchangeDb,
} from "@/lib/federation/demand-exchange";
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
