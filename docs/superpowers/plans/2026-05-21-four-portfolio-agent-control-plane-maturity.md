# Four-Portfolio Agent Control Plane Maturity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first governed vertical slice of the four-portfolio agent-control-plane maturity surface: canonical scoring logic, schema foundation, seed assessments, portfolio read model, and read-only portfolio UI.

**Architecture:** The first slice keeps the four-portfolio taxonomy as the anchor and adds a maturity assessment companion model rather than overloading `TaxonomyNode`. A single shared domain module (`packages/db/src/capability-maturity.ts`, exported as `@dpf/db/capability-maturity`) is the **single writer/deriver** for `mvpTargetScore`, `confidenceGrade`, dependency-bounded `effectiveMaturity`, and DAG validation (spec §15.2 #13). UI, reports, and the seeder read derived values through this package boundary; nothing imports `apps/web` from `packages/db`. The seeder is the only mutation path in slice 1 and calls `validateCapabilityDependencyGraph` before any write (§15.2 #18).

**Feature flag:** No flag for this slice. The surface is read-only, additive, and renders only when assessments exist for the selected node — a zero-data install sees nothing. Productize-mode mutations, hive-mind capture, and customer overlay scoring all ship behind flags in their respective follow-on plans.

**Ship documentation:** When slice 1 reaches `main`, update `docs/superpowers/specs/2026-03-10-portfolio-route-design.md` and the portal user guide to describe the maturity panel. Do not pre-document the follow-on phases.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL, Vitest, DPF theme tokens, existing `/portfolio` route and portfolio components.

---

## Scope Check

The design spec covers multiple independent subsystems. This implementation plan intentionally covers only the first vertical slice:

1. capability maturity assessment data model,
2. scoring and dependency logic,
3. initial seeded agent-control-plane assessments,
4. read-only portfolio rollup,
5. read-only portfolio UI.

The following are follow-on efforts and should get separate plans after this slice lands:

- Hive-mind maturity signal capture
- Vendor replacement confidence and benchmark registry
- Productize-mode governance queue
- Semantic Data Plane
- Agent Commerce and Spend Authority
- Cross-Layer Kill Switch
- Customer overlay maturity scoring

## File Structure

**Create**

- `packages/db/src/capability-maturity.ts` — domain constants, enums, score derivation, effective maturity, confidence decay, DAG validation.
- `packages/db/src/capability-maturity.test.ts` — unit tests for score derivation, dependency cascade, stale decay, cycle rejection.
- `apps/web/lib/maturity/capability-maturity-data.ts` — Prisma-backed read model for portfolio/taxonomy maturity rollups.
- `apps/web/lib/maturity/capability-maturity-data.test.ts` — mocked Prisma-shape tests for rollup behavior.
- `apps/web/components/portfolio/CapabilityMaturityPanel.tsx` — read-only maturity summary for a selected portfolio/taxonomy node.
- `apps/web/components/portfolio/CapabilityMaturityPanel.test.tsx` — render tests for investment, operations, and productize modes.
- `packages/db/src/seed-agent-control-plane-maturity.ts` — idempotent seed helper for initial canonical assessments.
- `packages/db/src/seed-agent-control-plane-maturity.test.ts` — seed-shape tests for canonical records.
- `packages/db/data/agent_control_plane_maturity_seed.json` — canonical initial assessments from the spec.

**Modify**

- `packages/db/prisma/schema.prisma` — add maturity assessment companion models and relations.
- `packages/db/package.json` — export `@dpf/db/capability-maturity`.
- `packages/db/src/seed.ts` — call the new seed helper.
- `apps/web/components/portfolio/PortfolioNodeDetail.tsx` — render the maturity panel in the selected taxonomy node view.
- `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` — load maturity rollup data for the selected node.

**Generated**

- Prisma migration directory created by `pnpm --filter @dpf/db exec prisma migrate dev --name agent_control_plane_maturity`

---

## Task 1: Add Maturity Domain Logic

**Files:**

- Create: `packages/db/src/capability-maturity.ts`
- Create: `packages/db/src/capability-maturity.test.ts`
- Modify: `packages/db/package.json`

- [ ] **Step 1: Write failing tests for derived targets, confidence decay, effective maturity, and cycle detection**

Create `packages/db/src/capability-maturity.test.ts`:

```ts
import {
  deriveConfidenceGrade,
  deriveEffectiveMaturity,
  deriveMvpTargetScore,
  validateCapabilityDependencyGraph,
} from "./capability-maturity";

describe("capability maturity scoring", () => {
  it.each([
    ["critical", 4],
    ["elevated", 4],
    ["standard", 3],
    ["low", 3],
  ] as const)("derives MVP target for %s risk", (riskTier, expected) => {
    expect(deriveMvpTargetScore(riskTier)).toBe(expected);
  });

  it("returns claimed when no evidence stream has ever flowed and no review", () => {
    // Spec §5.3 precedence rule 4: fresh-authored seed rows stay claimed; they do not
    // decay to stale on age alone because there was nothing to go silent.
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: null,
      lastGovernanceReviewAt: null,
      hasContinuousEvidence: false,
    })).toBe("claimed");
  });

  it("returns stale when evidence stream existed and has been silent > 30 days", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: new Date("2026-04-15T12:00:00.000Z"),
      lastGovernanceReviewAt: null,
      hasContinuousEvidence: false,
    })).toBe("stale");
  });

  it("returns verified when governance review is fresh, even if evidence lapsed", () => {
    // Spec §5.3 precedence rule 1: fresh review overrides stale evidence signal.
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: new Date("2026-04-15T12:00:00.000Z"),
      lastGovernanceReviewAt: new Date("2026-05-10T12:00:00.000Z"),
      hasContinuousEvidence: true,
    })).toBe("verified");
  });

  it("returns evidenced when continuous evidence is fresh and review is absent", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: new Date("2026-05-20T12:00:00.000Z"),
      lastGovernanceReviewAt: null,
      hasContinuousEvidence: true,
    })).toBe("evidenced");
  });

  it("bounds effective maturity by dependency maturity", () => {
    expect(deriveEffectiveMaturity({
      maturityScore: 4,
      dependencyEffectiveMaturities: [4, 2, 3],
      confidenceGrade: "evidenced",
    })).toBe(2);
  });

  it("demotes stale effective maturity by one", () => {
    expect(deriveEffectiveMaturity({
      maturityScore: 3,
      dependencyEffectiveMaturities: [4],
      confidenceGrade: "stale",
    })).toBe(2);
  });

  it("does not demote claimed effective maturity (claimed is not decay)", () => {
    // Spec §5.3: claimed carries its own visual treatment; it does not -1 the score.
    expect(deriveEffectiveMaturity({
      maturityScore: 3,
      dependencyEffectiveMaturities: [4],
      confidenceGrade: "claimed",
    })).toBe(3);
  });

  it("floors stale demotion at zero", () => {
    expect(deriveEffectiveMaturity({
      maturityScore: 0,
      dependencyEffectiveMaturities: [],
      confidenceGrade: "stale",
    })).toBe(0);
  });

  it("rejects direct dependency cycles", () => {
    expect(() => validateCapabilityDependencyGraph([
      { id: "runtime", dependsOnIds: ["gateway"] },
      { id: "gateway", dependsOnIds: ["runtime"] },
    ])).toThrow(/cycle/i);
  });

  it("rejects transitive dependency cycles", () => {
    expect(() => validateCapabilityDependencyGraph([
      { id: "a", dependsOnIds: ["b"] },
      { id: "b", dependsOnIds: ["c"] },
      { id: "c", dependsOnIds: ["a"] },
    ])).toThrow(/cycle/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter @dpf/db test capability-maturity.test.ts
```

Expected: FAIL because `packages/db/src/capability-maturity.ts` does not exist.

- [ ] **Step 3: Implement the domain module**

Create `packages/db/src/capability-maturity.ts`:

```ts
export const CAPABILITY_MATURITY_RISK_TIERS = ["critical", "elevated", "standard", "low"] as const;
export type CapabilityMaturityRiskTier = (typeof CAPABILITY_MATURITY_RISK_TIERS)[number];

export const CAPABILITY_MATURITY_CONFIDENCE_GRADES = ["verified", "evidenced", "claimed", "stale"] as const;
export type CapabilityMaturityConfidenceGrade = (typeof CAPABILITY_MATURITY_CONFIDENCE_GRADES)[number];

export const CAPABILITY_MATURITY_CATEGORIES = [
  "runtime",
  "identity_authority",
  "tool_gateway",
  "data_plane",
  "budget_spend",
  "evidence_eval",
  "human_override",
  "composition_helper",
] as const;
export type CapabilityMaturityCategory = (typeof CAPABILITY_MATURITY_CATEGORIES)[number];

export const CAPABILITY_STRATEGIC_OWNERSHIP = [
  "owned_core",
  "embedded_accelerator",
  "boundary_adapter",
  "avoid",
] as const;
export type CapabilityStrategicOwnership = (typeof CAPABILITY_STRATEGIC_OWNERSHIP)[number];

export const CAPABILITY_INSTALL_SCOPES = ["canonical", "dpf_dogfood", "customer_overlay"] as const;
export type CapabilityInstallScope = (typeof CAPABILITY_INSTALL_SCOPES)[number];

export const CAPABILITY_PRODUCTIZATION_STATUSES = [
  "not_eligible",
  "eligible",
  "candidate",
  "productized",
] as const;
export type CapabilityProductizationStatus = (typeof CAPABILITY_PRODUCTIZATION_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export function deriveMvpTargetScore(riskTier: CapabilityMaturityRiskTier): number {
  return riskTier === "critical" || riskTier === "elevated" ? 4 : 3;
}

export function deriveConfidenceGrade(input: {
  now: Date;
  evidenceFreshnessAt: Date | null;
  lastGovernanceReviewAt: Date | null;
  hasContinuousEvidence: boolean;
}): CapabilityMaturityConfidenceGrade {
  // Returns null when input timestamp is null — distinguishes "never happened" from "happened long ago".
  const ageDays = (at: Date | null): number | null =>
    at === null ? null : Math.floor((input.now.getTime() - at.getTime()) / DAY_MS);

  const evidenceAge = ageDays(input.evidenceFreshnessAt);
  const reviewAge = ageDays(input.lastGovernanceReviewAt);

  // Spec §5.3 precedence:
  // 1. Fresh review (≤30d) AND any evidence ever → verified (fresh review overrides stale evidence)
  if (reviewAge !== null && reviewAge <= 30 && (evidenceAge !== null || input.hasContinuousEvidence)) {
    return "verified";
  }

  // 2. Fresh continuous evidence (≤30d) AND no recent review → evidenced
  if (evidenceAge !== null && evidenceAge <= 30 && input.hasContinuousEvidence) {
    return "evidenced";
  }

  // 3. Evidence existed and lapsed (>30d) OR review existed and lapsed (>90d) → stale
  if ((evidenceAge !== null && evidenceAge > 30) || (reviewAge !== null && reviewAge > 90)) {
    return "stale";
  }

  // 4. No evidence stream and no review → claimed (the seed/authored default)
  return "claimed";
}

// Spec §10.3: effectiveMaturity = min(maturityScore, min(dependsOn.effectiveMaturity)),
// then -1 if confidenceGrade === "stale" (floor 0). `claimed` does not demote.
export function deriveEffectiveMaturity(input: {
  maturityScore: number;
  dependencyEffectiveMaturities: number[];
  confidenceGrade: CapabilityMaturityConfidenceGrade;
}): number {
  const dependencyFloor = input.dependencyEffectiveMaturities.length > 0
    ? Math.min(...input.dependencyEffectiveMaturities)
    : input.maturityScore;
  const bounded = Math.min(input.maturityScore, dependencyFloor);
  return input.confidenceGrade === "stale" ? Math.max(0, bounded - 1) : bounded;
}

export function validateCapabilityDependencyGraph(records: Array<{ id: string; dependsOnIds: string[] }>): void {
  const graph = new Map(records.map((record) => [record.id, record.dependsOnIds]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string, path: string[]): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Capability maturity dependency cycle detected: ${[...path, id].join(" -> ")}`);
    }

    visiting.add(id);
    for (const depId of graph.get(id) ?? []) visit(depId, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const record of records) visit(record.id, []);
}
```

- [ ] **Step 4: Export the domain module**

Modify `packages/db/package.json` exports:

```json
"./capability-maturity": "./src/capability-maturity.ts"
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```powershell
pnpm --filter @dpf/db test capability-maturity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/db/src/capability-maturity.ts packages/db/src/capability-maturity.test.ts packages/db/package.json
git commit -s -m "feat(maturity): add capability scoring domain logic"
```

