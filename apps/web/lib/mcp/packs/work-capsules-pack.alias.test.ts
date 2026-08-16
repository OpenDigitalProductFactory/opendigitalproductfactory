import { describe, expect, it } from "vitest";

import { workCapsulesPack } from "./work-capsules-pack";

// ── Workroom alias window (BI-0702869B) ─────────────────────────────────────────
//
// The capsule tool names are a CLIENT-VISIBLE CONTRACT: external Claude/Codex/Grok
// clients and peer installs hold them, so the rename ships behind an alias window
// rather than as a flag day. Two properties have to hold together, and neither is
// obvious from reading the pack:
//
//   1. every legacy name is still CALLABLE and still RESOLVES GRANTS — TOOL_TO_GRANTS
//      denies unlisted tools, so an alias without a grant row is an authorization
//      failure, not a cosmetic gap; and
//   2. no legacy name is ADVERTISED — otherwise the tool surface doubles, and the
//      tool cap keys on context size (tools are also cached before the system prompt).
describe("workroom alias window", () => {
  const LEGACY_TO_CANONICAL = {
    list_work_capsules: "list_workrooms",
    get_work_capsule: "get_workroom",
    create_work_capsule: "create_workroom",
    plan_capsule_worktree: "plan_workroom_worktree",
    claim_capsule_scope: "claim_workroom_scope",
    heartbeat_capsule: "heartbeat_workroom",
    update_work_capsule_status: "update_workroom_status",
    release_capsule_scope: "release_workroom_scope",
    record_capsule_evidence: "record_workroom_evidence",
    reassign_capsule_executor: "reassign_workroom_executor",
  };

  it("advertises the canonical workroom name for every renamed tool", () => {
    const advertised = new Set(workCapsulesPack.definitions.map((d) => d.name));
    for (const canonical of Object.values(LEGACY_TO_CANONICAL)) {
      expect(advertised.has(canonical), `${canonical} must be advertised`).toBe(true);
    }
  });

  it("does NOT advertise any legacy capsule name (the surface must not double)", () => {
    const advertised = new Set(workCapsulesPack.definitions.map((d) => d.name));
    for (const legacy of Object.keys(LEGACY_TO_CANONICAL)) {
      expect(advertised.has(legacy), `${legacy} must not be advertised`).toBe(false);
    }
  });

  it("keeps every legacy name callable, bound to the same handler as its canonical name", () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_TO_CANONICAL)) {
      expect(workCapsulesPack.handlers[legacy], `${legacy} must still dispatch`).toBeDefined();
      expect(workCapsulesPack.handlers[canonical], `${canonical} must dispatch`).toBeDefined();
    }
  });

  it("gives every legacy name the SAME grants as its canonical name", () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_TO_CANONICAL)) {
      expect(workCapsulesPack.grants[legacy], `${legacy} needs a grant row or it is denied`).toBeDefined();
      expect(workCapsulesPack.grants[legacy]).toEqual(workCapsulesPack.grants[canonical]);
    }
  });
});
