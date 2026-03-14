import type { BacklogItemInput } from "@/lib/backlog";

const VALID_TYPES = new Set<BacklogItemInput["type"]>(["portfolio", "product"]);
const VALID_STATUSES = new Set<BacklogItemInput["status"]>(["open", "in-progress", "done", "deferred"]);

export function applyBacklogFormAssistUpdates(
  current: BacklogItemInput,
  updates: Record<string, unknown>,
): BacklogItemInput {
  const next: BacklogItemInput = { ...current };

  if (typeof updates.title === "string") {
    next.title = updates.title;
  }

  if (typeof updates.type === "string" && VALID_TYPES.has(updates.type as BacklogItemInput["type"])) {
    next.type = updates.type as BacklogItemInput["type"];
    if (next.type === "portfolio") {
      delete next.digitalProductId;
    }
  }

  if (typeof updates.status === "string" && VALID_STATUSES.has(updates.status as BacklogItemInput["status"])) {
    next.status = updates.status as BacklogItemInput["status"];
  }

  if (typeof updates.priority === "number" && Number.isFinite(updates.priority)) {
    next.priority = updates.priority;
  }

  if (typeof updates.body === "string") {
    next.body = updates.body;
  }

  if (typeof updates.taxonomyNodeId === "string" || updates.taxonomyNodeId === null) {
    if (updates.taxonomyNodeId === null) delete next.taxonomyNodeId;
    else next.taxonomyNodeId = updates.taxonomyNodeId;
  }

  if (typeof updates.digitalProductId === "string" || updates.digitalProductId === null) {
    if (updates.digitalProductId === null) delete next.digitalProductId;
    else next.digitalProductId = updates.digitalProductId;
  }

  if (typeof updates.epicId === "string" || updates.epicId === null) {
    if (updates.epicId === null) delete next.epicId;
    else next.epicId = updates.epicId;
  }

  return next;
}