---

## Task 2: Add Schema Foundation

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: Prisma migration generated by `pnpm --filter @dpf/db exec prisma migrate dev --name agent_control_plane_maturity`

- [ ] **Step 1: Write the schema decision note in the commit body before editing**

Record this decision in the eventual commit body:

```text
Schema audit:
- TaxonomyNode remains classification/placement, not score state.
- BusinessCapability maturity fields are for business capability mapping and must not be conflated with agent-control-plane maturity.
- PortfolioQualityIssue records operational defects, not scored capability state.
- EaElement can anchor architectural capability identity, but maturity needs time-aware assessment records and dependency edges.
Decision: add CapabilityMaturityAssessment and CapabilityMaturityDependency as companion models linked to Portfolio/TaxonomyNode/EaElement.
```

- [ ] **Step 2: Add Prisma models and relations**

Modify `packages/db/prisma/schema.prisma`:

```prisma
model CapabilityMaturityAssessment {
  id                          String                         @id @default(cuid())
  assessmentId                String                         @unique
  name                        String
  capabilityCategory          String
  riskTier                    String
  maturityScore               Int
  confidenceGrade             String                         @default("claimed")
  strategicOwnership          String
  vendorReplacementConfidence String                         @default("low")
  installScope                String                         @default("canonical")
  archetypeScope              String?
  productizationStatus        String                         @default("not_eligible")
  // Spec §10.4 anti-inflation guard: any maturityScore change within 14 days of this
  // timestamp must route through governance review. Nullable; written on status transitions.
  productizationStatusChangedAt DateTime?
  // Spec §8: vendorReplacementConfidence = "verified" requires a recorded parity checklist
  // and at least one production replacement. Stored as opaque JSON, schema-validated in code.
  parityChecklistEvidence     Json                           @default("[]")
  existingPrimitives          Json                           @default("[]")
  maturityGaps                Json                           @default("[]")
  evidenceSources             Json                           @default("[]")
  hiveMindSignals             Json                           @default("[]")
  kernelPrinciples            String[]                       @default([])
  operationalSurface          String?
  hasContinuousEvidence       Boolean                        @default(false)
  evidenceFreshnessAt         DateTime?
  lastGovernanceReviewAt      DateTime?
  lastAssessmentAt            DateTime                       @default(now())
  assessedBy                  String                         @default("seed")
  portfolioId                 String
  taxonomyNodeId              String?
  eaElementId                 String?
  digitalProductId            String?
  createdAt                   DateTime                       @default(now())
  updatedAt                   DateTime                       @updatedAt
  portfolio                   Portfolio                      @relation(fields: [portfolioId], references: [id], onDelete: Cascade)
  taxonomyNode                TaxonomyNode?                  @relation(fields: [taxonomyNodeId], references: [id], onDelete: SetNull)
  eaElement                   EaElement?                     @relation(fields: [eaElementId], references: [id], onDelete: SetNull)
  digitalProduct              DigitalProduct?                @relation(fields: [digitalProductId], references: [id], onDelete: SetNull)
  dependencies                CapabilityMaturityDependency[] @relation("CapabilityMaturityDependencyFrom")
  dependents                  CapabilityMaturityDependency[] @relation("CapabilityMaturityDependencyTo")

  @@index([portfolioId])
  @@index([taxonomyNodeId])
  @@index([eaElementId])
  @@index([digitalProductId])
  @@index([capabilityCategory])
  @@index([riskTier])
  @@index([installScope])
  @@index([productizationStatus])
}

model CapabilityMaturityDependency {
  id             String                       @id @default(cuid())
  assessmentId   String
  dependencyId   String
  createdAt      DateTime                     @default(now())
  assessment     CapabilityMaturityAssessment @relation("CapabilityMaturityDependencyFrom", fields: [assessmentId], references: [id], onDelete: Cascade)
  dependency     CapabilityMaturityAssessment @relation("CapabilityMaturityDependencyTo", fields: [dependencyId], references: [id], onDelete: Cascade)

  @@unique([assessmentId, dependencyId])
  @@index([dependencyId])
}
```

