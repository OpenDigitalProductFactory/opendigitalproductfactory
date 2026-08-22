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
import { getErrorMessage } from "@/lib/shared/get-error-message";

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
    consequence: "irreversible",
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
    // destroys state → consult-gated (TAK §8.4.1).
    consequence: "irreversible",
  },
  {
    name: "merge_customer_contacts",
    description:
      "Merge a duplicate customer contact into the one to keep — use when two contact records are confirmed to be the SAME PERSON (e.g. added under two emails). Roles, opportunities, activities, and invoices move to the surviving contact; the duplicate keeps its own email but is deactivated and points at the survivor. The survivor keeps its login credentials. Confirm with the user which record survives before calling. Pass CustomerContact.id values.",
    inputSchema: {
      type: "object",
      properties: {
        survivorContactId: { type: "string", description: "CustomerContact.id of the record to KEEP." },
        loserContactId: { type: "string", description: "CustomerContact.id of the duplicate to merge away (deactivated, not deleted)." },
      },
      required: ["survivorContactId", "loserContactId"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
    consequence: "irreversible",
  },
  {
    name: "run_mdm_steward_sweep",
    description:
      "Scan customer data for quality issues and file them into the steward review queue: duplicate account/contact pairs (batch scan) and stale records (no update within the configured window). Idempotent — re-running refreshes open items and never re-files resolved ones. Use when asked to check or clean up data quality. Returns counts; follow with list_mdm_steward_tasks to see the queue.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "operate_customer",
    sideEffect: true,
  },
  {
    name: "list_mdm_steward_tasks",
    description:
      "List open data-quality review tasks (possible duplicates and stale records) from the steward queue, strongest signal first. Read-only. Resolve duplicates with merge_customer_accounts / merge_customer_contacts; a human can also resolve tasks at /admin/data-stewardship.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_customer",
    sideEffect: false,
  },
  {
    name: "enrich_customer_account",
    description:
      "Fetch a customer account's own stored website and propose data enrichment (page title / description signals) as a steward review task — never writes account fields directly. Requires web access to be enabled. Use when an account looks sparse or possibly outdated and it has a website on record. Pass the CustomerAccount.id.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "CustomerAccount.id to enrich (must have a website set)." },
      },
      required: ["accountId"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
    // reaches a third party → consult-gated (TAK §8.4.1).
    consequence: "outward",
    requiresExternalAccess: true,
  },
  {
    name: "run_data_steward",
    description:
      "Run one autonomous data-stewardship pass: sweep for duplicates + stale records, then auto-merge the account duplicates it is confident about (keeping the best survivor), leaving ambiguous or identity cases for a human. Everything auto-merged is audit-logged and reversible with unmerge_customer_accounts. Use when asked to clean up customer data end-to-end. Pass dryRun=true to preview what WOULD be auto-merged without changing anything. This is the same pass the scheduled Data Steward runs daily.",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: { type: "boolean", description: "Preview only — report what would auto-merge without merging. Default false." },
      },
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
  },
];

async function runDataStewardTool(params: Record<string, unknown>): Promise<ToolResult> {
  const dryRun = params["dryRun"] === true;
  const { runAutonomousStewardship } = await import("@/lib/mdm/autonomous-steward");
  const summary = await runAutonomousStewardship({ dryRun });
  const merges = summary.autoMerged
    .map((m) => `${m.loserLabel}→${m.survivorLabel} (${m.reason})`)
    .join("; ") || "none";
  return {
    success: true,
    message: `${dryRun ? "[dry-run] " : ""}Data Steward pass: swept ${summary.sweep.duplicatesFound} duplicate pair(s) + ${summary.sweep.staleFound} stale record(s); ${dryRun ? "would auto-merge" : "auto-merged"} ${summary.autoMerged.length} (${merges}); escalated ${summary.escalated.length} to human review${summary.capped ? " (per-run cap hit)" : ""}.`,
    data: summary,
  };
}

