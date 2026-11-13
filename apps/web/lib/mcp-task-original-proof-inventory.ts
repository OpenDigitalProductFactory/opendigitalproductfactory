import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

export const ORIGINAL_PROOF_INVENTORY_LIMIT = 8;
export type OriginalProofInventory = {
  schemaVersion: 1;
  status: "observed" | "unavailable" | "over-budget" | "binding-mismatch" | "changed";
  scope: "task-linked-records-only";
  captureComplete: false;
  settlement: "unknown";
  counts?: { taskArtifacts: number; toolExecutions: number; approvalEnvelopes: number; asyncOperations: number };
  missingEvidence: Array<{ code: string; owner: string }>;
};
export type OriginalProofInventorySnapshot = { fingerprint: string | null; inventory: OriginalProofInventory };
export type OriginalProofInventoryPorts = {
  artifacts: () => Promise<unknown[]>;
  tools: () => Promise<unknown[]>;
  approvals: () => Promise<unknown[]>;
  operations: () => Promise<unknown[]>;
};

/** These are producer contracts still required, not proof that every upstream
 * store has been searched. Task-linked rows cannot establish capture completeness. */
function inventory(status: OriginalProofInventory["status"]): OriginalProofInventory {
  return { schemaVersion: 1, status, scope: "task-linked-records-only", captureComplete: false, settlement: "unknown",
    missingEvidence: [
      { code: "original-launch-membership", owner: "original CLI/sandbox launcher" },
      { code: "original-enabled-capabilities", owner: "original CLI/sandbox launcher" },
      { code: "original-descendant-closure", owner: "original process supervisor" },
      { code: "original-credential-preparation", owner: "provider account owner" },
      { code: "complete-effect-reconciliation", owner: "original domain/provider effect owners" },
      { code: "late-writer-and-approval-fence", owner: "canonical writer/approval authority" },
    ] };
}

function validRows(rows: unknown[], taskId: string, actor?: { key: string; id: string }): boolean {
  const ids = new Set<string>();
  return rows.every(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || row.id.length > 300 || ids.has(row.id)
      || row.taskRunId !== taskId || !(row.createdAt instanceof Date)
      || !Number.isFinite(row.createdAt.getTime()) || (actor && row[actor.key] !== actor.id)) return false;
    ids.add(row.id);
    return true;
  });
}

/** The caller must establish original requester/content access first. Ports
 * select metadata only, cap each source at limit+1, and perform no mutations.
 * This collector never interprets a row, printable claim, or zero count as
 * authenticated execution closure, a canonical verdict, or replay authority. */
export async function collectOriginalProofInventory(input: {
  taskRowId: string; taskRunId: string; userId: string; ports: OriginalProofInventoryPorts;
}): Promise<OriginalProofInventorySnapshot> {
  try {
    const [artifacts, tools, approvals, operations] = await Promise.all([
      input.ports.artifacts(), input.ports.tools(), input.ports.approvals(), input.ports.operations(),
    ]);
    const families = [artifacts, tools, approvals, operations];
    if (families.some(rows => !Array.isArray(rows))) return { fingerprint: null, inventory: inventory("unavailable") };
    if (families.some(rows => rows.length > ORIGINAL_PROOF_INVENTORY_LIMIT)) {
      return { fingerprint: null, inventory: inventory("over-budget") };
    }
    if (!validRows(artifacts, input.taskRowId) || !validRows(operations, input.taskRowId)
      || !validRows(tools, input.taskRunId, { key: "userId", id: input.userId })
      || !validRows(approvals, input.taskRunId, { key: "delegatingUserId", id: input.userId })) {
      return { fingerprint: null, inventory: inventory("binding-mismatch") };
    }
    const value = inventory("observed");
    value.counts = { taskArtifacts: artifacts.length, toolExecutions: tools.length,
      approvalEnvelopes: approvals.length, asyncOperations: operations.length };
    // Fingerprint only the selected observation fields. Neither the fingerprint
    // nor raw rows leave the authenticated reader; no effect contents are read.
    const observations = families.map(rows => rows.map(row => Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([key, field]) =>
        [key, field instanceof Date ? field.toISOString() : field]),
    )));
    return { fingerprint: createHash("sha256").update(canonicalJson(observations)).digest("hex"), inventory: value };
  } catch {
    return { fingerprint: null, inventory: inventory("unavailable") };
  }
}

/** A changed/incomplete observation is withheld, never a successful partial
 * inventory. A separately authenticated canonical receipt keeps its own result. */
export function reconcileOriginalProofInventory(
  before: OriginalProofInventorySnapshot, after: OriginalProofInventorySnapshot,
): OriginalProofInventory {
  if (before.inventory.status !== "observed") return before.inventory;
  if (after.inventory.status !== "observed") return after.inventory;
  return before.fingerprint && before.fingerprint === after.fingerprint ? before.inventory : inventory("changed");
}