Also add relation fields to `Portfolio`, `DigitalProduct`, `TaxonomyNode`, and `EaElement`:

```prisma
capabilityMaturityAssessments CapabilityMaturityAssessment[]
```

- [ ] **Step 3: Create migration**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name agent_control_plane_maturity
```

Expected: migration created and applied locally.

- [ ] **Step 4: Generate Prisma client**

Run:

```powershell
pnpm --filter @dpf/db generate
```

Expected: Prisma client generation succeeds.

- [ ] **Step 5: Commit**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(db): add capability maturity assessment schema"
```

---

## Task 3: Seed Canonical Agent-Control-Plane Assessments

**Files:**

- Create: `packages/db/data/agent_control_plane_maturity_seed.json`
- Create: `packages/db/src/seed-agent-control-plane-maturity.ts`
- Create: `packages/db/src/seed-agent-control-plane-maturity.test.ts`
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: Write seed-shape tests**

Create `packages/db/src/seed-agent-control-plane-maturity.test.ts`:

```ts
import seedRows from "../data/agent_control_plane_maturity_seed.json";

describe("agent control plane maturity seed", () => {
  it("uses stable assessment ids and derived target-compatible risk tiers", () => {
    expect(seedRows).toHaveLength(11);
    for (const row of seedRows) {
      expect(row.assessmentId).toMatch(/^ACPM-[A-Z0-9-]+$/);
      expect(["critical", "elevated", "standard", "low"]).toContain(row.riskTier);
      expect(row.installScope).toBe("canonical");
      expect(row.confidenceGrade).toBe("claimed");
    }
  });

  it("does not author mvpTargetScore in seed rows", () => {
    for (const row of seedRows) {
      expect(row).not.toHaveProperty("mvpTargetScore");
      expect(row).not.toHaveProperty("effectiveMaturity");
    }
  });
});
```

- [ ] **Step 2: Add seed JSON**

Create `packages/db/data/agent_control_plane_maturity_seed.json` with this complete seed array:

