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
  {
    name: "find_duplicate_customer_accounts",
    description:
      "Scan ALL existing customer accounts for likely/possible duplicate pairs (batch retroactive scan — the write-time gate only protects new records). Use when asked to clean up customer data, or before bulk work that assumes unique accounts. Returns scored pairs strongest-first with the match reasons; confirm with the user, then use merge_customer_accounts to resolve a confirmed pair. Read-only; takes no parameters.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_customer",
    sideEffect: false,
  },
  {
    name: "unmerge_customer_accounts",
    description:
      "Reverse a previous account merge: restores the superseded duplicate to a live account and moves back exactly the records the merge moved (records added to the survivor AFTER the merge stay with the survivor). Use only when a merge is confirmed to have been wrong. Pass the superseded account's CustomerAccount.id as mergedAccountId. Fails safely if no merge audit exists or the merge was too large to restore automatically.",
    inputSchema: {
      type: "object",
      properties: {
        mergedAccountId: {
          type: "string",
          description: "CustomerAccount.id of the superseded (merged-away) account to restore.",
        },
      },
      required: ["mergedAccountId"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
  },
];

async function findDuplicateCustomerAccountsTool(): Promise<ToolResult> {
  const { scanCustomerAccountDuplicates } = await import("@/lib/mdm/batch-scan");
  const pairs = await scanCustomerAccountDuplicates();
  if (pairs.length === 0) {
    return { success: true, message: "No duplicate account pairs found.", data: { pairs: [] } };
  }
  const compact = pairs.map((p) => ({
    a: { accountId: p.a.id, name: p.a.label, status: p.a.detail },
    b: { accountId: p.b.id, name: p.b.label, status: p.b.detail },
    score: Math.round(p.score * 100) / 100,
    recommendation: p.recommendation,
    matchedOn: p.reasons.map((r) => r.attribute).join("+"),
  }));
  return {
    success: true,
    message: `Found ${pairs.length} possible duplicate pair(s), strongest first. Confirm with the user which record to keep before calling merge_customer_accounts.`,
    data: { pairs: compact },
  };
}

async function unmergeCustomerAccountsTool(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const mergedAccountId =
    typeof params["mergedAccountId"] === "string" ? params["mergedAccountId"].trim() : "";
  if (!mergedAccountId) {
    return {
      success: false,
      error: "missing_fields",
      message: "mergedAccountId is required (the superseded account's CustomerAccount.id).",
    };
  }
  const { unmergeRecords, UnmergeValidationFailure } = await import("@/lib/mdm/merge");
  try {
    const result = await unmergeRecords(mergedAccountId);
    await prisma.activity.create({
      data: {
        activityId: `ACT-${crypto.randomUUID()}`,
        type: "account_unmerged",
        subject: `Merge reversed — account ${mergedAccountId} restored from ${result.survivorId}`,
        body: JSON.stringify(result),
        accountId: mergedAccountId,
        createdById: null,
      },
    });
    return {
      success: true,
      message: `Restored account ${mergedAccountId} (status "${result.restoredStatus}") and moved back the records the merge had moved. Records added to ${result.survivorId} after the merge stayed there.`,
      data: result,
    };
  } catch (err) {
    if (err instanceof UnmergeValidationFailure) {
      const why: Record<string, string> = {
        "not-merged": "That account is not a merge tombstone.",
        "no-audit": "No merge audit record exists for it, so an automatic restore is unsafe.",
        "lossy-lineage": "The merge moved more rows than the recorded lineage covers — a human must restore manually.",
        "survivor-mismatch": "The tombstone does not match the audit record.",
      };
      return {
        success: false,
        error: "unmerge_rejected",
        message: `Unmerge rejected: ${why[err.reason] ?? err.reason}`,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: "unmerge_failed", message: `unmerge_customer_accounts failed: ${msg}` };
  }
}

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
    find_duplicate_customer_accounts: () => findDuplicateCustomerAccountsTool(),
    unmerge_customer_accounts: (params) => unmergeCustomerAccountsTool(params),
  },
  grants: {
    // Mirrors agent-grants.ts TOOL_TO_GRANTS (the gating source): merging
    // duplicates is customer-data stewardship inside the CRM-write envelope;
    // the batch scan is read-only inspection.
    merge_customer_accounts: ["crm_write"],
    find_duplicate_customer_accounts: ["crm_read"],
    unmerge_customer_accounts: ["crm_write"],
  },
};
