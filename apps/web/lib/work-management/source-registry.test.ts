import { describe, expect, it } from "vitest";

import { WORK_ITEM_SOURCE_TYPES } from "@/lib/queue/queue-types";

import {
  WORK_CASE_ACCOUNT_RESOLVER_SOURCE_KEYS,
  WORK_CASE_ROOM_TRIGGER_KINDS,
  WORK_CASE_SOURCE_REGISTRY,
  getWorkCaseRoomTrigger,
  getWorkCaseSourceEntry,
  getWorkroomDefinitionIdentity,
  narrowRoomToolGrant,
  resolveRoomToolGrantForSource,
} from "./source-registry";

describe("Work Case source registry", () => {
  it("covers every existing WorkItem source type", () => {
    for (const sourceType of WORK_ITEM_SOURCE_TYPES) {
      const entry = getWorkCaseSourceEntry(sourceType);
      expect(entry, `missing registry entry for ${sourceType}`).toBeTruthy();
      expect(entry?.sourceKey).toBe(sourceType);
    }
  });

  it("keeps the account-resolver source keys explicit and registry-derived", () => {
    expect([...WORK_CASE_ACCOUNT_RESOLVER_SOURCE_KEYS].sort()).toEqual(
      ["activity", "booking", "engagement", "opportunity", "storefront-booking"].sort(),
    );
  });

  it("registers coworker service engagements as company-work source definitions", () => {
    const entry = getWorkCaseSourceEntry("coworker-engagement");

    expect(entry).toMatchObject({
      sourceKey: "coworker-engagement",
      displayLabel: "Coworker engagement",
      owningArea: "ai-workforce",
      domainCategory: "coworker-service",
      defaultDecisionScope: "wwwd",
      accountResolverKey: null,
      roomProjection: { mode: "finite" },
    });
    expect(entry?.receiptPolicy).toEqual({
      defaultReceiptKind: "governed-action",
      receiptRequiredForConsequentialTransition: true,
    });
    expect(getWorkroomDefinitionIdentity("coworker-engagement")).toMatchObject({
      definitionId: "workroom-definition:coworker-engagement",
      label: "Coworker engagement",
      decisionScope: "wwwd",
    });
  });

  it("documents routing, decision, transition, and receipt defaults for every source", () => {
    for (const entry of WORK_CASE_SOURCE_REGISTRY) {
      expect(entry.displayLabel.length).toBeGreaterThan(0);
      expect(entry.owningArea.length).toBeGreaterThan(0);
      expect(entry.domainCategory.length).toBeGreaterThan(0);
      expect(["wwmd", "wwwd", "wsid"]).toContain(entry.defaultDecisionScope);
      expect(entry.supportedTransitions.length).toBeGreaterThan(0);
      expect(entry.receiptPolicy.defaultReceiptKind.length).toBeGreaterThan(0);
      expect(entry.titleProjection.length).toBeGreaterThan(0);
      expect(entry.summaryProjection.length).toBeGreaterThan(0);
      expect(entry.definitionVersion).toBeGreaterThan(0);
      expect(["finite", "standing"]).toContain(entry.roomProjection.mode);
      expect(Array.isArray(entry.roomProjection.cycleCarrierPrecedence)).toBe(true);
      expect(Array.isArray(entry.roomProjection.outcomePacket.requiredCategories)).toBe(true);
    }
  });

  it("derives one stable definition identity from the registered source", () => {
    expect(getWorkroomDefinitionIdentity(" booking ")).toEqual({
      definitionId: "workroom-definition:booking",
      version: 2,
      sourceKey: "booking",
      label: "Storefront booking",
      mode: "finite",
      decisionScope: "wwwd",
    });
    expect(getWorkroomDefinitionIdentity("external-ticket")).toBeNull();
  });

  it("makes standing room mode an explicit source-registry decision", () => {
    expect(getWorkCaseSourceEntry("scheduled")?.roomProjection.mode).toBe("standing");
    expect(getWorkCaseSourceEntry("booking")?.roomProjection.mode).toBe("finite");
  });

  it("owns deterministic standing-cycle carrier precedence", () => {
    expect(getWorkCaseSourceEntry("scheduled")?.roomProjection.cycleCarrierPrecedence).toEqual([
      "work-item",
      "work-capsule",
      "task-run",
    ]);
    expect(getWorkCaseSourceEntry("booking")?.roomProjection.cycleCarrierPrecedence).toEqual([]);
    expect(getWorkCaseSourceEntry("scheduled")?.supportedTransitions).toContain("split");
    expect(getWorkCaseSourceEntry("scheduled")?.supportedTransitions).not.toContain("handoff");
  });

  it("normalizes unknown, missing, and whitespace source keys safely", () => {
    expect(getWorkCaseSourceEntry(null)).toBeNull();
    expect(getWorkCaseSourceEntry(undefined)).toBeNull();
    expect(getWorkCaseSourceEntry("   ")).toBeNull();
    expect(getWorkCaseSourceEntry("unknown")).toBeNull();
    expect(getWorkCaseSourceEntry(" booking ")?.sourceKey).toBe("booking");
  });
});

