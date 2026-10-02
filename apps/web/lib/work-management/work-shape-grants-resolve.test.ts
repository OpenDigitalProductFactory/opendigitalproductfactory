import { describe, expect, it } from "vitest";

import { GRANT_IMPLICATIONS, TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { listWorkShapes } from "./work-shapes";
import { roomGrantsFromWorkShape, roomAuthorizesTool } from "./room-turn-authority";

// GPP check C-2 (BI-00588B51): a work shape's grant vocabulary must resolve to
// grants some tool actually requires. A token that resolves to nothing reads
// as authority in the model while admitting nothing at runtime — the delivery
// shapes carried `tool:write-source` and every delivery room was read-only.

const grantsAnyToolRequires = new Set<string>([
  ...Object.values(TOOL_TO_GRANTS).flat(),
  ...Object.keys(GRANT_IMPLICATIONS),
]);

/**
 * Shrink-only ratchet. These standing-shape tokens resolved to nothing on
 * 2026-10-01 and are owned by their shape authors (BI-00588B51 names the
 * delivery shapes only). Remove an entry when its token resolves; never add
 * one — a new unresolvable token fails this guard.
 */
const KNOWN_UNRESOLVED_STANDING_SHAPE_TOKENS: readonly string[] = [
  "architecture-alignment-review: ea_view_describe",
  "catalog-scout-sweep: tool_evaluation_write",
  "consume-stream-orchestration: work_route_propose",
  "deploy-stream-orchestration: work_route_propose",
  "detection-coverage-hunt: detection_rule_propose",
  "detection-coverage-hunt: threat_intel_lookup",
  "estate-conformance-watch: asset_inventory_read",
  "estate-conformance-watch: schema_describe",
  "evaluate-stream-orchestration: work_route_propose",
  "explore-stream-orchestration: work_route_propose",
  "governance-stream-orchestration: work_route_propose",
  "integrate-stream-orchestration: work_route_propose",
  "licence-currency-watch: licence_record_write",
  "operate-stream-orchestration: work_route_propose",
  "outward-surface-review: accessibility_check",
  "outward-surface-review: content_draft_write",
  "release-stream-orchestration: work_route_propose",
  "security-alert-triage-ladder: security_case_write",
  "security-alert-triage-ladder: threat_intel_lookup",
  "service-dispatch-cycle: customer_notify_propose",
  "service-dispatch-cycle: schedule_write",
  "setup-business-understanding: record_org_business_answer",
  "setup-business-understanding: request_coworker",
  "setup-business-understanding: setup_email",
  "workforce-intake-cycle: curriculum_assign",
  "workforce-intake-cycle: employee_record_write",
];

function unresolvedShapeTokens(): string[] {
  const unresolved: string[] = [];
  for (const shape of listWorkShapes()) {
    for (const grant of roomGrantsFromWorkShape(shape.grants)) {
      if (!grantsAnyToolRequires.has(grant)) unresolved.push(`${shape.key}: ${grant}`);
    }
  }
  return unresolved.sort();
}

describe("work-shape grant vocabulary resolves to enforceable grants (GPP C-2)", () => {
  it("every delivery shape declares only tokens a tool requires", () => {
    expect(unresolvedShapeTokens().filter((entry) => entry.startsWith("delivery-"))).toEqual([]);
  });

  it("no shape introduces a new token that resolves to nothing (shrink-only ratchet)", () => {
    const unexpected = unresolvedShapeTokens().filter((entry) => !KNOWN_UNRESOLVED_STANDING_SHAPE_TOKENS.includes(entry));
    expect(unexpected).toEqual([]);
  });

  it("the ratchet only shrinks: every pinned token is still unresolved, or its entry must be removed", () => {
    const current = new Set(unresolvedShapeTokens());
    expect(KNOWN_UNRESOLVED_STANDING_SHAPE_TOKENS.filter((entry) => !current.has(entry))).toEqual([]);
  });

  it("a capability class resolves to grants, and a token that is neither a class nor a grant stays dangling", () => {
    expect(roomAuthorizesTool("write_sandbox_file", roomGrantsFromWorkShape(["tool:write-source"]))).toBe(true);
    expect(roomAuthorizesTool("saveBuildEvidence", roomGrantsFromWorkShape(["tool:write-internal"]))).toBe(true);
    const dangling = roomGrantsFromWorkShape(["tool:write-elsewhere"]);
    expect(dangling).toEqual(["write-elsewhere"]);
    expect(grantsAnyToolRequires.has("write-elsewhere")).toBe(false);
  });

  it("a delivery room admits the lifecycle writes its coworkers make and nothing outward", () => {
    const delivery = listWorkShapes().find((shape) => shape.key === "delivery-medium");
    expect(delivery).toBeDefined();
    const grants = roomGrantsFromWorkShape(delivery!.grants);
    for (const tool of ["record_initiative_evidence", "saveBuildEvidence", "write_sandbox_file", "record_workroom_evidence"]) {
      expect(roomAuthorizesTool(tool, grants), tool).toBe(true);
    }
    for (const tool of ["update_backlog_item_status", "search_public_web"]) {
      expect(roomAuthorizesTool(tool, grants), tool).toBe(false);
    }
  });
});
