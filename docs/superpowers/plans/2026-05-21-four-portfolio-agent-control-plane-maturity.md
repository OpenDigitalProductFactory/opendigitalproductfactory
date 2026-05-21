# Four-Portfolio Agent Control Plane Maturity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first governed vertical slice of the four-portfolio agent-control-plane maturity surface: canonical scoring logic, schema foundation, seed assessments, portfolio read model, and read-only portfolio UI.

**Architecture:** The first slice keeps the four-portfolio taxonomy as the anchor and adds a maturity assessment companion model rather than overloading `TaxonomyNode`. A single domain module computes `mvpTargetScore`, `confidenceGrade`, dependency-bounded `effectiveMaturity`, and DAG validation; UI and reports read those derived values. The slice is read-only in the portal: no score editing, hive-mind mutation, productization transitions, or backlog creation yet.

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

- `apps/web/lib/maturity/capability-maturity.ts` — domain constants, enums, score derivation, effective maturity, confidence decay, DAG validation.
- `apps/web/lib/maturity/capability-maturity.test.ts` — unit tests for score derivation, dependency cascade, stale decay, cycle rejection.
- `apps/web/lib/maturity/capability-maturity-data.ts` — Prisma-backed read model for portfolio/taxonomy maturity rollups.
- `apps/web/lib/maturity/capability-maturity-data.test.ts` — mocked Prisma-shape tests for rollup behavior.
- `apps/web/components/portfolio/CapabilityMaturityPanel.tsx` — read-only maturity summary for a selected portfolio/taxonomy node.
- `apps/web/components/portfolio/CapabilityMaturityPanel.test.tsx` — render tests for investment, operations, and productize modes.
- `packages/db/src/seed-agent-control-plane-maturity.ts` — idempotent seed helper for initial canonical assessments.
- `packages/db/src/seed-agent-control-plane-maturity.test.ts` — seed-shape tests for canonical records.
- `packages/db/data/agent_control_plane_maturity_seed.json` — canonical initial assessments from the spec.

**Modify**

- `packages/db/prisma/schema.prisma` — add maturity assessment companion models and relations.
- `packages/db/src/seed.ts` — call the new seed helper.
- `apps/web/components/portfolio/PortfolioNodeDetail.tsx` — render the maturity panel in the selected taxonomy node view.
- `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` — load maturity rollup data for the selected node.

**Generated**

- Prisma migration directory created by `pnpm --filter @dpf/db exec prisma migrate dev --name agent_control_plane_maturity`

---

## Task 1: Add Maturity Domain Logic

**Files:**

- Create: `apps/web/lib/maturity/capability-maturity.ts`
- Create: `apps/web/lib/maturity/capability-maturity.test.ts`

- [ ] **Step 1: Write failing tests for derived targets, confidence decay, effective maturity, and cycle detection**