// EP-862820FD / BI-28EFA338. The employment lifecycle is registry entries, not a
// workflow engine — docs/architecture/workroom-vocabulary-boundary.md says later
// work must deepen THIS registry rather than build a parallel template subsystem.
// These pin the properties that make that true, so a future edit cannot quietly
// turn them into something else.
describe("employment lifecycle definitions", () => {
  const KEYS = [
    "worker-onboarding",
    "worker-change",
    "worker-offboarding",
    "worker-classification-review",
    "referral-intake",
  ] as const;

  it("registers all five with a stable key and a positive version", () => {
    for (const key of KEYS) {
      const entry = getWorkCaseSourceEntry(key);
      expect(entry, `missing definition for ${key}`).toBeTruthy();
      expect(entry?.sourceKey).toBe(key);
      expect(entry?.definitionVersion).toBeGreaterThan(0);
    }
  });

  // A customer's decisions about their own workforce. AGENTS.md §11 forbids
  // settling those through principle_decide, which is the platform-development
  // surface — so the scope has to say wwwd, not wwmd.
  it("scopes every definition to the customer's own decisions", () => {
    for (const key of KEYS) {
      expect(getWorkCaseSourceEntry(key)?.defaultDecisionScope).toBe("wwwd");
    }
  });

  // Classification drifts: duration extends, direction increases, exclusivity
  // emerges. A finite room would close before the facts changed, so the review
  // room is the one standing definition of the five.
  it("keeps classification review standing and the rest finite", () => {
    expect(getWorkCaseSourceEntry("worker-classification-review")?.roomProjection.mode)
      .toBe("standing");
    for (const key of KEYS.filter((k) => k !== "worker-classification-review")) {
      expect(getWorkCaseSourceEntry(key)?.roomProjection.mode).toBe("finite");
    }
  });

  // Governed receipts, not observed events. An offboarding revocation that did
  // not happen must read as an outstanding obligation rather than an absent log
  // line — a room that closes while access remains live is the failure this
  // definition exists to prevent.
  it("requires a governed receipt for every consequential transition", () => {
    for (const key of KEYS) {
      const policy = getWorkCaseSourceEntry(key)?.receiptPolicy;
      expect(policy?.defaultReceiptKind).toBe("governed-action");
      expect(policy?.receiptRequiredForConsequentialTransition).toBe(true);
    }
  });

  // These coordinate workers, not customer accounts, so none of them resolves an
  // account. Claiming an account resolver here would route a workforce room
  // through customer-account projection.
  it("resolves no customer account", () => {
    for (const key of KEYS) {
      expect(getWorkCaseSourceEntry(key)?.accountResolverKey).toBeNull();
      expect(WORK_CASE_ACCOUNT_RESOLVER_SOURCE_KEYS).not.toContain(key);
    }
  });

  it("projects a definition identity a business instance can carry", () => {
    for (const key of KEYS) {
      const identity = getWorkroomDefinitionIdentity(key);
      expect(identity, `no definition identity for ${key}`).toBeTruthy();
      expect(identity?.sourceKey).toBe(key);
    }
  });
});

