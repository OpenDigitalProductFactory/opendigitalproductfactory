import { describe, expect, it } from "vitest";

import {
  classifyInviteeAgent,
  evaluateCharterAdmission,
  parseRoomCharter,
  requestedAdmissionClass,
  resolveRoomCharter,
} from "./room-charter";

const NOW = new Date("2026-10-28T00:00:00Z");
const orgCoworker = { kind: "org-coworker" as const, active: true, sensitivityClearance: ["public", "internal"] };

describe("resolveRoomCharter", () => {
  it("applies the platform default only to public and internal rooms", () => {
    expect(resolveRoomCharter({ charter: undefined, sensitivityCeiling: "internal" })).toMatchObject({
      admits: ["org-coworker", "operator-assistant"],
      classCeiling: "create",
      source: "platform-default",
    });
    expect(resolveRoomCharter({ charter: undefined, sensitivityCeiling: "public" })?.source).toBe("platform-default");
    expect(resolveRoomCharter({ charter: undefined, sensitivityCeiling: "confidential" })).toBeNull();
    expect(resolveRoomCharter({ charter: undefined, sensitivityCeiling: "restricted" })).toBeNull();
  });

  it("prefers an explicit charter, including in a confidential room", () => {
    const charter = parseRoomCharter({ admits: ["org-coworker"], classCeiling: "observe", expiresAt: null });
    expect(resolveRoomCharter({ charter: charter ?? undefined, sensitivityCeiling: "confidential" })).toMatchObject({
      admits: ["org-coworker"],
      classCeiling: "observe",
      source: "explicit",
    });
  });
});

describe("parseRoomCharter", () => {
  it("drops unknown kinds and refuses a charter with no valid class ceiling", () => {
    expect(parseRoomCharter({ admits: ["org-coworker", "anyone"], classCeiling: "create" })?.admits).toEqual(["org-coworker"]);
    expect(parseRoomCharter({ admits: ["org-coworker"], classCeiling: "everything" })).toBeNull();
    expect(parseRoomCharter("not a charter")).toBeNull();
  });
});

describe("evaluateCharterAdmission", () => {
  const defaultCharter = resolveRoomCharter({ charter: undefined, sensitivityCeiling: "internal" });

  it("admits an active org coworker cleared for the room, posting at create", () => {
    expect(evaluateCharterAdmission({
      charter: defaultCharter, invitee: orgCoworker, roomSensitivityCeiling: "internal",
      requestedClass: "create", now: NOW,
    })).toEqual({ inCharter: true, reason: "in-charter:platform-default:org-coworker:create" });
  });

  it("admits the operator's assistant under the default", () => {
    expect(evaluateCharterAdmission({
      charter: defaultCharter, invitee: { ...orgCoworker, kind: "operator-assistant" },
      roomSensitivityCeiling: "internal", requestedClass: "create", now: NOW,
    }).inCharter).toBe(true);
  });

  it.each([
    ["no charter", { charter: null }, "outside-charter:no-charter"],
    ["a person or unknown invitee", { invitee: { ...orgCoworker, kind: null } }, "outside-charter:invitee-kind-unknown"],
    ["a retired agent", { invitee: { ...orgCoworker, active: false } }, "outside-charter:invitee-inactive"],
    ["a kind the charter does not admit", { invitee: { ...orgCoworker, kind: "partner-agent" as const } }, "outside-charter:kind-not-admitted"],
    ["clearance below the room ceiling", { roomSensitivityCeiling: "confidential" }, "outside-charter:clearance-below-ceiling"],
    ["a class above the ceiling", { requestedClass: "execute" as const }, "outside-charter:class-above-ceiling"],
  ])("keeps %s outside the charter", (_label, override, reason) => {
    expect(evaluateCharterAdmission({
      charter: defaultCharter, invitee: orgCoworker, roomSensitivityCeiling: "internal",
      requestedClass: "create", now: NOW, ...override,
    })).toEqual({ inCharter: false, reason });
  });

  it("keeps an expired charter from admitting anyone", () => {
    const expired = parseRoomCharter({ admits: ["org-coworker"], classCeiling: "create", expiresAt: "2026-10-01T00:00:00Z" });
    expect(evaluateCharterAdmission({
      charter: resolveRoomCharter({ charter: expired ?? undefined, sensitivityCeiling: "internal" }),
      invitee: orgCoworker, roomSensitivityCeiling: "internal", requestedClass: "create", now: NOW,
    })).toEqual({ inCharter: false, reason: "outside-charter:expired" });
  });

  it("never admits cross-boundary by ordering, only when the ceiling names it", () => {
    const highCeiling = resolveRoomCharter({
      charter: parseRoomCharter({ admits: ["org-coworker"], classCeiling: "administer" }) ?? undefined,
      sensitivityCeiling: "internal",
    });
    expect(evaluateCharterAdmission({
      charter: highCeiling, invitee: orgCoworker, roomSensitivityCeiling: "internal",
      requestedClass: "cross-boundary", now: NOW,
    }).inCharter).toBe(false);
  });
});

describe("invitee classification", () => {
  it("treats agt-ext-* as the operator's assistant and other local agents as org coworkers", () => {
    expect(classifyInviteeAgent("AGT-EXT-CLAUDE")).toBe("operator-assistant");
    expect(classifyInviteeAgent("agt-ext-codex")).toBe("operator-assistant");
    expect(classifyInviteeAgent("change-reviewer")).toBe("org-coworker");
  });

  it("maps a posting invitee to create and a read-only one to observe", () => {
    expect(requestedAdmissionClass(true)).toBe("create");
    expect(requestedAdmissionClass(false)).toBe("observe");
  });
});
