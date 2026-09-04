import { describe, expect, it } from "vitest";

import {
  WORK_CAPSULE_WORKROOM_SHAPES,
  WORK_CAPSULE_ACTIVITY_KINDS,
  WORK_CAPSULE_DECISION_SCOPES,
  WORK_CAPSULE_EVIDENCE_KINDS,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_OUTCOME_ANCHOR_KINDS,
  WORK_CAPSULE_PORTFOLIO_ROLES,
  WORK_CAPSULE_SCOPE_ACTIVITY_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
  AGENT_ACTIVITY_KINDS,
  isAgentActivityKind,
  RELEASE_WORKTREE_DEFAULTS,
  buildCapsuleBranchName,
  buildCapsuleSlug,
  buildCapsuleWorktreePath,
  isWorkCapsuleDecisionScope,
  isWorkCapsuleOutcomeAnchorKind,
  isWorkCapsulePortfolioRole,
  isWorkCapsuleScopeActivityKind,
  isWorkCapsuleStatus,
  isRootClonePath,
  normalizeWorkCapsuleScopeInput,
  normalizeBranchTaxonomy,
  parseScopeClaims,
} from "./work-capsules";

describe("agent activity kinds (BI-C41AB195)", () => {
  it("exposes the five human-legible session kinds and they are all valid activity kinds", () => {
    expect([...AGENT_ACTIVITY_KINDS]).toEqual(["thought", "action", "question", "response", "error"]);
    for (const kind of AGENT_ACTIVITY_KINDS) {
      expect(WORK_CAPSULE_ACTIVITY_KINDS).toContain(kind);
    }
  });

  it("isAgentActivityKind accepts the five and rejects lifecycle kinds + junk", () => {
    for (const kind of AGENT_ACTIVITY_KINDS) expect(isAgentActivityKind(kind)).toBe(true);
    expect(isAgentActivityKind("created")).toBe(false);
    expect(isAgentActivityKind("evidence-recorded")).toBe(false);
    expect(isAgentActivityKind("chatter")).toBe(false);
    expect(isAgentActivityKind(42)).toBe(false);
  });
});

describe("work capsule enums", () => {
  it("uses hyphenated status values", () => {
    expect(WORK_CAPSULE_STATUSES).toContain("ready-for-review");
    expect(WORK_CAPSULE_STATUSES).toContain("ready-for-promotion");
    expect(WORK_CAPSULE_STATUSES).not.toContain("ready_for_review");
  });

  it("recognizes valid statuses only", () => {
    expect(isWorkCapsuleStatus("working")).toBe(true);
    expect(isWorkCapsuleStatus("in_progress")).toBe(false);
  });

  it("declares source, executor, and activity enums", () => {
    expect(WORK_CAPSULE_SOURCES).toContain("external-adoption");
    expect(WORK_CAPSULE_EXECUTOR_KINDS).toContain("codex-desktop");
    expect(WORK_CAPSULE_EXECUTOR_KINDS).toContain("grok-desktop");
    expect(WORK_CAPSULE_EXECUTOR_KINDS).toContain("antigravity-desktop");
    expect(WORK_CAPSULE_ACTIVITY_KINDS).toContain("evidence-recorded");
  });
});

describe("scope claims", () => {
  it("filters invalid scope claims and rejects malformed timestamps", () => {
    const claims = parseScopeClaims([
      {
        kind: "path",
        value: "apps/web/lib/work-capsules.ts",
        intent: "edit",
        recordedAt: "2026-05-14T00:00:00.000Z",
        recordedByPrincipalId: "principal-1",
      },
      { kind: "bad", value: "x", intent: "edit" },
      {
        kind: "path",
        value: "apps/web/x.ts",
        intent: "edit",
        recordedAt: "yesterday",
        recordedByPrincipalId: "principal-1",
      },
      {
        kind: "path",
        value: "",
        intent: "edit",
        recordedAt: "2026-05-14T00:00:00.000Z",
        recordedByPrincipalId: "principal-1",
      },
    ]);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.kind).toBe("path");
  });
});