describe("room trigger vocabulary", () => {
  it("is the closed event / cadence / threshold set", () => {
    expect([...WORK_CASE_ROOM_TRIGGER_KINDS]).toEqual(["event", "cadence", "threshold"]);
  });

  it("gives every entry a trigger slot, and every non-null trigger a known kind", () => {
    for (const entry of WORK_CASE_SOURCE_REGISTRY) {
      expect(entry, `${entry.sourceKey} missing trigger slot`).toHaveProperty("trigger");
      if (entry.trigger === null) continue;
      expect(
        WORK_CASE_ROOM_TRIGGER_KINDS as readonly string[],
        `${entry.sourceKey} has an unknown trigger kind`,
      ).toContain(entry.trigger.kind);
    }
  });

  it("keeps the two working standing rooms on a cadence", () => {
    const scheduled = getWorkCaseRoomTrigger("scheduled");
    const books = getWorkCaseRoomTrigger("bookkeeping-period");
    expect(scheduled?.kind).toBe("cadence");
    expect(books?.kind).toBe("cadence");
    // RFC-5545, the grammar RecurrenceSchedule already stores — not a second scheduler.
    expect(books?.kind === "cadence" && books.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
  });

  it("leaves an imperatively opened room's trigger null rather than inventing one", () => {
    expect(getWorkCaseRoomTrigger("manual-task")).toBeNull();
    expect(getWorkCaseRoomTrigger("backlog-item")).toBeNull();
  });
});

describe("room tool grant is tighten-only", () => {
  it("cannot widen authority the agent does not already hold", () => {
    // The room names a grant the agent lacks. It must be refused, not conferred.
    const result = narrowRoomToolGrant(
      { grantKeys: ["work_room_read", "banking_write"] },
      ["work_room_read"],
    );
    expect(result.granted).toEqual(["work_room_read"]);
    expect(result.refused).toEqual(["banking_write"]);
    expect(result.granted).not.toContain("banking_write");
  });

  it("confers nothing at all to an agent with no standing grants", () => {
    const result = narrowRoomToolGrant({ grantKeys: ["work_room_read", "crm_write"] }, []);
    expect(result.granted).toEqual([]);
    expect(result.refused).toEqual(["work_room_read", "crm_write"]);
  });

  it("never returns a granted key outside the agent's standing set, for every entry", () => {
    const standing = ["work_room_read"];
    for (const entry of WORK_CASE_SOURCE_REGISTRY) {
      const { granted } = narrowRoomToolGrant(entry.toolGrant, standing);
      for (const key of granted) {
        expect(standing, `${entry.sourceKey} widened authority to ${key}`).toContain(key);
      }
    }
  });

  it("is bounded by the room ceiling even when the agent holds more", () => {
    // The agent holds banking_write; the task-node room does not permit it.
    const entry = getWorkCaseSourceEntry("task-node");
    const { granted } = narrowRoomToolGrant(entry!.toolGrant, [
      "work_room_read",
      "work_room_write",
      "thread_write",
      "banking_write",
    ]);
    expect(granted).not.toContain("banking_write");
  });

  it("resolves an unknown source to null rather than an empty allowance", () => {
    expect(resolveRoomToolGrantForSource("external-ticket", ["work_room_read"])).toBeNull();
  });
});

describe("room measures", () => {
  it("gives every entry at least one measure with a binding key", () => {
    for (const entry of WORK_CASE_SOURCE_REGISTRY) {
      expect(entry.measures.length, `${entry.sourceKey} has no measure`).toBeGreaterThan(0);
      for (const measure of entry.measures) {
        expect(measure.key.length).toBeGreaterThan(0);
        expect(measure.label.length).toBeGreaterThan(0);
        expect(measure.bindingKey.length).toBeGreaterThan(0);
      }
    }
  });
});