```json
[
  {
    "assessmentId": "ACPM-IDENTITY-AUTHORITY",
    "name": "Principal identity and authority",
    "portfolioSlug": "foundational",
    "taxonomyNodePath": "foundational/platform_services/identity_and_access_platform",
    "capabilityCategory": "identity_authority",
    "riskTier": "critical",
    "maturityScore": 3,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "medium",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["Principal", "PrincipalAlias", "AgentToolGrant", "AuthorityBinding"],
    "maturityGaps": ["Universal principal propagation", "Delegated consent", "Token vault"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["no-assumptions", "never-fabricate"],
    "operationalSurface": "/platform/ai/authority",
    "dependsOnAssessmentIds": []
  },
  {
    "assessmentId": "ACPM-MCP-TOOL-GOVERNANCE",
    "name": "MCP and tool governance",
    "portfolioSlug": "foundational",
    "taxonomyNodePath": "foundational/platform_services/api_management_platform",
    "capabilityCategory": "tool_gateway",
    "riskTier": "elevated",
    "maturityScore": 3,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "medium",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["McpApiToken", "ToolExecution", "AgentToolGrant", "search_tool_marketplace"],
    "maturityGaps": ["Gateway hardening", "Readiness scoring", "External MCP maturity"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["tool-evaluation-pipeline", "never-ask-user-to-run-commands"],
    "operationalSurface": "/platform/tools/integrations",
    "dependsOnAssessmentIds": ["ACPM-IDENTITY-AUTHORITY"]
  },
  {
    "assessmentId": "ACPM-A2A-COORDINATION",
    "name": "A2A coworker coordination",
    "portfolioSlug": "manufacturing_and_delivery",
    "taxonomyNodePath": "manufacturing_and_delivery/request_to_fulfill/delivery_distribution_activation/ai_ml_and_agent_ci_cd_modelops_agentops_digital_delivery",
    "capabilityCategory": "runtime",
    "riskTier": "elevated",
    "maturityScore": 2,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "low",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["TaskRun", "Agent", "AgentThread", "EP-A2A"],
    "maturityGaps": ["Task-native handoff", "Resumability", "Acceptance evidence"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["architecture-over-shortcuts"],
    "operationalSurface": "/build",
    "dependsOnAssessmentIds": ["ACPM-IDENTITY-AUTHORITY", "ACPM-GOVERNANCE-EVIDENCE"]
  },
  {
    "assessmentId": "ACPM-RUNTIME-CONTROL",
    "name": "Work Capsules and runtime control",
    "portfolioSlug": "manufacturing_and_delivery",
    "taxonomyNodePath": "manufacturing_and_delivery/request_to_fulfill/delivery_distribution_activation/ai_ml_and_agent_ci_cd_modelops_agentops_digital_delivery",
    "capabilityCategory": "runtime",
    "riskTier": "elevated",
    "maturityScore": 3,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "medium",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["WorkCapsule", "RuntimeTarget", "RuntimeVerification"],
    "maturityGaps": ["Mandatory wrapper", "Runtime target coverage", "Acceptance gate coverage"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["worktree-per-session", "build-gate-mandatory"],
    "operationalSurface": "/build/work-control",
    "dependsOnAssessmentIds": ["ACPM-MCP-TOOL-GOVERNANCE", "ACPM-GOVERNANCE-EVIDENCE"]
  },
  {
    "assessmentId": "ACPM-GOVERNANCE-EVIDENCE",
    "name": "Governance evidence ledger",
    "portfolioSlug": "manufacturing_and_delivery",
    "taxonomyNodePath": "manufacturing_and_delivery/request_to_fulfill/delivery_distribution_activation/release_governance_and_evidence_automation_digital_delivery",
    "capabilityCategory": "evidence_eval",
    "riskTier": "critical",
    "maturityScore": 3,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "medium",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["ToolExecution", "ToolExecutionReceipt", "RuntimeVerification", "FeatureBuild"],
    "maturityGaps": ["Unified evidence UX", "Cross-surface linking", "Evidence quality scoring"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["never-fabricate", "build-gate-mandatory"],
    "operationalSurface": "/platform/ai/authority",
    "dependsOnAssessmentIds": []
  },
  {
    "assessmentId": "ACPM-HIVE-REFINEMENT",
    "name": "Hive mind and user refinement",
    "portfolioSlug": "for_employees",
    "taxonomyNodePath": "for_employees/productivity_services/productivity_applications",
    "capabilityCategory": "human_override",
    "riskTier": "standard",
    "maturityScore": 2,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "low",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["Hive Scout", "portal context overlay", "coworker feedback"],
    "maturityGaps": ["Signal provenance", "Promotion rules", "Routing feedback loop"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["state-results-directly"],
    "operationalSurface": "/work",
    "dependsOnAssessmentIds": ["ACPM-GOVERNANCE-EVIDENCE"]
  },
  {
    "assessmentId": "ACPM-OBS-EVAL-COST",
    "name": "Observability, evals, and cost ledger",
    "portfolioSlug": "foundational",
    "taxonomyNodePath": "foundational/platform_services/observability_platform",
    "capabilityCategory": "evidence_eval",
    "riskTier": "elevated",
    "maturityScore": 2,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "low",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["AgentBudgetEvent", "ToolExecution", "Grafana", "Prometheus"],
    "maturityGaps": ["Trace datasets", "Outcome scoring", "Cost per useful result"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["responsible-capacity-utilization"],
    "operationalSurface": "/ops/health",
    "dependsOnAssessmentIds": ["ACPM-GOVERNANCE-EVIDENCE"]
  },
  {
    "assessmentId": "ACPM-SEMANTIC-DATA",
    "name": "Semantic data and knowledge plane",
    "portfolioSlug": "foundational",
    "taxonomyNodePath": "foundational/data_and_storage_management/data_analytics_and_visualizations",
    "capabilityCategory": "data_plane",
    "riskTier": "elevated",
    "maturityScore": 1,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "low",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["Qdrant", "Neo4j", "docs", "backlog"],
    "maturityGaps": ["Governed metrics", "Lineage", "Freshness", "Policy-aware RAG"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["single-source-of-truth", "live-state-over-seed-data"],
    "operationalSurface": "/knowledge",
    "dependsOnAssessmentIds": ["ACPM-IDENTITY-AUTHORITY", "ACPM-GOVERNANCE-EVIDENCE"]
  },
  {
    "assessmentId": "ACPM-SPEND-AUTHORITY",
    "name": "Spend/payment authority",
    "portfolioSlug": "foundational",
    "taxonomyNodePath": "foundational/platform_services",
    "capabilityCategory": "budget_spend",
    "riskTier": "critical",
    "maturityScore": 1,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "low",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["Invoice", "Payment", "AgentBudgetEvent"],
    "maturityGaps": ["Agent spend limits", "Payment custody", "Approvals", "Freeze controls"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["responsible-capacity-utilization"],
    "operationalSurface": "/finance",
    "dependsOnAssessmentIds": ["ACPM-IDENTITY-AUTHORITY", "ACPM-GOVERNANCE-EVIDENCE"]
  },
  {
    "assessmentId": "ACPM-CUSTOMER-AGENT-SERVICES",
    "name": "Customer-facing agent services",
    "portfolioSlug": "products_and_services_sold",
    "taxonomyNodePath": "products_and_services_sold/digital_platform_services/ai_platforms/ai_agent_platform_as_a_service",
    "capabilityCategory": "composition_helper",
    "riskTier": "standard",
    "maturityScore": 2,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "low",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["CustomerAssistantShell", "Storefront", "portal"],
    "maturityGaps": ["Packaging", "Trust reports", "Sellable offers", "Customer evidence"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["never-fabricate"],
    "operationalSurface": "/storefront",
    "dependsOnAssessmentIds": ["ACPM-RUNTIME-CONTROL", "ACPM-IDENTITY-AUTHORITY", "ACPM-GOVERNANCE-EVIDENCE"]
  },
  {
    "assessmentId": "ACPM-CROSS-LAYER-KILL-SWITCH",
    "name": "Cross-layer kill switch",
    "portfolioSlug": "foundational",
    "taxonomyNodePath": "foundational/platform_services/ai_and_agent_platform",
    "capabilityCategory": "composition_helper",
    "riskTier": "critical",
    "maturityScore": 2,
    "confidenceGrade": "claimed",
    "strategicOwnership": "owned_core",
    "vendorReplacementConfidence": "low",
    "installScope": "canonical",
    "productizationStatus": "not_eligible",
    "existingPrimitives": ["AgentToolGrant", "RuntimeTarget", "ToolExecution", "AgentBudgetEvent"],
    "maturityGaps": ["Stop/revoke/freeze operation", "Token lease revocation", "Spend freeze", "Deployment halt"],
    "evidenceSources": [],
    "hiveMindSignals": [],
    "kernelPrinciples": ["destructive-actions-require-explicit-go", "no-assumptions"],
    "operationalSurface": "/platform/ai/authority",
    "dependsOnAssessmentIds": ["ACPM-RUNTIME-CONTROL", "ACPM-MCP-TOOL-GOVERNANCE", "ACPM-IDENTITY-AUTHORITY", "ACPM-SPEND-AUTHORITY", "ACPM-GOVERNANCE-EVIDENCE"]
  }
]
```

- [ ] **Step 3: Implement idempotent seed helper with pre-write validation**

Per spec §15.2 #18, cycles are rejected at write time, not at render time. Per spec §8, `kernelPrinciples` slugs are not free-text — they must reference real Founder Kernel pages under `docs/founder-kernel/wiki/principles/`. The seed helper validates both before any DB write.

Create `packages/db/src/seed-agent-control-plane-maturity.ts` with an exported function:

