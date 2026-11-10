// The role ids a deliberation pattern may actually use.
//
// This vocabulary is closed, and a pattern that strays outside it fails in a
// way that names nothing: an unknown role silently becomes a generic review
// node, and — worse — the orchestrator finds the fan-in node by an exact
// `roleId === "adjudicator"` match, so a pattern declaring anything else gets
// branch nodes with nothing to conclude them and hangs at `pending` forever.
// That cost a whole feature: `governance-triage` shipped with
// `resolution-adjudicator` and completed zero of its first ten runs.
//
// It lives in its own module so a pattern author can find it, rather than
// discovering it by reading a switch buried in the orchestrator.

export interface NodeTypeMapping {
  nodeType: string;
  workerRole: string;
}

/** Every role id the engine implements. A pattern may use only these. */
export const DELIBERATION_ROLE_IDS = [
  "author",
  "reviewer",
  "skeptic",
  "debater",
  "adjudicator",
] as const;

export type DeliberationRoleId = (typeof DELIBERATION_ROLE_IDS)[number];

/** The role whose node fans in and concludes the run. Matched exactly. */
export const ADJUDICATOR_ROLE_ID = "adjudicator";

export function isKnownRoleId(roleId: string): roleId is DeliberationRoleId {
  return (DELIBERATION_ROLE_IDS as readonly string[]).includes(roleId);
}

/**
 * Map a role to its TaskNode type and worker role.
 *
 * Underscore enum values are preserved per the schema comments
 * (schema.prisma:2550, 2554); deliberation-specific enums (§6.6) use hyphens.
 */
export function mapRoleToNode(roleId: string): NodeTypeMapping {
  switch (roleId) {
    case "author":
      return { nodeType: "analyze", workerRole: "planner" };
    case "reviewer":
      return { nodeType: "review", workerRole: "reviewer" };
    case "skeptic":
      return { nodeType: "skeptical_review", workerRole: "skeptical_reviewer" };
    case "debater":
      return { nodeType: "analyze", workerRole: "researcher" };
    case "adjudicator":
      return { nodeType: "summarize", workerRole: "summarizer" };
    default:
      // Unknown role — fall back to a safe read-only review node. Warn so
      // pattern authors notice missing role-to-node mappings rather than
      // silently getting a generic review node (memory: silent seed skips).
      console.warn(
        `[deliberation/orchestrator] unknown roleId "${roleId}" — mapping to review/reviewer fallback`,
      );
      return { nodeType: "review", workerRole: "reviewer" };
  }
}
