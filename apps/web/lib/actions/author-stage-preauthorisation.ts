"use server";

// BI-8A32EBFF: operator actions that grant and revoke the Workroom drive's
// pre-authorisation to run role:author delivery stages with an agent, within
// budget. Restricted to manage_platform; the drive re-checks it every run.

import { prisma } from "@dpf/db";

import { requireCapabilityContext } from "@/lib/actions/shared/guards";
import type { ActionResult } from "@/lib/shared/action-result";
import {
  writeAuthorStagePreauthorisation,
  type AuthorStagePreauthorisationDb,
  type AuthorStagePreauthorisationRecord,
} from "@/lib/work-management/author-stage-preauthorisation";

async function write(action: "grant" | "revoke", reason: string): Promise<ActionResult<AuthorStagePreauthorisationRecord>> {
  const { userId } = await requireCapabilityContext("manage_platform");
  return writeAuthorStagePreauthorisation(prisma as unknown as AuthorStagePreauthorisationDb, { action, userId, reason, now: new Date() });
}

export async function grantAuthorStagePreauthorisation(input: { reason: string }): Promise<ActionResult<AuthorStagePreauthorisationRecord>> {
  return write("grant", input.reason);
}

export async function revokeAuthorStagePreauthorisation(input: { reason: string }): Promise<ActionResult<AuthorStagePreauthorisationRecord>> {
  return write("revoke", input.reason);
}