async function mergeCustomerContactsTool(params: Record<string, unknown>): Promise<ToolResult> {
  const survivorId = typeof params["survivorContactId"] === "string" ? params["survivorContactId"].trim() : "";
  const loserId = typeof params["loserContactId"] === "string" ? params["loserContactId"].trim() : "";
  if (!survivorId || !loserId) {
    return { success: false, error: "missing_fields", message: "survivorContactId and loserContactId are both required (CustomerContact.id values)." };
  }
  const { mergeRecords, MergeValidationFailure } = await import("@/lib/mdm/merge");
  try {
    const result = await mergeRecords("customer-contact", loserId, survivorId);
    const moved = Object.entries(result.repointed).map(([step, count]) => `${step}: ${count}`).join(", ") || "no related rows";
    return {
      success: true,
      message: `Merged duplicate contact ${loserId} into ${survivorId}. Moved ${moved}. The duplicate keeps its email but is deactivated and points at the survivor.`,
      data: { survivorId, loserId, repointed: result.repointed, survivorship: result.survivorship },
    };
  } catch (err) {
    if (err instanceof MergeValidationFailure) {
      return { success: false, error: "merge_rejected", message: `Merge rejected: ${err.reason}. Check both ids exist, differ, and neither is already merged away.` };
    }
    const msg = getErrorMessage(err);
    return { success: false, error: "merge_failed", message: `merge_customer_contacts failed: ${msg}` };
  }
}

async function runStewardSweepTool(): Promise<ToolResult> {
  const { runStewardSweep } = await import("@/lib/mdm/steward");
  const summary = await runStewardSweep();
  return {
    success: true,
    message: `Sweep complete: ${summary.duplicatesFound} duplicate pair(s) (${summary.duplicateTasksOpened} newly queued), ${summary.staleFound} stale record(s) (${summary.staleTasksOpened} newly queued). Review with list_mdm_steward_tasks or at /admin/data-stewardship.`,
    data: summary,
  };
}

async function listStewardTasksTool(): Promise<ToolResult> {
  const { listOpenStewardTasks } = await import("@/lib/mdm/steward");
  const tasks = await listOpenStewardTasks();
  return {
    success: true,
    message: tasks.length === 0 ? "The steward queue is clear." : `${tasks.length} open data-quality task(s), strongest first.`,
    data: {
      tasks: tasks.map((t) => ({
        taskId: t.taskId,
        domain: t.domain,
        kind: t.kind,
        subject: { id: t.subjectId, label: t.subjectLabel },
        candidate: t.candidateId ? { id: t.candidateId, label: t.candidateLabel } : null,
        score: t.score,
        note: t.note,
      })),
    },
  };
}

async function enrichCustomerAccountTool(params: Record<string, unknown>): Promise<ToolResult> {
  const accountId = typeof params["accountId"] === "string" ? params["accountId"].trim() : "";
  if (!accountId) {
    return { success: false, error: "missing_fields", message: "accountId is required (CustomerAccount.id)." };
  }
  const { proposeAccountEnrichment } = await import("@/lib/mdm/enrichment");
  const result = await proposeAccountEnrichment(accountId);
  if (!result.ok) {
    return { success: false, error: "enrichment_failed", message: result.message };
  }
  const { proposal } = result;
  return {
    success: true,
    message: proposal.stewardTaskId
      ? `Enrichment proposal filed as steward task ${proposal.stewardTaskId} (title: ${proposal.pageTitle ?? "n/a"}). A human applies it from /admin/data-stewardship — nothing was written to the account.`
      : `Website reachable but nothing new to propose (title: ${proposal.pageTitle ?? "n/a"}).`,
    data: proposal,
  };
}

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
    const msg = getErrorMessage(err);
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
    const msg = getErrorMessage(err);
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
    merge_customer_contacts: (params) => mergeCustomerContactsTool(params),
    run_mdm_steward_sweep: () => runStewardSweepTool(),
    list_mdm_steward_tasks: () => listStewardTasksTool(),
    enrich_customer_account: (params) => enrichCustomerAccountTool(params),
    run_data_steward: (params) => runDataStewardTool(params),
  },
  grants: {
    // Mirrors agent-grants.ts TOOL_TO_GRANTS (the gating source): merging
    // duplicates is customer-data stewardship inside the CRM-write envelope;
    // the batch scan is read-only inspection.
    merge_customer_accounts: ["crm_write"],
    find_duplicate_customer_accounts: ["crm_read"],
    unmerge_customer_accounts: ["crm_write"],
    merge_customer_contacts: ["crm_write"],
    run_mdm_steward_sweep: ["crm_write"],
    list_mdm_steward_tasks: ["crm_read"],
    // Enrichment fetches an external site: gated by the web toggle AND grant.
    enrich_customer_account: ["web_search"],
    // The autonomous pass merges records: crm_write, same envelope as merge.
    run_data_steward: ["crm_write"],
  },
};