describe("layer-scoped capsule metadata", () => {
  it("declares the closed layer, portfolio, activity, and anchor vocabularies", () => {
    expect(WORK_CAPSULE_DECISION_SCOPES).toEqual(["wwmd", "wwwd", "wsid"]);
    expect(WORK_CAPSULE_PORTFOLIO_ROLES).toEqual([
      "foundational",
      "manufactureAndDeliver",
      "forEmployees",
      "productsAndServicesSold",
    ]);
    expect(WORK_CAPSULE_SCOPE_ACTIVITY_KINDS).toContain("craft-judgment");
    expect(WORK_CAPSULE_OUTCOME_ANCHOR_KINDS).toContain("work-case");
    expect(WORK_CAPSULE_OUTCOME_ANCHOR_KINDS).toContain("digital-product");
  });

  it("recognizes valid scope values only", () => {
    expect(isWorkCapsuleDecisionScope("wwwd")).toBe(true);
    expect(isWorkCapsuleDecisionScope("business")).toBe(false);
    expect(isWorkCapsulePortfolioRole("manufactureAndDeliver")).toBe(true);
    expect(isWorkCapsulePortfolioRole("manufacture-and-deliver")).toBe(false);
    expect(isWorkCapsuleScopeActivityKind("launch-readiness")).toBe(true);
    expect(isWorkCapsuleScopeActivityKind("launch_readiness")).toBe(false);
    expect(isWorkCapsuleOutcomeAnchorKind("coworker")).toBe(true);
    expect(isWorkCapsuleOutcomeAnchorKind("agent")).toBe(false);
  });

  it("normalizes empty scope input to nullable fields and empty relationship arrays", () => {
    expect(normalizeWorkCapsuleScopeInput(undefined)).toEqual({
      workroomShape: null,
      workShape: null,
      decisionScope: null,
      portfolioRole: null,
      servedPersona: null,
      activityKind: null,
      outcomeAnchor: null,
      servesPortfolioRoles: [],
      dependsOnPortfolioRoles: [],
    });
  });

  it("normalizes a scoped company/customer activity without requiring a backlog item", () => {
    expect(normalizeWorkCapsuleScopeInput({
      decisionScope: "wwwd",
      portfolioRole: "productsAndServicesSold",
      servedPersona: " customer ",
      activityKind: "delivery",
      outcomeAnchor: {
        kind: "work-case",
        id: "CASE-123",
        label: " Onboard Contoso ",
        url: " https://example.test/work-cases/CASE-123 ",
        source: " customer-portal ",
      },
      servesPortfolioRoles: ["productsAndServicesSold", "manufactureAndDeliver"],
      dependsOnPortfolioRoles: ["foundational"],
    })).toEqual({
      workroomShape: null,
      workShape: null,
      decisionScope: "wwwd",
      portfolioRole: "productsAndServicesSold",
      servedPersona: "customer",
      activityKind: "delivery",
      outcomeAnchor: {
        kind: "work-case",
        id: "CASE-123",
        label: "Onboard Contoso",
        url: "https://example.test/work-cases/CASE-123",
        source: "customer-portal",
      },
      servesPortfolioRoles: ["productsAndServicesSold", "manufactureAndDeliver"],
      dependsOnPortfolioRoles: ["foundational"],
    });
  });

  it("rejects invalid scope metadata before persistence", () => {
    expect(() => normalizeWorkCapsuleScopeInput({ decisionScope: "business" })).toThrow(/decisionScope/i);
    expect(() => normalizeWorkCapsuleScopeInput({ portfolioRole: "sales" })).toThrow(/portfolioRole/i);
    expect(() => normalizeWorkCapsuleScopeInput({ activityKind: "unknown" })).toThrow(/activityKind/i);
    expect(() => normalizeWorkCapsuleScopeInput({
      outcomeAnchor: { kind: "agent" },
    })).toThrow(/outcomeAnchor/i);
    expect(() => normalizeWorkCapsuleScopeInput({
      servesPortfolioRoles: ["productsAndServicesSold", "sales"],
    })).toThrow(/servesPortfolioRoles/i);
  });
});

describe("evidence kinds", () => {
  it("recognizes the allowlist", () => {
    expect(WORK_CAPSULE_EVIDENCE_KINDS).toContain("test");
    expect(WORK_CAPSULE_EVIDENCE_KINDS).toContain("note");
  });
});

describe("branch taxonomy", () => {
  it("extracts known branch prefixes", () => {
    expect(normalizeBranchTaxonomy("feat/work-capsules")).toBe("feat");
    expect(normalizeBranchTaxonomy("doc/work-capsules")).toBe("doc");
    expect(normalizeBranchTaxonomy("random")).toBe(null);
  });
});

