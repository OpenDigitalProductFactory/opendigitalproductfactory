// Reachability invariant for coworker self-tasks (BI-B05E5D30).
//
// The registry is keyed by slug. The proactivity roster renders through
// collapseDualSeedDuplicates, which for a dual-seeded coworker drops the slug
// row and keeps the canonical AGT-* one — so the fact an operator can actually
// write may arrive under EITHER id. Before this guard, four of six registered
// coworkers were unreachable: the toggle wrote AGT-WS-MARKETING, the sweep
// looked up "marketing-specialist", and no self-task was ever created.
//
// dual-seed-coverage.pg.test.ts guards the neighbouring concern — that a
// collapsed pair never renders TWICE. It cannot catch this, because a row that
// collapses correctly can still orphan a downstream registry. That is the gap
// this file closes.

import { describe, expect, it } from "vitest";

import { CANONICAL_AGENT_ID_TO_COWORKER_SLUG, COWORKER_SLUG_TO_CANONICAL_AGENT_ID } from "@dpf/db/agent-identity";

import { COWORKER_SELF_TASKS, coworkerSelfTaskId, selfTaskRegistryKey } from "./coworker-self-tasks";

describe("coworker self-task reachability (BI-B05E5D30)", () => {
  it("resolves every registry key from whichever id the roster can actually write", () => {
    for (const slug of Object.keys(COWORKER_SELF_TASKS)) {
      // The slug always resolves to itself.
      expect(selfTaskRegistryKey(slug), slug).toBe(slug);

      // A dual-seeded coworker is reachable ONLY by its canonical id, because
      // the collapse drops its slug row from the roster. That id must resolve
      // back to the same registry key or the self-task can never be created.
      const canonical = COWORKER_SLUG_TO_CANONICAL_AGENT_ID[slug];
      if (canonical) {
        expect(selfTaskRegistryKey(canonical), `${canonical} -> ${slug}`).toBe(slug);
      }
    }
  });

  it("keeps the task id stable whichever id form the operator's fact used", () => {
    // Two ids, one coworker, one task. If these diverged, toggling from a
    // different surface would create a SECOND scheduled task rather than
    // converging on the existing one.
    for (const slug of Object.keys(COWORKER_SELF_TASKS)) {
      const canonical = COWORKER_SLUG_TO_CANONICAL_AGENT_ID[slug];
      if (!canonical) continue;
      const fromSlug = coworkerSelfTaskId(selfTaskRegistryKey(slug)!, "user-1");
      const fromCanonical = coworkerSelfTaskId(selfTaskRegistryKey(canonical)!, "user-1");
      expect(fromCanonical, slug).toBe(fromSlug);
    }
  });

  it("covers the Marketing Strategist, the registry's own seed entry", () => {
    // Named explicitly because it is the case that surfaced the defect: the
    // module header calls it the seed entry, and it was the one coworker an
    // operator could not switch on.
    expect(COWORKER_SELF_TASKS["marketing-specialist"]).toBeDefined();
    expect(selfTaskRegistryKey("AGT-WS-MARKETING")).toBe("marketing-specialist");
  });

  it("covers the other three coworkers the collapse hid", () => {
    for (const [canonical, slug] of [
      ["AGT-WS-INVENTORY", "inventory-specialist"],
      ["AGT-WS-PLATFORM", "platform-engineer"],
      ["AGT-WS-COMPLIANCE", "compliance-officer"],
    ] as const) {
      expect(COWORKER_SELF_TASKS[slug], slug).toBeDefined();
      expect(selfTaskRegistryKey(canonical), canonical).toBe(slug);
    }
  });

  it("still returns null for a coworker that has no self-task", () => {
    // The resolver must not invent reachability — an unregistered coworker is
    // skipped by the sweep exactly as before.
    expect(selfTaskRegistryKey("coo")).toBeNull();
    expect(selfTaskRegistryKey("AGT-WS-EA")).toBeNull();
    expect(selfTaskRegistryKey("no-such-agent")).toBeNull();
  });

  it("leaves a non-dual-seeded coworker's key untouched", () => {
    // finance-controller and doc-specialist are not in the collapse map, so
    // their slug survives on the roster and nothing about them changes.
    for (const slug of ["finance-controller", "doc-specialist"]) {
      if (!COWORKER_SELF_TASKS[slug]) continue;
      expect(CANONICAL_AGENT_ID_TO_COWORKER_SLUG[slug]).toBeUndefined();
      expect(selfTaskRegistryKey(slug)).toBe(slug);
    }
  });
});