```ts
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import seedRows from "../data/agent_control_plane_maturity_seed.json";
import { validateCapabilityDependencyGraph } from "./capability-maturity";

type SeedRow = (typeof seedRows)[number];

function loadValidKernelPrincipleSlugs(): Set<string> {
  // Founder Kernel principles ship as one file per principle. Repo root is two levels up
  // from packages/db; tests can override via DPF_KERNEL_PRINCIPLES_DIR.
  const dir = process.env.DPF_KERNEL_PRINCIPLES_DIR
    ?? join(__dirname, "..", "..", "..", "docs", "founder-kernel", "wiki", "principles");
  const entries = readdirSync(dir, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name.replace(/\.md$/, "")),
  );
}

export async function seedAgentControlPlaneMaturity(prisma: PrismaClient): Promise<void> {
  // Spec §15.2 #18 — reject cycles before any write
  validateCapabilityDependencyGraph(
    (seedRows as SeedRow[]).map((row) => ({
      id: row.assessmentId,
      dependsOnIds: row.dependsOnAssessmentIds ?? [],
    })),
  );

  // Spec §8 — every kernelPrinciples slug must resolve to a real kernel page
  const validPrinciples = loadValidKernelPrincipleSlugs();
  const unknown: Array<{ assessmentId: string; slug: string }> = [];
  for (const row of seedRows as SeedRow[]) {
    for (const slug of row.kernelPrinciples ?? []) {
      if (!validPrinciples.has(slug)) unknown.push({ assessmentId: row.assessmentId, slug });
    }
  }
  if (unknown.length > 0) {
    throw new Error(
      `Unknown kernelPrinciples slugs in maturity seed: ${unknown
        .map((u) => `${u.assessmentId}→${u.slug}`)
        .join(", ")}. Add the principle to docs/founder-kernel/wiki/principles/ or fix the slug.`,
    );
  }

  // Spec §8 — vendorReplacementConfidence === "verified" requires parity-checklist evidence
  for (const row of seedRows as SeedRow[]) {
    const checklist = (row as { parityChecklistEvidence?: unknown[] }).parityChecklistEvidence ?? [];
    if (row.vendorReplacementConfidence === "verified" && checklist.length === 0) {
      throw new Error(
        `Seed row ${row.assessmentId} claims vendorReplacementConfidence="verified" without parityChecklistEvidence (spec §8).`,
      );
    }
  }

  const created = new Map<string, string>();

  for (const row of seedRows as SeedRow[]) {
    const portfolio = await prisma.portfolio.findUnique({ where: { slug: row.portfolioSlug } });
    if (!portfolio) throw new Error(`Missing portfolio for maturity seed: ${row.portfolioSlug}`);

    const taxonomyNode = row.taxonomyNodePath
      ? await prisma.taxonomyNode.findUnique({ where: { nodeId: row.taxonomyNodePath } })
      : null;

    const assessment = await prisma.capabilityMaturityAssessment.upsert({
      where: { assessmentId: row.assessmentId },
      update: {
        name: row.name,
        portfolioId: portfolio.id,
        taxonomyNodeId: taxonomyNode?.id ?? null,
        capabilityCategory: row.capabilityCategory,
        riskTier: row.riskTier,
        maturityScore: row.maturityScore,
        confidenceGrade: row.confidenceGrade,
        strategicOwnership: row.strategicOwnership,
        vendorReplacementConfidence: row.vendorReplacementConfidence,
        installScope: row.installScope,
        productizationStatus: row.productizationStatus,
        existingPrimitives: row.existingPrimitives,
        maturityGaps: row.maturityGaps,
        evidenceSources: row.evidenceSources,
        hiveMindSignals: row.hiveMindSignals,
        kernelPrinciples: row.kernelPrinciples,
        operationalSurface: row.operationalSurface,
        assessedBy: "seed",
      },
      create: {
        assessmentId: row.assessmentId,
        name: row.name,
        portfolioId: portfolio.id,
        taxonomyNodeId: taxonomyNode?.id ?? null,
        capabilityCategory: row.capabilityCategory,
        riskTier: row.riskTier,
        maturityScore: row.maturityScore,
        confidenceGrade: row.confidenceGrade,
        strategicOwnership: row.strategicOwnership,
        vendorReplacementConfidence: row.vendorReplacementConfidence,
        installScope: row.installScope,
        productizationStatus: row.productizationStatus,
        existingPrimitives: row.existingPrimitives,
        maturityGaps: row.maturityGaps,
        evidenceSources: row.evidenceSources,
        hiveMindSignals: row.hiveMindSignals,
        kernelPrinciples: row.kernelPrinciples,
        operationalSurface: row.operationalSurface,
        assessedBy: "seed",
      },
    });

    created.set(row.assessmentId, assessment.id);
  }

  await prisma.capabilityMaturityDependency.deleteMany({
    where: { assessmentId: { in: [...created.values()] } },
  });

  for (const row of seedRows as SeedRow[]) {
    const assessmentId = created.get(row.assessmentId);
    if (!assessmentId) continue;
    for (const dependencyAssessmentId of row.dependsOnAssessmentIds ?? []) {
      const dependencyId = created.get(dependencyAssessmentId);
      if (!dependencyId) throw new Error(`Missing maturity dependency seed: ${dependencyAssessmentId}`);
      await prisma.capabilityMaturityDependency.create({
        data: { assessmentId, dependencyId },
      });
    }
  }
}
```

- [ ] **Step 4: Wire seed helper into existing seed**

Modify `packages/db/src/seed.ts` to import and call `seedAgentControlPlaneMaturity(prisma)` after portfolios and taxonomy nodes are seeded.

- [ ] **Step 5: Run tests**

Run:

```powershell
pnpm --filter @dpf/db test seed-agent-control-plane-maturity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/db/data/agent_control_plane_maturity_seed.json packages/db/src/seed-agent-control-plane-maturity.ts packages/db/src/seed-agent-control-plane-maturity.test.ts packages/db/src/seed.ts
git commit -s -m "feat(db): seed agent control plane maturity assessments"
```

---

## Task 4: Build Portfolio Maturity Read Model

**Files:**

- Create: `apps/web/lib/maturity/capability-maturity-data.ts`
- Create: `apps/web/lib/maturity/capability-maturity-data.test.ts`

- [ ] **Step 1: Write read-model tests**

Per spec §7.3, productize mode is an **overlay** on operations mode, not a replacement. The read model returns two channels: `lifecycleMode` (investment | operations) and `productizationOverlay` (none | eligible | candidate | productized). Per spec §15.2 #15, scores from different `installScope` values do not aggregate silently — the reader requires a single explicit scope.

Create `apps/web/lib/maturity/capability-maturity-data.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getCapabilityMaturityForPortfolioNode } from "./capability-maturity-data";

describe("getCapabilityMaturityForPortfolioNode", () => {
  it("derives targets, effective maturity, lifecycle mode, and dep-blocked annotation", async () => {
    const prisma = {
      capabilityMaturityAssessment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "a1",
            assessmentId: "ACPM-RUNTIME-CONTROL",
            name: "Runtime control",
            portfolioId: "port-1",
            taxonomyNodeId: "tax-1",
            capabilityCategory: "runtime",
            riskTier: "elevated",
            maturityScore: 4,
            confidenceGrade: "evidenced",
            installScope: "canonical",
            productizationStatus: "not_eligible",
            hasContinuousEvidence: true,
            evidenceFreshnessAt: new Date("2026-05-20T12:00:00.000Z"),
            lastGovernanceReviewAt: null,
            dependencies: [
              {
                dependency: {
                  id: "a2",
                  assessmentId: "ACPM-MCP-TOOL-GOVERNANCE",
                  name: "MCP gateway",
                  maturityScore: 2,
                  confidenceGrade: "evidenced",
                  installScope: "canonical",
                  hasContinuousEvidence: true,
                  evidenceFreshnessAt: new Date("2026-05-20T12:00:00.000Z"),
                  lastGovernanceReviewAt: null,
                  dependencies: [],
                },
              },
            ],
          },
        ]),
      },
    };

    const result = await getCapabilityMaturityForPortfolioNode({
      prisma,
      portfolioId: "port-1",
      taxonomyNodeId: "tax-1",
      installScope: "canonical",
      now: new Date("2026-05-21T12:00:00.000Z"),
    });

    expect(result.summary.total).toBe(1);
    expect(result.summary.belowTarget).toBe(1);
    expect(result.rows[0]).toMatchObject({
      assessmentId: "ACPM-RUNTIME-CONTROL",
      mvpTargetScore: 4,
      effectiveMaturity: 2,
      lifecycleMode: "investment",
      productizationOverlay: "none",
      blockedByDependencies: [{ assessmentId: "ACPM-MCP-TOOL-GOVERNANCE", name: "MCP gateway", effectiveMaturity: 2 }],
    });
  });

  it("preserves operations lifecycle when productization overlay is candidate", async () => {
    // Spec §7.3 — productize mode overlays operations, does not replace it.
    const prisma = {
      capabilityMaturityAssessment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "b1",
            assessmentId: "ACPM-SAMPLE",
            name: "Sample",
            portfolioId: "port-1",
            riskTier: "standard",
            maturityScore: 4,
            confidenceGrade: "verified",
            installScope: "canonical",
            productizationStatus: "candidate",
            hasContinuousEvidence: true,
            evidenceFreshnessAt: new Date("2026-05-20T12:00:00.000Z"),
            lastGovernanceReviewAt: new Date("2026-05-15T12:00:00.000Z"),
            dependencies: [],
          },
        ]),
      },
    };

    const result = await getCapabilityMaturityForPortfolioNode({
      prisma,
      portfolioId: "port-1",
      installScope: "canonical",
      now: new Date("2026-05-21T12:00:00.000Z"),
    });

    expect(result.rows[0]).toMatchObject({
      lifecycleMode: "operations",
      productizationOverlay: "candidate",
    });
  });

  it("rejects mixed-scope queries (spec §15.2 #15 scope isolation)", async () => {
    const prisma = { capabilityMaturityAssessment: { findMany: vi.fn().mockResolvedValue([]) } };
    await expect(
      getCapabilityMaturityForPortfolioNode({
        prisma,
        portfolioId: "port-1",
        installScope: undefined as unknown as "canonical",
        now: new Date(),
      }),
    ).rejects.toThrow(/installScope/);
  });
});
```