describe("buildCapsuleSlug", () => {
  it("lowercases, replaces non-alnum with hyphens, trims, and caps length", () => {
    expect(buildCapsuleSlug("Provider routing tool capability")).toBe("provider-routing-tool-capability");
    expect(buildCapsuleSlug("  Lots   of    spaces  ")).toBe("lots-of-spaces");
    expect(buildCapsuleSlug("emoji 🎉 and 中文 mixed!")).toBe("emoji-and-mixed");
    const longTitle = "a".repeat(120);
    expect(buildCapsuleSlug(longTitle).length).toBeLessThanOrEqual(48);
  });

  it("falls back to capsuleId tail when the title slugs to empty", () => {
    expect(buildCapsuleSlug("...", "WC-ABCD1234")).toBe("wc-abcd1234");
  });
});

describe("buildCapsuleBranchName", () => {
  it("uses the chosen taxonomy as prefix", () => {
    expect(buildCapsuleBranchName({ taxonomy: "feat", slug: "work-capsule" })).toBe("feat/work-capsule");
    expect(buildCapsuleBranchName({ taxonomy: "doc", slug: "work-capsule-phase-2" })).toBe(
      "doc/work-capsule-phase-2",
    );
  });

  it("rejects an unknown taxonomy", () => {
    expect(() => buildCapsuleBranchName({ taxonomy: "wat" as any, slug: "x" })).toThrow(/branch taxonomy/i);
  });
});

describe("buildCapsuleWorktreePath", () => {
  it("emits the Windows convention for win32", () => {
    expect(buildCapsuleWorktreePath({ os: "win32", slug: "work-capsule" })).toBe("D:\\DPF-work-capsule");
  });

  it("emits the Unix convention for darwin and linux", () => {
    expect(buildCapsuleWorktreePath({ os: "darwin", slug: "work-capsule", home: "/Users/mark" })).toBe(
      "/Users/mark/dpf-worktrees/work-capsule",
    );
    expect(buildCapsuleWorktreePath({ os: "linux", slug: "work-capsule", home: "/home/mark" })).toBe(
      "/home/mark/dpf-worktrees/work-capsule",
    );
  });

  it("publishes release-worktree defaults for supported host families", () => {
    expect(RELEASE_WORKTREE_DEFAULTS.win32).toBe("D:\\DPF");
    expect(RELEASE_WORKTREE_DEFAULTS.darwin).toBe("{home}/dpf");
    expect(RELEASE_WORKTREE_DEFAULTS.linux).toBe("{home}/dpf");
  });
});

describe("isRootClonePath", () => {
  it("recognizes the canonical Windows root clone", () => {
    expect(isRootClonePath("D:\\DPF", "win32")).toBe(true);
    expect(isRootClonePath("d:/DPF", "win32")).toBe(true);
    expect(isRootClonePath("D:\\DPF-feature", "win32")).toBe(false);
  });

  it("recognizes the canonical Unix root clone", () => {
    expect(isRootClonePath("/Users/mark/dpf", "darwin", "/Users/mark")).toBe(true);
    expect(isRootClonePath("/home/mark/dpf-worktrees/x", "linux", "/home/mark")).toBe(false);
  });

  it("respects the DPF_RELEASE_WORKTREE_PATH override when supplied", () => {
    expect(isRootClonePath("/srv/release", "linux", "/home/x", "/srv/release")).toBe(true);
  });
});

// EP-WORK-POSTURE (BI-8C54B216) — the collaboration shape is part of the scope
// a room is convened with.
describe("workroom shape on the convene path", () => {
  it("accepts every declared shape key", () => {
    for (const shape of WORK_CAPSULE_WORKROOM_SHAPES) {
      expect(normalizeWorkCapsuleScopeInput({ workroomShape: shape }).workroomShape).toBe(shape);
    }
  });

  it("treats absent, null and empty as no shape rather than an error", () => {
    expect(normalizeWorkCapsuleScopeInput({}).workroomShape).toBeNull();
    expect(normalizeWorkCapsuleScopeInput({ workroomShape: null }).workroomShape).toBeNull();
    expect(normalizeWorkCapsuleScopeInput({ workroomShape: "" }).workroomShape).toBeNull();
  });

  it("REJECTS an unknown shape rather than silently dropping it", () => {
    // Dropping it would convene the room with no shape while the caller
    // believed it had one — the posture would then run on a shape nobody set.
    expect(() => normalizeWorkCapsuleScopeInput({ workroomShape: "not-a-shape" })).toThrow(
      /workroomShape must be one of/,
    );
    expect(() => normalizeWorkCapsuleScopeInput({ workroomShape: 42 })).toThrow();
  });
});
