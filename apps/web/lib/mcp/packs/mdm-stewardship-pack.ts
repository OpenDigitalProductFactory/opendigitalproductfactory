// MDM stewardship tool pack (EP-4A12A7CB WG-4).
//
// Customer master-data stewardship doors for coworkers — currently the
// governed account merge. The merge invariants (validate, snapshot, repoint,
// collision plans, tombstone) live in lib/mdm/merge.ts; this pack owns the
// tool contract. Merge is link + supersede, never a hard-delete: the loser
// row survives as a superseded tombstone pointing at the survivor.

import { prisma } from "@dpf/db";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "merge_customer_accounts",
    description:
      "Merge a duplicate customer account into the one to keep. Use when two accounts are confirmed to be the same real company (e.g. created under slightly different spellings). All related records (contacts, sites, opportunities, quotes, invoices, tickets, etc.) move to the surviving account; the duplicate is kept as a superseded tombstone pointing at the survivor — nothing is deleted. Not reversible from this tool, so confirm with the user which account survives before calling. Pass the account to KEEP as survivorAccountId and the duplicate as loserAccountId (CustomerAccount.id values from list_customer_accounts or a duplicates_found response).",
    inputSchema: {
      type: "object",
      properties: {
        survivorAccountId: {
          type: "string",
          description: "CustomerAccount.id of the account to KEEP.",
        },
        loserAccountId: {
          type: "string",
          description: "CustomerAccount.id of the duplicate to merge away (tombstoned, not deleted).",
        },
      },
      required: ["survivorAccountId", "loserAccountId"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
  },
];

async function mergeCustomerAccountsTool(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const survivorId =
    typeof params["survivorAccountId"] === "string" ? params["survivorAccountId"].trim() : "";
  const loserId =
    typeof params["loserAccountId"] === "string" ? params["loserAccountId"].trim() : "";
  if (!survivorId || !loserId) {
    return {
      success: false,
      error: "missing_fields",
      message: "survivorAccountId and loserAccountId are both required (CustomerAccount.id values).",
    };
  }
  const { mergeRecords, MergeValidationFailure } = await import("@/lib/mdm/merge");
  try {
    const result = await mergeRecords("customer-account", loserId, survivorId);
    await prisma.activity.create({
      data: {
        activityId: `ACT-${crypto.randomUUID()}`,
        type: "account_merged",
        subject: `Account merged into survivor ${survivorId}`,
        body: JSON.stringify(result),
        accountId: survivorId,
        createdById: null,
      },
    });
    const moved =
      Object.entries(result.repointed)
        .map(([step, count]) => `${step}: ${count}`)
        .join(", ") || "no related rows";
    return {
      success: true,
      message: `Merged duplicate account ${loserId} into ${survivorId}. Moved ${moved}. The duplicate is kept as a superseded record pointing at the survivor.`,
      data: {
        survivorId,
        loserId,
        repointed: result.repointed,
        nestedSiteMerges: result.nestedSiteMerges,
      },
    };
  } catch (err) {
    if (err instanceof MergeValidationFailure) {
      return {
        success: false,
        error: "merge_rejected",
        message: `Merge rejected: ${err.reason}. Check both ids exist, differ, and neither is already superseded.`,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: "merge_failed", message: `merge_customer_accounts failed: ${msg}` };
  }
}

export const mdmStewardshipPack: ToolPack = {
  packId: "mdm-stewardship",
  definitions,
  handlers: {
    merge_customer_accounts: (params) => mergeCustomerAccountsTool(params),
  },
  grants: {
    // Mirrors agent-grants.ts TOOL_TO_GRANTS (the gating source): merging
    // duplicates is customer-data stewardship inside the CRM-write envelope.
    merge_customer_accounts: ["crm_write"],
  },
};