- [ ] **Step 2: Implement data reader**

Implement:

```ts
import {
  deriveConfidenceGrade,
  deriveEffectiveMaturity,
  deriveMvpTargetScore,
} from "@dpf/db/capability-maturity";

export async function getCapabilityMaturityForPortfolioNode(input: {
  prisma: { capabilityMaturityAssessment: { findMany: Function } };
  portfolioId: string;
  taxonomyNodeId?: string | null;
  installScope: "canonical" | "dpf_dogfood" | "customer_overlay";
  now?: Date;
}): Promise<CapabilityMaturityRollup>
```

The function must:

- reject calls with missing or null `installScope` (spec §15.2 #15);
- fetch assessments scoped to the selected portfolio AND `installScope` — never aggregate across scopes;
- include dependencies transitively (the writer enforces DAG so a depth-bounded recursion of, say, 16 is safe);
- derive `mvpTargetScore` from `riskTier` (spec §5.2);
- derive `confidenceGrade` from `evidenceFreshnessAt`, `lastGovernanceReviewAt`, and `hasContinuousEvidence` (spec §5.3);
- derive `effectiveMaturity` = min(self score, transitive min over dependency effective maturities), then -1 if `confidenceGrade === "stale"` (floor 0);
- emit `blockedByDependencies`: any direct dependency whose `effectiveMaturity` is strictly less than this row's `maturityScore` — drives the "blocked by `<dep>`" annotation required by spec §10.3 rule 5;
- set `lifecycleMode = "operations"` when `effectiveMaturity >= mvpTargetScore`, else `"investment"`;
- set `productizationOverlay = productizationStatus` when status is `eligible | candidate | productized`, else `"none"`;
- compute `summary.belowTarget` by counting `lifecycleMode === "investment"` rows.

The two-channel design preserves the spec's "overlay, not replace" rule: a productized capability still renders its operations health; the productize affordance is additive.

- [ ] **Step 3: Run tests**

Run:

```powershell
pnpm --filter web test apps/web/lib/maturity/capability-maturity-data.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/lib/maturity/capability-maturity-data.ts apps/web/lib/maturity/capability-maturity-data.test.ts
git commit -s -m "feat(portfolio): add maturity rollup read model"
```

---

## Task 5: Add Read-Only Portfolio UI

**Files:**

- Create: `apps/web/components/portfolio/CapabilityMaturityPanel.tsx`
- Create: `apps/web/components/portfolio/CapabilityMaturityPanel.test.tsx`
- Modify: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`
- Modify: `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`

- [ ] **Step 1: Write component tests**

Tests must assert:

- investment rows render the `Investment` lifecycle label and the gap delta
- operations rows render the `Operational` lifecycle label
- a productize-overlay row with `lifecycleMode = "operations"` and `productizationOverlay = "candidate"` renders BOTH the operations label AND the productize affordance (spec §7.3 overlay-not-replace)
- rows whose `effectiveMaturity < maturityScore` because of a dependency render a "blocked by `<dep-name>`" annotation linking to the dependency's row (spec §10.3 rule 5)
- rows with `confidenceGrade === "stale"` render the "stale −1" badge and the demoted effective score
- rows with `confidenceGrade === "claimed"` render an "unproven" muted treatment but NO score demotion (spec §5.3)
- no hardcoded Tailwind color classes like `text-gray`, `bg-white`, or hardcoded hex appear in rendered class names; every color comes from a `var(--dpf-*)` token

- [ ] **Step 2: Implement `CapabilityMaturityPanel`**

Use compact rows, not nested cards. Use DPF theme tokens:

```tsx
className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
```

Required columns:

```text
Capability | Portfolio | Score | Target | Confidence | Lifecycle | Productize | Anchor
```

Score should render as:

```text
effectiveMaturity / mvpTargetScore
```

Raw `maturityScore` is shown as muted secondary text only when different from `effectiveMaturity`. When the difference is caused by dependency blocking (spec §10.3 rule 5), the row must render a "blocked by `<dep-name>`" annotation linking to the blocking dependency's row. When the difference is caused by `confidenceGrade === "stale"` decay, the row shows a "stale −1" badge instead.

`Lifecycle` shows `Investment` or `Operational`. `Productize` shows the overlay (`none` rendered as a muted dash; `eligible` / `candidate` / `productized` rendered as distinct theme-token-driven affordances). When `Productize` is `candidate`, the row also surfaces "score change watch" if `productizationStatusChangedAt` is within 14 days of `lastAssessmentAt` (spec §10.4 anti-inflation guard). For slice 1 this affordance is read-only and informational; the governance routing itself ships in the productize-mode follow-on.

- [ ] **Step 3: Load data in portfolio page**

Modify `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` to call `getCapabilityMaturityForPortfolioNode` for the selected root or taxonomy node and pass the rollup into `PortfolioNodeDetail`.

- [ ] **Step 4: Render panel in `PortfolioNodeDetail`**

Render the panel below governance/enrichment context and above product lists so capability gaps are visible before individual products.

- [ ] **Step 5: Run tests**

Run:

```powershell
pnpm --filter web test apps/web/components/portfolio/CapabilityMaturityPanel.test.tsx apps/web/components/portfolio/PortfolioNodeDetail.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/components/portfolio/CapabilityMaturityPanel.tsx apps/web/components/portfolio/CapabilityMaturityPanel.test.tsx apps/web/components/portfolio/PortfolioNodeDetail.tsx "apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx"
git commit -s -m "feat(portfolio): surface capability maturity by taxonomy node"
```

---

## Task 6: Verification and UX Evidence

**Files:**

- Modify only if failures are found.

- [ ] **Step 1: Run focused unit tests**

Run:

```powershell
pnpm --filter @dpf/db test capability-maturity.test.ts
pnpm --filter web test apps/web/lib/maturity/capability-maturity-data.test.ts apps/web/components/portfolio/CapabilityMaturityPanel.test.tsx
pnpm --filter @dpf/db test seed-agent-control-plane-maturity.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
pnpm --filter @dpf/db typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```powershell
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 4: UX verify `/portfolio/foundational`**

Use the running Docker-served app. Log in with `admin@dpf.local` and `ADMIN_PASSWORD` from repo-root `.env` if redirected to `/welcome`.

Verify:

- `/portfolio/foundational` shows the maturity panel.
- Foundational rows include identity, MCP/tool governance, observability/evals/cost, semantic data, spend authority, and kill switch.
- Below-target rows render in investment mode.
- No text overlaps at desktop and mobile widths.
- Theme tokens render correctly in light/dark modes.

- [ ] **Step 5: Commit any verification fixes**

If fixes were needed:

Run `git status --short`, stage only the files changed by the verification fix, then commit:

```powershell
git commit -s -m "fix(portfolio): polish capability maturity surface"
```

---

## Task 7: Backlog Fan-Out After First Slice

**Files:**

- No code files. Use DPF MCP backlog tools when available. **Pre-condition:** the spec §3.2 noted the MCP token was `unauthorized: invalid or expired token` at design time. Before starting this task, run `list_epics` once to confirm the token works in the current session. If it fails, stop and surface a `dpf-mcp-token-refresh` action item rather than writing DB directly; AGENTS.md forbids bypassing MCP scope/token gates with hidden SQL writes.

- [ ] **Step 1: Query live epics**

Use MCP `list_epics` and confirm overlap with:

```text
EP-CAPSULE
EP-COWORKER-RT
EP-MCP
EP-A2A
EP-AI-OPSMAP
EP-BIZ-CAP
EP-BUILD-STUDIO
EP-COST-001
EP-INT-2E7C1A
EP-TAK-3F9A21
EP-WWMD-MCP
```

- [ ] **Step 2: Create or link backlog items for follow-on efforts**

Create only the missing items:

```text
Capability maturity signal capture
Vendor replacement confidence registry
Productize-mode governance queue
Semantic Data Plane spec
Agent Commerce and Spend Authority spec
Cross-Layer Kill Switch spec
Customer overlay maturity scoring spec
```

- [ ] **Step 3: Record execution evidence**

Use MCP `record_execution_evidence` to link:

```text
docs/superpowers/specs/2026-05-21-four-portfolio-agent-control-plane-maturity-design.md
docs/superpowers/plans/2026-05-21-four-portfolio-agent-control-plane-maturity.md
```

Expected: backlog fan-out is traceable without direct DB edits.

---

## Task 8: New Invariants from PR #1001 + PR #1004

This task absorbs the nine new invariants the spec gained after this plan was merged via PR #921:

- PR #1001 (consistency pass): `claimed_overdue` alert (§5.3), `MaturityScoreEvent` audit log (§8.1.A + AC #19), `riskTierRationale` breach-scenario field (§5.2.1), §7.0 mode precedence.
- PR #1004 (UX-audit absorption): count source-of-truth shared projection (§12.1), drill-through invariant (§12.1), portfolio-concentration signal (§12.3), `displayShort` portfolio label variant (§12.4), §12.5 audit-lens assertions.

These extend the modules created in Tasks 1–5 rather than replacing them. Execute Task 8 after Tasks 1–7 land, in the same vertical slice.

**Files (all extensions, no new modules unless noted):**

- Modify: `packages/db/src/capability-maturity.ts` — add `deriveClaimedOverdue`, mode-precedence helper.
- Modify: `packages/db/src/capability-maturity.test.ts` — cover the new derivers and the audit-log invariants.
- Modify: `packages/db/prisma/schema.prisma` — add `MaturityScoreEvent` model + `riskTierRationale` + `displayShort` columns.
- Modify: `packages/db/data/agent_control_plane_maturity_seed.json` — add `riskTierRationale` for every `critical`/`elevated` row.
- Modify: `packages/db/data/portfolio_registry.json` — add `displayShort` for each of the four portfolios.
- Create: `packages/db/src/maturity-score-event.ts` — append-only writer for `MaturityScoreEvent`; the single mutation path that the single writer in `capability-maturity.ts` delegates to on every derived-field change.
- Create: `apps/web/lib/maturity/open-work-projection.ts` — the single named projection consumed by `/workspace`, `/portfolio`, and `/ops` counters per §12.1. **Pre-condition:** look up which existing counter query backs `/workspace` `OPEN WORK = 156` (per audit S2.6) and reuse it; do not invent a fifth projection.
- Modify: `apps/web/lib/maturity/capability-maturity-data.ts` — add portfolio-concentration calculator (per §12.3, > 3× median rule) and consume `open-work-projection`.
- Modify: `apps/web/components/portfolio/CapabilityMaturityPanel.tsx` — enforce §7.0 mode precedence (Investment > Operations, Productize overlay only); render `claimed_overdue` alert; render concentration signal; consume `displayShort` for portfolio labels; every status chip carries a `destinationRoute` prop.
- Create: `apps/web/components/portfolio/__test-helpers__/audit-lens-assertions.ts` — reusable test matchers for the six §12.5 lenses (`functionality`, `data-completeness`, `confidence-signal`, `object-oriented-ux`, `literal-copy`, `millers-law`).

---

- [ ] **Step 1: Add `claimed_overdue` deriver + alert surface**

Per spec §5.3, a row with `confidenceGrade = claimed` for > 60 days raises `claimedOverdue = true`. This does NOT demote `effectiveMaturity` — it surfaces an alert and enqueues a re-assessment task.

Add `deriveClaimedOverdue({ now, confidenceGrade, lastAssessmentAt }): boolean` to `packages/db/src/capability-maturity.ts`. Cover three cases in `capability-maturity.test.ts`: claimed at 59d → false, claimed at 61d → true, evidenced at 90d → false (decay path, not overdue path).

In `CapabilityMaturityPanel.tsx`, render an `claimed-overdue` chip that drills into a filtered re-assessment task queue per the §12.1 drill-through invariant.

Acceptance: `deriveClaimedOverdue` returns the expected boolean for the three cases; rendering the panel for an overdue row shows the chip with a non-null destination route.

- [ ] **Step 2: Add `MaturityScoreEvent` immutable audit log**

Per AC #19 + §8.1.A, every mutation to `maturityScore`, `riskTier`, `confidenceGrade`, `productizationStatus`, `dependsOn`, or `strategicOwnership` emits an append-only event row. This is what makes AC #17 (anti-inflation guard, 14-day window around `candidate` transitions) enforceable.

Add the Prisma model to `schema.prisma`:

```prisma
model MaturityScoreEvent {
  id                    String    @id @default(cuid())
  capabilityId          String
  field                 String    // "maturityScore" | "riskTier" | "confidenceGrade" | …
  previousValue         String?
  newValue              String
  actor                 String    // human id, coworker id, or governed-automation id
  evidenceLinks         Json      @default("[]")
  governanceReviewId    String?
  transitionContextRef  String?   // e.g. productizationStatus=candidate transition this is checked against
  createdAt             DateTime  @default(now())

  capability            CapabilityMaturityAssessment @relation(fields: [capabilityId], references: [id])

  @@index([capabilityId, createdAt])
  @@index([field, createdAt])
}
```

Create `packages/db/src/maturity-score-event.ts` exposing `recordMaturityScoreEvent(...)`. The `capability-maturity.ts` writer calls this on every mutation. Reject any direct INSERT/UPDATE on the model from other paths via a Prisma client wrapper or, at minimum, a documented invariant + lint rule.

Acceptance: `recordMaturityScoreEvent` is the only code path that writes the model (test asserts via grep / `findMatchingCallSites`); mutating `maturityScore` in the seed helper emits an event; updating an event row throws.

- [ ] **Step 3: Add `riskTierRationale` field + one-third critical-share writer warning**

Per spec §5.2.1, `critical` and `elevated` capabilities require a one-sentence breach-scenario rationale; the writer warns when the `critical` share of the catalog crosses ~one-third without explicit kernel-principle justification.

Add `riskTierRationale String?` to the capability assessment model in `schema.prisma` (nullable; `standard`/`low` may be set without rationale). Add `kernelPrincipleJustification String[]` for the catalog-share override.

In `packages/db/data/agent_control_plane_maturity_seed.json`, add `riskTierRationale` for every `critical` and `elevated` row from spec §6.

In `capability-maturity.ts`, add `validateRiskTierAuthoring(rows)` that returns warnings when (a) any `critical`/`elevated` row has no `riskTierRationale`, (b) `critical` share > 33% of catalog without `kernelPrincipleJustification` on the excess rows. Seed test asserts both warnings are empty for the canonical bootstrap.

Acceptance: every `critical`/`elevated` seed row has a citable breach scenario; writer warnings fire on a synthetic catalog with 5/10 `critical` rows.

- [ ] **Step 4: Enforce §7.0 mode precedence in the panel**

Per spec §7.0, modes have fixed precedence: Investment > Operations, Productize as Operations-only overlay. The gate reads `effectiveMaturity`, not raw `maturityScore`.

In `CapabilityMaturityPanel.tsx`, add a `resolveRenderMode(row): "investment" | "operations" | "productize-overlay"` helper. A row with `productizationStatus = candidate` but `effectiveMaturity < mvpTargetScore` resolves to `investment` (with a dep-blocked annotation), never `productize-overlay`.

Tests in `CapabilityMaturityPanel.test.tsx`: a row qualifying for productize on raw score but blocked by a dep at score 2 renders in investment mode with the dep-blocked annotation, not the productize affordance.

Acceptance: cannot reach productize-overlay rendering while any dependency floor pulls effective maturity below target.

- [ ] **Step 5: Wire the single named "open work" projection (`open-work-projection.ts`)**

Per spec §12.1, every numeric surface on `/workspace`, `/portfolio`, and `/ops` reads from one named projection. The 2026-05-20 audit S2.6 caught three counters disagreeing (121 vs 156 vs 440); the maturity dashboard must not introduce a fourth.

Before creating `apps/web/lib/maturity/open-work-projection.ts`, find the existing query that backs `/workspace` `OPEN WORK = 156`. Reuse or wrap it; never spawn a new query. If the existing query is wrong, file BI-CANDIDATE-S2-08 from the audit rather than papering over with a fifth number.

The projection exports: `getOpenWorkCount({ scope: "workspace" | "portfolio" | "ops", portfolioId?: string }): Promise<number>`. Tests assert all three scopes hit the same underlying query and never produce divergent counts for the same scope on the same DB state.

Acceptance: `/workspace` and `/portfolio` rendered against the same seeded DB show the same `OPEN WORK` count.

- [ ] **Step 6: Add portfolio-concentration signal (>3× median)**

Per spec §12.3, if one of the four portfolio roots holds > 3× the median product / capability / epic count of the other three, render an investment-mode signal on `/portfolio` root with §7.1 framing.

Add `calculatePortfolioConcentration(counts: Record<PortfolioId, number>): { skewedPortfolio: PortfolioId, ratio: number } | null` to `capability-maturity-data.ts`. Render result in `CapabilityMaturityPanel.tsx` when on portfolio-root scope.

Tests cover: balanced (10/10/10/10) → null; skewed (117/4/5/6) → returns `products_and_services_sold` with ratio ≈ 23x.

Acceptance: against the live install state (per audit: 117 products in one of four), the concentration signal renders with the §7.1 investment framing.

- [ ] **Step 7: Add audit-lens test helpers (§12.5)**

Per spec §12.5, every maturity-surface PR satisfies six AGT-906-derived lenses before merge. Until AGT-906 ships, these are manual; this step provides reusable test matchers so the assertions appear in CI rather than in review comments.

Create `apps/web/components/portfolio/__test-helpers__/audit-lens-assertions.ts` exporting:

```ts
expectFunctionality(rendered)       // every chip / badge / button has a non-null destination
expectDataCompleteness(rendered)    // no field reads "Not assigned" / "Unknown" / "—" when source-of-truth count says data exists
expectConfidenceSignal(rendered)    // no system prompts or [tool-trace] strings leak into operator-visible content
expectObjectOrientedUx(rendered)    // every numeric surface has an aria-describedby pointing at its source query
expectLiteralCopy(rendered)         // labels match a curated plain-language allowlist, not schema vocabulary
expectMillersLaw(rendered)          // at most two header tiers above first content row
```

Use these in `CapabilityMaturityPanel.test.tsx`. Failures in any of the six block CI.

Acceptance: panel renders against canonical seed data and passes all six matchers in CI.

- [ ] **Step 8: Add `displayShort` portfolio label variant + AppRail consumer**

Per spec §12.4, portfolio root names render in full at every supported viewport width; constrained rails consume a `displayShort` variant rather than CSS truncating to "Products and Services S…".

Add `displayShort String?` to the `Portfolio` model in `schema.prisma`. Backfill in `packages/db/data/portfolio_registry.json` for all four portfolios — e.g. `"foundational" → "Foundational"`, `"manufacturing_and_delivery" → "Manufacturing"`, `"for_employees" → "People"`, `"products_and_services_sold" → "Sold"`. Exact short forms are an §17 #11 open decision; pick the seed values with the operator and record them as the answer to that decision when this step lands.

Update the AppRail and inner-rail consumers (find via `grep -r "products_and_services_sold" apps/web/components`) to prefer `displayShort` when present and width is constrained. CSS truncation of the long form remains forbidden.

Acceptance: rendering `/portfolio` at the audit-observed AppRail width shows "Sold" (or the operator-chosen short form), never "Products and Services S…".

---

After Task 8, re-run the Final Verification Gate. The full test suite must pass before push.

## Final Verification Gate

Before claiming the slice complete, run both focused and full test gates. The focused tests in Task 6 are not enough by themselves; the full vitest suites must pass locally before push, because the pre-commit hook only runs typecheck and PR CI breaks for every other contributor otherwise.

```powershell
git status --short --branch
git diff --check HEAD~1 HEAD

# Focused tests for this slice (fast feedback)
pnpm --filter @dpf/db test capability-maturity.test.ts
pnpm --filter web test apps/web/lib/maturity/capability-maturity-data.test.ts apps/web/components/portfolio/CapabilityMaturityPanel.test.tsx
pnpm --filter @dpf/db test seed-agent-control-plane-maturity.test.ts

# Full test suite — REQUIRED before push
pnpm --filter web test
pnpm --filter @dpf/db test

pnpm --filter web typecheck
pnpm --filter @dpf/db typecheck
pnpm --filter web build
```

For UI work, also capture UX evidence for `/portfolio/foundational` against the Docker-served app (screenshots of investment-mode row, operations-mode row, blocked-by-dep annotation, and stale badge). The screenshots attach to the PR description so reviewers see the spec contract is met without re-driving the portal.

## Execution Choice

Plan complete once this file is reviewed. Recommended execution mode is **parallel workers where the active runtime explicitly supports them**; otherwise run the same tasks sequentially in one feature branch. Each task owns a narrow write set, commits independently, and runs its local verification before the next task starts:

1. Domain logic
2. Schema + migration
3. Seed data
4. Read model
5. UI
6. Verification/fixes
7. MCP backlog fan-out
8. New invariants from PR #1001 + PR #1004 (claimed_overdue, MaturityScoreEvent log, riskTierRationale, mode precedence, open-work projection, concentration signal, audit-lens assertions, displayShort)
