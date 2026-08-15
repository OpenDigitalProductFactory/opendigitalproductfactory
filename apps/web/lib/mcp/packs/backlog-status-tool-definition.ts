import type { ToolDefinition } from "@/lib/mcp-tools";
import { DEFERRAL_INPUT_SCHEMA } from "@/lib/backlog/deferral-contract";

export const backlogStatusToolDefinition: ToolDefinition = {
  name: "update_backlog_item_status",
  description: "Move a backlog item between lifecycle statuses. Enforces the legal-transition table. A same-status deferred call reviews the active deferral instead of returning a no-op. status='deferred' requires deferral metadata; status='retired' is terminal removed demand and requires a reason. Agent callers setting status='done' must supply completionEvidence that cites fresh, server-resolved evidence proportional to documentation, verified-existing, implementation, or operational work. Setting status='triaging' on an already-triaged item is the retriage path. Moving an item to in-progress acquires its work claim; it does not start Build Studio.",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Semantic backlog item id" },
      status: { type: "string", enum: ["triaging", "open", "in-progress", "done", "deferred", "retired"], description: "Target status. 'triaging' from a triaged status is allowed and clears the prior triage decision." },
      reason: { type: "string", description: "Free-text rationale captured in the activity row. Required when status=triaging from a triaged status." },
      resolution: { type: "string", description: "Outcome summary, required when status=done" },
      force: { type: "boolean", description: "When moving to in-progress, take over a claim already held by another active session (default false). The takeover is recorded on the status_change activity row." },
      deferral: DEFERRAL_INPUT_SCHEMA,
      completionEvidence: {
        type: "object",
        description: "Required for agent callers when status=done. Cite evidence activity IDs; implementation work must explicitly classify UX and migration as verified or not-applicable with a concrete reason.",
        properties: {
          workClass: {
            type: "string",
            enum: ["documentation", "verified-existing", "implementation", "operational"],
          },
          evidenceActivityIds: {
            type: "array",
            items: { type: "string" },
            maxItems: 50,
          },
          useActiveBuildEvidence: { type: "boolean" },
          ux: {
            type: "object",
            properties: {
              disposition: { type: "string", enum: ["verified", "not-applicable"] },
              reason: { type: "string" },
            },
            required: ["disposition"],
          },
          migration: {
            type: "object",
            properties: {
              disposition: { type: "string", enum: ["verified", "not-applicable"] },
              reason: { type: "string" },
            },
            required: ["disposition"],
          },
        },
        required: ["workClass", "evidenceActivityIds"],
      },
    },
    required: ["itemId", "status"],
  },
  requiredCapability: "manage_backlog",
  sideEffect: true,
};