Create `apps/web/lib/maturity/capability-maturity.test.ts`:

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

  it("marks stale when newest evidence is older than 30 days", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: new Date("2026-04-20T12:00:00.000Z"),
      lastGovernanceReviewAt: new Date("2026-05-01T12:00:00.000Z"),
      hasContinuousEvidence: true,
    })).toBe("stale");
  });

  it("returns verified when governance review and evidence are fresh", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");

    expect(deriveConfidenceGrade({
      now,
      evidenceFreshnessAt: new Date("2026-05-20T12:00:00.000Z"),
      lastGovernanceReviewAt: new Date("2026-05-10T12:00:00.000Z"),
      hasContinuousEvidence: true,
    })).toBe("verified");
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

  it("rejects dependency cycles", () => {
    expect(() => validateCapabilityDependencyGraph([
      { id: "runtime", dependsOnIds: ["gateway"] },
      { id: "gateway", dependsOnIds: ["runtime"] },
    ])).toThrow(/cycle/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter web test apps/web/lib/maturity/capability-maturity.test.ts
```

Expected: FAIL because `apps/web/lib/maturity/capability-maturity.ts` does not exist.

- [ ] **Step 3: Implement the domain module**

Create `apps/web/lib/maturity/capability-maturity.ts`:

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
  const evidenceAgeDays = input.evidenceFreshnessAt
    ? Math.floor((input.now.getTime() - input.evidenceFreshnessAt.getTime()) / DAY_MS)
    : Number.POSITIVE_INFINITY;
  const reviewAgeDays = input.lastGovernanceReviewAt
    ? Math.floor((input.now.getTime() - input.lastGovernanceReviewAt.getTime()) / DAY_MS)
    : Number.POSITIVE_INFINITY;

  if (evidenceAgeDays > 30 || reviewAgeDays > 90) return "stale";
  if (reviewAgeDays <= 30 && input.hasContinuousEvidence) return "verified";
  if (evidenceAgeDays <= 30 && input.hasContinuousEvidence) return "evidenced";
  return "claimed";
}

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

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
pnpm --filter web test apps/web/lib/maturity/capability-maturity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/maturity/capability-maturity.ts apps/web/lib/maturity/capability-maturity.test.ts
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
  existingPrimitives          Json                           @default("[]")
  maturityGaps                Json                           @default("[]")
  evidenceSources             Json                           @default("[]")
  hiveMindSignals             Json                           @default("[]")
  kernelPrinciples            String[]                       @default([])
  operationalSurface          String?
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
    "taxonomyNodePath": "foundational/platform-services/identity-and-access-platform",
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
    "taxonomyNodePath": "foundational/platform-services/api-management-platform",
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
    "taxonomyNodePath": "manufacturing_and_delivery/build-and-integrate/build-studio",
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
    "taxonomyNodePath": "manufacturing_and_delivery/build-and-integrate/build-studio",
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
    "taxonomyNodePath": "manufacturing_and_delivery/build-and-integrate/evidence",
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
    "taxonomyNodePath": "for_employees/workforce-productivity/ai-coworkers",
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
    "taxonomyNodePath": "foundational/platform-services/observability-platform",
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
    "taxonomyNodePath": "foundational/data-and-knowledge/semantic-data-plane",
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
    "taxonomyNodePath": "foundational/platform-services/finance-and-billing-platform",
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
    "taxonomyNodePath": "products_and_services_sold/platform-products/agent-control-plane",
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
    "taxonomyNodePath": "foundational/platform-services/security-and-control-plane",
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

- [ ] **Step 3: Implement idempotent seed helper**

Create `packages/db/src/seed-agent-control-plane-maturity.ts` with an exported function:

```ts
import type { PrismaClient } from "@prisma/client";
import seedRows from "../data/agent_control_plane_maturity_seed.json";

type SeedRow = (typeof seedRows)[number];

export async function seedAgentControlPlaneMaturity(prisma: PrismaClient): Promise<void> {
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

Create `apps/web/lib/maturity/capability-maturity-data.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getCapabilityMaturityForPortfolioNode } from "./capability-maturity-data";

describe("getCapabilityMaturityForPortfolioNode", () => {
  it("derives targets, effective maturity, and display mode", async () => {
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
            productizationStatus: "not_eligible",
            dependencies: [{ dependency: { id: "a2", maturityScore: 2, confidenceGrade: "evidenced", dependencies: [] } }],
          },
        ]),
      },
    };

    const result = await getCapabilityMaturityForPortfolioNode({
      prisma,
      portfolioId: "port-1",
      taxonomyNodeId: "tax-1",
      now: new Date("2026-05-21T12:00:00.000Z"),
    });

    expect(result.summary.total).toBe(1);
    expect(result.summary.belowTarget).toBe(1);
    expect(result.rows[0]).toMatchObject({
      assessmentId: "ACPM-RUNTIME-CONTROL",
      mvpTargetScore: 4,
      effectiveMaturity: 2,
      mode: "investment",
    });
  });
});
```

- [ ] **Step 2: Implement data reader**

Implement:

```ts
export async function getCapabilityMaturityForPortfolioNode(input: {
  portfolioId: string;
  taxonomyNodeId?: string | null;
  now?: Date;
}): Promise<CapabilityMaturityRollup>
```

The function must:

- fetch assessments scoped to the selected portfolio,
- include dependencies,
- derive `mvpTargetScore`,
- derive `confidenceGrade`,
- derive `effectiveMaturity`,
- mark mode as `productize` when `productizationStatus` is `eligible` or `candidate`,
- mark mode as `operations` when `effectiveMaturity >= mvpTargetScore`,
- otherwise mark mode as `investment`.

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

- investment rows show "Gap"
- operations rows show "Operational"
- productize rows show "Productize"
- stale rows show "Stale"
- no hardcoded Tailwind color classes like `text-gray`, `bg-white`, or hardcoded hex appear in rendered class names

- [ ] **Step 2: Implement `CapabilityMaturityPanel`**

Use compact rows, not nested cards. Use DPF theme tokens:

```tsx
className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
```

Required columns:

```text
Capability | Portfolio | Score | Target | Confidence | Mode | Anchor
```

Score should render as:

```text
effectiveMaturity / mvpTargetScore
```

Raw `maturityScore` may be shown as muted secondary text only when different from `effectiveMaturity`.

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
pnpm --filter web test apps/web/lib/maturity/capability-maturity.test.ts apps/web/lib/maturity/capability-maturity-data.test.ts apps/web/components/portfolio/CapabilityMaturityPanel.test.tsx
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

- No code files. Use DPF MCP backlog tools when available; if MCP token is unavailable, stop and report required token state rather than writing DB directly.

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

## Final Verification Gate

Before claiming the slice complete:

```powershell
git status --short --branch
git diff --check HEAD~1 HEAD
pnpm --filter web test apps/web/lib/maturity/capability-maturity.test.ts apps/web/lib/maturity/capability-maturity-data.test.ts apps/web/components/portfolio/CapabilityMaturityPanel.test.tsx
pnpm --filter @dpf/db test seed-agent-control-plane-maturity.test.ts
pnpm --filter web typecheck
pnpm --filter @dpf/db typecheck
pnpm --filter web build
```

For UI work, also capture UX evidence for `/portfolio/foundational` against the Docker-served app.

## Execution Choice

Plan complete once this file is reviewed. Recommended execution mode is **Subagent-Driven** with one worker per task:

1. Domain logic
2. Schema + migration
3. Seed data
4. Read model
5. UI
6. Verification/fixes
7. MCP backlog fan-out
