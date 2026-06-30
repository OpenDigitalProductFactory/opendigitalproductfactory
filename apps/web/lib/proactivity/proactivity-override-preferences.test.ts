import { describe, expect, it } from "vitest";

import {
  buildProactivityDismissalFact,
  buildProactivityOverrideFact,
  cooldownFactKeyFor,
  overrideFactKeyFor,
} from "./proactivity-override-preferences";

const proposal = {
  kind: "proactivity-change" as const,
  agentId: "dispatcher",
  activityFamily: "field-dispatch-appointment" as const,
  routeContext: "/storefront",
  currentLevel: "balanced" as const,
  proposedLevel: "assertive" as const,
  scope: "activity-family" as const,
  rationale: "Late customer appointments should be warned earlier.",
  evidenceRefs: [{ kind: "dispatch-event", id: "running-late" }],
  spendImpact: "may increase monitoring and notification spend within existing authority",
  authorityImpact: "does not grant new tools, permissions, or approval bypasses",
};

describe("proactivity override facts", () => {
  it("builds accepted proactivity changes as scoped auditable user facts", () => {
    const fact = buildProactivityOverrideFact({
      proposalId: "AP-PROACTIVE",
      acknowledgedByUserId: "user-1",
      acknowledgedAt: "2026-06-30T18:30:00.000Z",
      proposal,
    });

    expect(fact).toMatchObject({
      category: "preference",
      key: "aiCoworkerProactivity:activity-family:field-dispatch-appointment",
      sourceRoute: "/storefront",
      sourceAgentId: "dispatcher",
      lastValidatedAt: new Date("2026-06-30T18:30:00.000Z"),
    });
    expect(JSON.parse(fact.value)).toMatchObject({
      scope: "activity-family",
      scopeKey: "activity-family:field-dispatch-appointment",
      level: "assertive",
      previousLevel: "balanced",
      source: "coworker-proposal",
      proposedByAgentId: "dispatcher",
      acknowledgedByUserId: "user-1",
      proposalId: "AP-PROACTIVE",
      rationale: "Late customer appointments should be warned earlier.",
    });
    expect(JSON.parse(fact.value).evidenceRefs).toContainEqual({
      kind: "dispatch-event",
      id: "running-late",
    });
  });

  it("uses stable scope keys so new acknowledgements replace the same fact", () => {
    expect(overrideFactKeyFor(proposal)).toBe(
      "aiCoworkerProactivity:activity-family:field-dispatch-appointment",
    );
    expect(overrideFactKeyFor({ ...proposal, proposedLevel: "quiet" })).toBe(
      "aiCoworkerProactivity:activity-family:field-dispatch-appointment",
    );
  });

  it("builds dismissed proposal cooldowns without changing overrides", () => {
    const fact = buildProactivityDismissalFact({
      proposalId: "AP-PROACTIVE",
      dismissedByUserId: "user-1",
      dismissedAt: "2026-06-30T18:30:00.000Z",
      cooldownUntil: "2026-07-07T18:30:00.000Z",
      proposal,
    });

    expect(fact).toMatchObject({
      category: "preference",
      key: "aiCoworkerProactivityCooldown:activity-family:field-dispatch-appointment",
      sourceRoute: "/storefront",
      sourceAgentId: "dispatcher",
    });
    expect(cooldownFactKeyFor(proposal)).toBe(fact.key);
    expect(JSON.parse(fact.value)).toEqual({
      proposalId: "AP-PROACTIVE",
      scopeKey: "activity-family:field-dispatch-appointment",
      proposedLevel: "assertive",
      dismissedByUserId: "user-1",
      dismissedAt: "2026-06-30T18:30:00.000Z",
      cooldownUntil: "2026-07-07T18:30:00.000Z",
      rationale: "Late customer appointments should be warned earlier.",
    });
  });
});
