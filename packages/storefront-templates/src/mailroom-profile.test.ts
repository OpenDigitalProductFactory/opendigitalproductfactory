// Mailroom profile registry — the control gate for design 2026-09-09 §4.2
// (BI-E64B3730, AC-MAIL-PURPOSE-REGISTRY).

import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES } from "./archetypes/index";
import {
  COMMON_MAILROOM_PROFILE,
  MAILROOM_NOISE_REASON_KEY,
  mailroomAcknowledgeBy,
  mergeMailroomProfile,
  resolveMailroomProfile,
  validateMailroomProfile,
} from "./mailroom-profile";

const petRescue = ALL_ARCHETYPES.find((a) => a.archetypeId === "pet-rescue")!;

describe("mailroom profile registry", () => {
  it("the common profile validates and carries the noise reason", () => {
    expect(validateMailroomProfile(COMMON_MAILROOM_PROFILE)).toEqual([]);
    expect(COMMON_MAILROOM_PROFILE.reasons.some((r) => r.key === MAILROOM_NOISE_REASON_KEY && r.noise)).toBe(true);
  });

  it("every archetype resolves to a valid profile", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const errors = validateMailroomProfile(resolveMailroomProfile(archetype));
      expect(errors, archetype.archetypeId).toEqual([]);
    }
  });

  it("an unknown archetype gets the common profile", () => {
    expect(resolveMailroomProfile(null)).toEqual(COMMON_MAILROOM_PROFILE);
  });

  it("pet-rescue adds the seven §7c reasons plus the vet and adopter lanes over the common ones", () => {
    const profile = resolveMailroomProfile(petRescue);
    const keys = profile.reasons.map((r) => r.key);
    for (const key of [
      "adopt-animal",
      "found-animal",
      "lost-animal",
      "surrender-animal",
      "cruelty-or-at-risk",
      "foster-or-volunteer",
      "donation-or-bequest",
      "veterinary-correspondence",
      "adopter-follow-up",
      "supplier-invoice",
      MAILROOM_NOISE_REASON_KEY,
    ]) {
      expect(keys, key).toContain(key);
    }
    const vet = profile.reasons.find((r) => r.key === "veterinary-correspondence")!;
    expect(vet.queueKey).toBe("veterinary");
    expect(vet.subjectKind).toBe("animal");
    expect(profile.reasons.find((r) => r.key === "cruelty-or-at-risk")!.urgency).toBe("immediate");
    expect(profile.reasons.find((r) => r.key === "found-animal")!.urgency).toBe("hours");
    expect(profile.expectedMailboxes.map((m) => m.purposeKey)).toEqual(
      expect.arrayContaining(["general", "adoptions", "intake", "veterinary"]),
    );
  });

  it("the animal reference pattern matches the reference format the platform issues (BI-92DDAD88)", () => {
    // Live acceptance 2026-09-10: every animalRef on a real install looks like
    // ANML-23E98CB8, and the pattern shipped here matched only ANI-/A-, so a
    // vet's lab-result email never linked to the animal it was about.
    const kind = (resolveMailroomProfile(petRescue).subjectKinds ?? []).find((k) => k.kind === "animal")!;
    const pattern = new RegExp(kind.referencePattern);
    expect(pattern.test("Lab results ready for ANML-23E98CB8 (Pip)")).toBe(true);
    expect("Lab results ready for ANML-23E98CB8 (Pip)".match(pattern)?.[0]).toBe("ANML-23E98CB8");
    expect(pattern.test("no reference here")).toBe(false);
  });

  it("merge replaces by key and keeps the rest", () => {
    const merged = mergeMailroomProfile(COMMON_MAILROOM_PROFILE, {
      expectedMailboxes: [{ purposeKey: "general", label: "Front desk", examples: ["desk@"], why: "x" }],
      reasons: [],
      queues: [],
      defaultReasonKey: "",
    });
    expect(merged.expectedMailboxes.find((m) => m.purposeKey === "general")!.label).toBe("Front desk");
    expect(merged.expectedMailboxes.length).toBe(COMMON_MAILROOM_PROFILE.expectedMailboxes.length);
    expect(merged.defaultReasonKey).toBe(COMMON_MAILROOM_PROFILE.defaultReasonKey);
  });

  it("a reason naming an unknown queue fails validation", () => {
    const broken = {
      ...COMMON_MAILROOM_PROFILE,
      reasons: [...COMMON_MAILROOM_PROFILE.reasons, { key: "x", label: "x", urgency: "days" as const, queueKey: "nowhere", hints: [] }],
    };
    expect(validateMailroomProfile(broken)).toContain("reason x names unknown queue nowhere");
  });

  it("acknowledge windows follow the urgency ladder", () => {
    const at = new Date("2026-09-09T10:00:00Z");
    expect(mailroomAcknowledgeBy("immediate", at).toISOString()).toBe("2026-09-09T11:00:00.000Z");
    expect(mailroomAcknowledgeBy("hours", at).toISOString()).toBe("2026-09-09T14:00:00.000Z");
    expect(mailroomAcknowledgeBy("days", at).toISOString()).toBe("2026-09-11T10:00:00.000Z");
    expect(mailroomAcknowledgeBy("weeks", at).toISOString()).toBe("2026-09-16T10:00:00.000Z");
  });

  it("no profile names an instance fact (an address, a person, a credential)", () => {
    const text = JSON.stringify(ALL_ARCHETYPES.map((a) => a.mailroomProfile ?? null));
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/password|secret|token/i);
  });
});
