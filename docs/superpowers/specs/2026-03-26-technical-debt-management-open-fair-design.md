# EP-TECHDEBT-001: Technical Debt Management with Open FAIR Risk Analysis

**Status:** Draft (2026-03-26)
**Predecessor:** EP-FEEDBACK-001 (Platform Feedback Loop), EP-GRC-001 (Compliance Engine Core), EP-GRC-ONBOARD (Regulation & Standards Onboarding)

## Problem Statement

The platform captures *friction* through `ImprovementProposal` and *compliance risk* through `RiskAssessment`, but technical debt — the accumulated cost of expedient decisions that compound over time — has no formal model, no quantitative risk framework, and no connection to the governance pipeline. Three gaps:

1. **No debt classification or lifecycle.** `ImprovementProposal` categories (`ux_friction`, `missing_feature`, `performance`, `accessibility`, `security`, `process`) describe symptoms, not root causes. There is no way to distinguish deliberate debt (conscious trade-offs with known interest) from accidental debt (discovered after the fact), nor to track debt *accrual* — the compounding cost of deferral. A developer who notices a stale dependency and one who identifies an architectural coupling bottleneck both file the same "improvement proposal," losing the structural information needed to prioritize remediation.

2. **No quantitative risk framework for debt.** The existing `RiskAssessment` model uses qualitative scales (`likelihood`: rare→almost-certain, `severity`: negligible→catastrophic) inherited from traditional GRC. These scales work for compliance risks with known regulatory consequences but fail for technical debt where the "loss" is developer productivity, deployment velocity, or blast radius of a breaking change. The platform needs a risk taxonomy purpose-built for technical debt — one that separates *threat event frequency* (how often the debt causes pain) from *loss magnitude* (how bad it is when it does).

3. **No automated debt detection.** Agents can `propose_improvement` when they observe friction in conversation, but nobody is systematically scanning for dependency staleness, TODO/FIXME accumulation, migration drift, configuration mismatches (e.g., `.npmrc` containing pnpm-specific `node-linker=hoisted` that npm warns about), duplicated dependencies, or missing test coverage for critical paths. The platform generates debt signals constantly but has no sensor network to capture them.

### What Already Exists

- **ImprovementProposal** — friction capture with governance pipeline (proposed → verified), agent attribution, backlog integration, Hive Mind contribution tracking
- **RiskAssessment** — qualitative risk scoring (likelihood x severity = inherentRisk), linked to Controls via `RiskControl` join table, linked to `ComplianceIncident`
- **Compliance Engine** — full GRC domain: Regulation, Obligation, Control, Evidence, Audit, Finding, CorrectiveAction, ComplianceSnapshot
- **Regulation sourceType extension** — `"framework"` type enables onboarding Open FAIR as a formal framework
- **Portfolio taxonomy** — "Manage Enterprise Risk, Compliance, Remediation, and Resiliency" category with "Risk Management" and "Governance, Risk and Compliance" subcategories
- **Agent capabilities** — Portfolio Manager agent already has "technical debt" in its capability description ("Analyzes portfolio for duplication, technical debt, underperformance")
- **APQC taxonomy** — risk management process areas mapped to portfolio structure

### IT4IT Alignment

Technical debt management spans multiple IT4IT value streams:

| Value Stream | Section | Debt Relevance |
|---|---|---|
| **Evaluate** | ss5.1 | Portfolio-level debt assessment — which products carry the most debt? |
| **Explore** | ss5.2 | Backlog prioritization — debt items compete with features for capacity |
| **Integrate** | ss5.3 | Build toolchain debt — dependency health, CI/CD pipeline reliability |
| **Deploy** | ss5.4 | Deployment risk — debt that increases deployment failure probability |
| **Operate** | ss5.7 | Operational debt — monitoring gaps, runbook staleness, incident recurrence |

### Open FAIR Alignment

The Open Group FAIR (Factor Analysis of Information Risk) standard (O-RA, O-RT) provides the quantitative risk taxonomy. FAIR decomposes **Risk** into two top-level factors:

```
Risk
 +-- Loss Event Frequency (LEF)
 |    +-- Threat Event Frequency (TEF)
 |    |    +-- Contact Frequency
 |    |    +-- Probability of Action
 |    +-- Vulnerability (Vuln)
 |         +-- Threat Capability
 |         +-- Resistance Strength
 +-- Loss Magnitude (LM)
      +-- Primary Loss
      |    +-- Productivity Loss
      |    +-- Response Cost
      |    +-- Replacement Cost
      +-- Secondary Loss
           +-- Secondary LEF (reputational, regulatory)
           +-- Secondary LM
```

For technical debt, FAIR maps as follows:

| FAIR Factor | Technical Debt Interpretation | Example |
|---|---|---|
| **Threat Event Frequency** | How often does the debt cause a problem? | Stale dependency: every `npm install` warns; architectural coupling: every feature touches 5+ files |
| **Contact Frequency** | How often do developers/processes encounter the debt? | Daily (build warnings), weekly (deployment friction), quarterly (upgrade cycles) |
| **Probability of Action** | Given contact, how likely is a negative outcome? | Stale dep: low (just warnings today), but increases over time as CVEs accumulate |
| **Vulnerability** | How exposed is the system to the threat? | Single point of failure vs. isolated module; blast radius of change |
| **Resistance Strength** | What mitigations exist? | Test coverage, feature flags, rollback capability, monitoring |
| **Productivity Loss** | Developer time lost to working around the debt | Extra build time, manual workarounds, onboarding confusion |
| **Response Cost** | Cost to remediate when the debt triggers an incident | Emergency patching, rollback, customer communication |
| **Replacement Cost** | Cost to properly retire the debt | Refactoring effort, migration work, testing |
| **Secondary Loss** | Downstream consequences | Compliance violations, customer churn, recruitment difficulty |

---

## Design

### Section 1: TechnicalDebtItem Model

A new model that formalizes debt as a first-class entity, distinct from improvement proposals (which capture symptoms) and risk assessments (which capture compliance risks).

```prisma
model TechnicalDebtItem {
  id                    String    @id @default(cuid())
  debtId                String    @unique              // "TD-XXXXXXXX"
  title                 String
  description           String

  // --- Classification ---
  debtType              String                          // deliberate | accidental | bit-rot | environmental
  category              String                          // dependency | architecture | code | infrastructure | test | documentation | configuration

  // --- FAIR Risk Factors (Section 2) ---
  threatEventFrequency  String    @default("moderate")  // negligible | low | moderate | high | very-high
  contactFrequency      String    @default("weekly")    // daily | weekly | monthly | quarterly | annually
  probabilityOfAction   String    @default("moderate")  // negligible | low | moderate | high | very-high
  vulnerability         String    @default("moderate")  // negligible | low | moderate | high | very-high
  resistanceStrength    String    @default("moderate")  // very-low | low | moderate | high | very-high
  productivityLoss      String    @default("low")       // negligible | low | moderate | high | very-high
  responseCost          String    @default("moderate")  // negligible | low | moderate | high | very-high
  replacementCost       String    @default("moderate")  // negligible | low | moderate | high | very-high
  secondaryLoss         String    @default("negligible") // negligible | low | moderate | high | very-high

  // --- Computed Scores (derived from FAIR factors) ---
  lossEventFrequency    String    @default("moderate")  // Computed: f(TEF, Vulnerability)
  lossMagnitude         String    @default("moderate")  // Computed: f(Productivity, Response, Replacement, Secondary)
  riskScore             String    @default("medium")    // Computed: f(LEF, LM) -> low | medium | high | critical
  riskScoreNumeric      Float    @default(0)            // 0.0-10.0 for sorting and trending

  // --- Accrual Tracking ---
  accruedAt             DateTime                        // When was the debt first incurred?
  discoveredAt          DateTime  @default(now())       // When was it identified?
  lastAssessedAt        DateTime  @default(now())       // When were FAIR factors last evaluated?
  interestRate          String    @default("stable")    // decreasing | stable | increasing | accelerating

  // --- Ownership ---
  productId             String?                         // Which DigitalProduct carries this debt?
  portfolioId           String?                         // Which portfolio segment?
  ownerEmployeeId       String?                         // Accountable person
  agentId               String?                         // Agent that detected it

  // --- Evidence ---
  evidence              String?                         // Observable symptoms, metrics, warnings
  affectedFiles         String?                         // Comma-separated file paths or patterns
  affectedComponents    String?                         // Comma-separated component/package names

  // --- Governance Pipeline ---
  status                String    @default("identified") // identified | assessed | accepted | scheduled | in-remediation | remediated | verified | wont-fix
  improvementProposalId String?                         // Link to originating ImprovementProposal if any
  backlogItemId         String?                         // Link to remediation backlog item
  riskAssessmentId      String?                         // Link to formal RiskAssessment if escalated

  // --- Review ---
  assessedById          String?
  assessedAt            DateTime?
  acceptedById          String?
  acceptedAt            DateTime?
  remediatedAt          DateTime?
  verifiedAt            DateTime?
  wontFixReason         String?

  // --- Audit ---
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  // --- Relations ---
  product               DigitalProduct?  @relation(fields: [productId], references: [id])
  portfolio             Portfolio?       @relation(fields: [portfolioId], references: [id])
  ownerEmployee         EmployeeProfile? @relation("DebtOwner", fields: [ownerEmployeeId], references: [id])
  assessedBy            EmployeeProfile? @relation("DebtAssessor", fields: [assessedById], references: [id])

  @@index([status])
  @@index([riskScore])
  @@index([riskScoreNumeric])
  @@index([category])
  @@index([productId])
  @@index([portfolioId])
  @@index([ownerEmployeeId])
  @@index([interestRate])
}
```

**ID format:** `TD-XXXXXXXX` (8-char hex, same pattern as `RA-`, `INC-`, etc.)

**Governance lifecycle:**

```
identified (agent or human discovers debt)
  |
assessed (FAIR factors evaluated, risk score computed)
  |
accepted (product owner acknowledges and accepts the debt position)
  |--- wont-fix (deliberate acceptance with documented reason)
  |
scheduled (remediation work planned, backlog item created)
  |
in-remediation (active work underway)
  |
remediated (fix applied)
  |
verified (debt is confirmed eliminated, no regression)
```

---

### Section 2: Open FAIR Risk Computation Engine

A pure function that computes risk scores from FAIR input factors. No database dependency — can be used in forms, agents, and batch assessment.

```typescript
// lib/fair-risk.ts

/** FAIR 5-point ordinal scale used across all factors */
export const FAIR_SCALE = ["negligible", "low", "moderate", "high", "very-high"] as const;
export type FairLevel = typeof FAIR_SCALE[number];

/** Resistance uses inverted semantics (very-low = bad) */
export const RESISTANCE_SCALE = ["very-low", "low", "moderate", "high", "very-high"] as const;
export type ResistanceLevel = typeof RESISTANCE_SCALE[number];

/** Contact frequency — how often developers/processes encounter the debt */
export const CONTACT_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "annually"] as const;
export type ContactFrequency = typeof CONTACT_FREQUENCIES[number];

/** Interest rate — is the debt getting worse over time? */
export const INTEREST_RATES = ["decreasing", "stable", "increasing", "accelerating"] as const;
export type InterestRate = typeof INTEREST_RATES[number];

/** Debt type classification */
export const DEBT_TYPES = ["deliberate", "accidental", "bit-rot", "environmental"] as const;
export type DebtType = typeof DEBT_TYPES[number];

/** Debt category */
export const DEBT_CATEGORIES = [
  "dependency",      // Stale packages, version drift, duplicates
  "architecture",    // Coupling, missing abstractions, scaling limits
  "code",            // Code smells, duplication, complexity
  "infrastructure",  // Build toolchain, CI/CD, container config
  "test",            // Missing coverage, flaky tests, slow suites
  "documentation",   // Stale docs, missing runbooks, onboarding gaps
  "configuration",   // Config mismatches, env drift, secret sprawl
] as const;
export type DebtCategory = typeof DEBT_CATEGORIES[number];

/** Final risk level */
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = typeof RISK_LEVELS[number];

type FairInput = {
  threatEventFrequency: FairLevel;
  contactFrequency: ContactFrequency;
  probabilityOfAction: FairLevel;
  vulnerability: FairLevel;
  resistanceStrength: ResistanceLevel;
  productivityLoss: FairLevel;
  responseCost: FairLevel;
  replacementCost: FairLevel;
  secondaryLoss: FairLevel;
  interestRate: InterestRate;
};

type FairOutput = {
  lossEventFrequency: FairLevel;
  lossMagnitude: FairLevel;
  riskScore: RiskLevel;
  riskScoreNumeric: number;   // 0.0 - 10.0
};

const FAIR_ORDINAL: Record<string, number> = {
  "negligible": 0, "low": 1, "moderate": 2, "high": 3, "very-high": 4,
  "very-low": 0, // resistance scale
};

const CONTACT_ORDINAL: Record<string, number> = {
  "annually": 0, "quarterly": 1, "monthly": 2, "weekly": 3, "daily": 4,
};

const INTEREST_MULTIPLIER: Record<string, number> = {
  "decreasing": 0.8, "stable": 1.0, "increasing": 1.2, "accelerating": 1.5,
};

/**
 * Compute FAIR risk scores from input factors.
 *
 * Open FAIR decomposition:
 *   LEF = f(TEF, Vulnerability)
 *   TEF = f(Contact Frequency, Probability of Action)
 *   Vulnerability = f(Threat Capability [derived from TEF], Resistance Strength [inverted])
 *   LM = f(Productivity, Response, Replacement, Secondary)
 *   Risk = f(LEF, LM) * Interest Rate multiplier
 */
export function computeFairRisk(input: FairInput): FairOutput {
  const tef = FAIR_ORDINAL[input.threatEventFrequency];
  const contact = CONTACT_ORDINAL[input.contactFrequency];
  const poa = FAIR_ORDINAL[input.probabilityOfAction];
  const vuln = FAIR_ORDINAL[input.vulnerability];
  const resist = FAIR_ORDINAL[input.resistanceStrength];

  // TEF adjusted by contact frequency and probability of action
  const tefAdjusted = (tef + contact * 0.5 + poa) / 2.5; // Normalized 0-4

  // Vulnerability adjusted by resistance (inverted: high resistance = low vulnerability)
  const resistInverted = 4 - resist; // very-high resistance -> 0, very-low -> 4
  const vulnAdjusted = (vuln + resistInverted) / 2; // Normalized 0-4

  // Loss Event Frequency = TEF * Vulnerability (geometric mean)
  const lefRaw = Math.sqrt(tefAdjusted * vulnAdjusted);

  // Loss Magnitude = weighted combination of four loss types
  const prod = FAIR_ORDINAL[input.productivityLoss];
  const resp = FAIR_ORDINAL[input.responseCost];
  const repl = FAIR_ORDINAL[input.replacementCost];
  const sec = FAIR_ORDINAL[input.secondaryLoss];
  const lmRaw = (prod * 0.35 + resp * 0.25 + repl * 0.25 + sec * 0.15); // Weighted 0-4

  // Risk = LEF * LM, adjusted by interest rate
  const interestMult = INTEREST_MULTIPLIER[input.interestRate];
  const riskRaw = Math.sqrt(lefRaw * lmRaw) * interestMult; // Geometric mean, 0-4+

  // Normalize to 0-10 scale
  const riskNumeric = Math.min(10, (riskRaw / 4) * 10);

  return {
    lossEventFrequency: ordinalToFairLevel(lefRaw),
    lossMagnitude: ordinalToFairLevel(lmRaw),
    riskScore: numericToRiskLevel(riskNumeric),
    riskScoreNumeric: Math.round(riskNumeric * 10) / 10,
  };
}

function ordinalToFairLevel(value: number): FairLevel {
  if (value < 0.8) return "negligible";
  if (value < 1.6) return "low";
  if (value < 2.4) return "moderate";
  if (value < 3.2) return "high";
  return "very-high";
}

function numericToRiskLevel(value: number): RiskLevel {
  if (value < 2.5) return "low";
  if (value < 5.0) return "medium";
  if (value < 7.5) return "high";
  return "critical";
}
```

**Why geometric mean?** FAIR uses multiplicative composition — a debt item with very high frequency but negligible magnitude should not score the same as one with moderate frequency and moderate magnitude. The geometric mean respects the principle that risk requires BOTH frequency AND magnitude to be material.

**Interest rate multiplier:** Unique to technical debt (not in standard FAIR). Debt that is *accelerating* — e.g., a dependency drifting further behind with each release — has compounding risk that static FAIR doesn't capture.

---

### Section 3: Debt Classification Taxonomy

Four debt types, each with distinct risk profiles and remediation strategies:

| Type | Definition | Example | Default Interest Rate |
|---|---|---|---|
| **Deliberate** | Conscious decision to take a shortcut, with known consequences | "Ship without rate limiting; add in v2" | stable |
| **Accidental** | Debt discovered after the fact, unintentional | Race condition in concurrent builds found during load test | increasing |
| **Bit-rot** | Previously good code that degraded over time | Test suite that was comprehensive at v1 but covers 40% of v3 | increasing |
| **Environmental** | Debt caused by external ecosystem changes | pnpm config in `.npmrc` that npm now warns about; dependency EOL | accelerating |

Seven debt categories mapped to IT4IT value streams:

| Category | Primary Value Stream | Detection Method |
|---|---|---|
| **dependency** | Integrate (ss5.3) | `npm audit`, version drift analysis, duplicate detection |
| **architecture** | Evaluate (ss5.1) | Coupling analysis, change impact radius, circular dependencies |
| **code** | Integrate (ss5.3) | Linting rules, complexity metrics, duplication detection |
| **infrastructure** | Deploy (ss5.4) | Build time trending, container size, CI reliability |
| **test** | Integrate (ss5.3) | Coverage gaps, flaky test rate, test execution time |
| **documentation** | Operate (ss5.7) | Stale doc detection, missing runbooks, onboarding friction |
| **configuration** | Deploy (ss5.4) | Config drift detection, env parity checks, secret rotation |

---

### Section 4: ImprovementProposal Extension

Add a field linking improvement proposals to technical debt items when the friction is debt-related:

```prisma
// Addition to ImprovementProposal model
model ImprovementProposal {
  // ... existing fields ...
  technicalDebtItemId   String?   // Link when this improvement is debt-related
}
```

New category values for ImprovementProposal:

```typescript
// Extend existing categories
export const IMPROVEMENT_CATEGORIES = [
  "ux_friction",
  "missing_feature",
  "performance",
  "accessibility",
  "security",
  "process",
  "technical_debt",    // NEW: specifically identifies debt-related friction
] as const;
```

When an agent or human files an improvement with `category: "technical_debt"`, the governance pipeline offers to create or link a `TechnicalDebtItem` during the "reviewed" transition.

---

### Section 5: Agent Tool — `assess_technical_debt`

A new MCP tool available to agents with appropriate grants, enabling AI-assisted debt discovery and FAIR assessment.

```typescript
{
  name: "assess_technical_debt",
  description: "Identify and assess a technical debt item using Open FAIR risk factors. Creates a TechnicalDebtItem with quantitative risk scoring. Use when you observe patterns like stale dependencies, architectural coupling, missing tests, configuration drift, or code that makes future work harder.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title (max 120 chars)" },
      description: { type: "string", description: "What the debt is and why it matters" },
      debtType: { type: "string", enum: ["deliberate", "accidental", "bit-rot", "environmental"] },
      category: { type: "string", enum: ["dependency", "architecture", "code", "infrastructure", "test", "documentation", "configuration"] },
      evidence: { type: "string", description: "Observable symptoms: warnings, metrics, file paths" },
      affectedComponents: { type: "string", description: "Comma-separated component or package names" },
      // FAIR factors — agent provides best estimates, humans refine
      threatEventFrequency: { type: "string", enum: ["negligible", "low", "moderate", "high", "very-high"] },
      vulnerability: { type: "string", enum: ["negligible", "low", "moderate", "high", "very-high"] },
      productivityLoss: { type: "string", enum: ["negligible", "low", "moderate", "high", "very-high"] },
      responseCost: { type: "string", enum: ["negligible", "low", "moderate", "high", "very-high"] },
      replacementCost: { type: "string", enum: ["negligible", "low", "moderate", "high", "very-high"] },
      interestRate: { type: "string", enum: ["decreasing", "stable", "increasing", "accelerating"] },
    },
    required: ["title", "description", "debtType", "category"],
  },
  requiredCapability: "manage_backlog",  // Product managers and above
  executionMode: "proposal",             // Requires human approval
  sideEffect: true,
}
```

**Agent grant mapping:** `assess_technical_debt` maps to grant `"debt_assessment_create"`.

**Eligible agents:** Portfolio Manager (AGT-100), Gap Analysis (AGT-112), Security Auditor (AGT-190), and orchestrators.

---

### Section 6: Technical Debt Dashboard

A new page at `/ops/debt` within the Ops section, providing portfolio-level debt visibility.

#### Panel 1: Debt Portfolio Summary

Top-level metrics:
- **Total debt items** by status (identified / assessed / accepted / scheduled / in-remediation / remediated / verified / wont-fix)
- **Risk distribution** — bar chart: critical / high / medium / low
- **Interest rate distribution** — pie chart: decreasing / stable / increasing / accelerating
- **Debt by category** — horizontal bar chart across 7 categories
- **Trend line** — risk score (numeric average) over time, computed from `lastAssessedAt` snapshots

#### Panel 2: FAIR Risk Matrix

A 5x5 heatmap: **Loss Event Frequency** (Y-axis) x **Loss Magnitude** (X-axis), with debt items plotted as dots. Color intensity indicates item density. Click a cell to see debt items in that risk region.

#### Panel 3: Debt Items Table

Filterable, sortable table:
- Columns: DebtID, Title, Type, Category, Risk Score, Interest Rate, Product, Owner, Status, Age (days since `accruedAt`)
- Filters: status, category, debtType, riskScore, interestRate, productId
- Sort: riskScoreNumeric (default desc), age, title
- Expandable rows showing: full FAIR factor breakdown, evidence, affected files/components, linked improvement proposals, linked backlog items

#### Panel 4: Debt Aging Report

Grouped by age bracket:
- **< 30 days** (fresh) — recently discovered, assessment in progress
- **30-90 days** (maturing) — should be assessed and accepted or scheduled
- **90-180 days** (aging) — risk of interest compounding
- **> 180 days** (stale) — requires immediate review, likely accelerating interest

Each bracket shows count, average risk score, and most common categories.

---

### Section 7: Debt-to-GRC Bridge

When a technical debt item's risk score reaches "high" or "critical," or when it has regulatory implications, it should be linkable to the formal GRC domain:

1. **Escalate to RiskAssessment** — creates a `RiskAssessment` record with FAIR factors mapped to GRC qualitative scales:
   - `likelihood` = `lossEventFrequency` mapped: negligible→rare, low→unlikely, moderate→possible, high→likely, very-high→almost-certain
   - `severity` = `lossMagnitude` mapped: negligible→negligible, low→minor, moderate→moderate, high→major, very-high→catastrophic
   - `inherentRisk` = `riskScore` mapped: low→low, medium→medium, high→high, critical→critical
   - `hazard` = debt description + evidence

2. **Link to Controls** — existing `Control` records can be linked via `RiskControl` to show what mitigates the debt risk

3. **Trigger ComplianceIncident** — if debt causes an actual incident (e.g., stale dependency with CVE exploited in production), link via `riskAssessmentId`

This bridge ensures technical debt that crosses the compliance threshold enters the formal GRC governance pipeline without duplicating models.

---

### Section 8: Research & Benchmarking

Per AGENTS.md design research requirements:

**Standards:**
- **Open FAIR (O-RA, O-RT)** — The Open Group's quantitative risk analysis standard. Adopted: full FAIR taxonomy decomposition adapted for technical debt factors. Differentiator: standard FAIR targets information security risk; this design extends it to software engineering debt with interest rate accrual.
- **IT4IT v3.0.1** — The Open Group's IT management reference architecture. Adopted: debt categories mapped to value streams. Differentiator: debt is treated as a portfolio concern, not just a code concern.

**Open-source:**
- **SonarQube Technical Debt** (LGPL) — measures debt as estimated remediation time ("debt ratio"). Adopted: the principle that debt is measurable and trackable. Not adopted: time-based scoring (too reductive; FAIR provides richer decomposition).
- **CodeClimate** — quality scores with A-F grades per file. Adopted: per-component debt attribution. Not adopted: file-level granularity (our model operates at component/product level to align with IT4IT).
- **Backstage TechInsights** (Apache 2.0) — scorecards for service maturity. Adopted: the "scorecard" pattern for debt dashboard panels. Differentiator: our system uses FAIR quantitative risk vs. binary pass/fail checks.

**Commercial:**
- **Stepsize (acquired by Sonar)** — IDE-integrated debt tracking with codebase annotations. Adopted: the principle of capturing debt at the point of discovery (agent conversation). Differentiator: our system integrates with governance pipeline and GRC domain.
- **Kovrr Cyber Risk Quantification** — FAIR-based risk quantification for cybersecurity. Adopted: FAIR computation engine patterns, 5-point ordinal scales. Differentiator: Kovrr targets cyber risk; we target software engineering debt with interest rate modeling.

**Key differentiator:** No existing tool applies the full Open FAIR risk taxonomy to technical debt with interest rate accrual, IT4IT value stream alignment, and GRC bridge escalation. This is the novel contribution — treating technical debt as a quantifiable, governable risk with the same rigor as compliance risk.

---

## New & Modified Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `apps/web/lib/fair-risk.ts` | Open FAIR risk computation engine (pure functions) |
| Create | `apps/web/lib/technical-debt-data.ts` | TechnicalDebtItem Prisma queries, counts, trending |
| Create | `apps/web/lib/actions/technical-debt.ts` | Server actions: assess, accept, schedule, remediate, verify, escalate, wont-fix |
| Create | `apps/web/app/(shell)/ops/debt/page.tsx` | Technical Debt Dashboard server component |
| Create | `apps/web/components/ops/DebtDashboardClient.tsx` | Dashboard panels: summary, FAIR matrix, items table, aging report |
| Create | `apps/web/components/ops/DebtItemCard.tsx` | Individual debt item with FAIR factor breakdown |
| Create | `apps/web/components/ops/FairAssessmentForm.tsx` | FAIR factor input form for manual assessment |
| Create | `packages/db/prisma/migrations/YYYYMMDDHHMMSS_add_technical_debt/migration.sql` | TechnicalDebtItem table, ImprovementProposal extension |
| Modify | `packages/db/prisma/schema.prisma` | Add `TechnicalDebtItem` model, add `technicalDebtItemId` to `ImprovementProposal` |
| Modify | `apps/web/lib/compliance-types.ts` | Add debt-specific type exports, ID generator |
| Modify | `apps/web/lib/mcp-tools.ts` | Register `assess_technical_debt` tool |
| Modify | `apps/web/lib/prompt-assembler.ts` | Add debt-awareness directive to agent preamble |
| Modify | `apps/web/lib/actions/improvements.ts` | Add debt linking in `reviewImprovement` transition |
| Modify | `apps/web/app/(shell)/ops/page.tsx` | Add debt summary card to Ops overview |
| Modify | `packages/db/data/agent_registry.json` | Add `debt_assessment_create` grant to eligible agents |

---

## Implementation Priority

**Phase A** (Core model + computation):
- TechnicalDebtItem schema + migration
- `fair-risk.ts` computation engine
- `technical-debt-data.ts` data layer
- Server actions (assess, accept, schedule, remediate, verify, wont-fix)
- Basic debt items table at `/ops/debt`

**Phase B** (Dashboard + agent integration):
- Full dashboard panels (summary, FAIR matrix, aging report)
- `assess_technical_debt` MCP tool + agent grants
- ImprovementProposal category extension + debt linking
- Agent preamble debt-awareness directive

**Phase C** (GRC bridge + automation):
- Escalation to RiskAssessment flow
- Control linking for debt mitigation
- Automated debt detection sensors (dependency audit, config drift)
- Trending and snapshot computation

---

## Acceptance Criteria

1. `TechnicalDebtItem` model persists with all FAIR risk factors and governance lifecycle fields
2. `computeFairRisk()` produces deterministic risk scores from FAIR input factors
3. Risk score numeric (0-10) enables sorting and trending across the debt portfolio
4. Debt items have a complete governance lifecycle: identified → assessed → accepted → scheduled → in-remediation → remediated → verified
5. `wont-fix` status requires documented reason (deliberate acceptance)
6. Interest rate (decreasing/stable/increasing/accelerating) multiplies into risk computation
7. ImprovementProposal can link to TechnicalDebtItem via `technicalDebtItemId`
8. `assess_technical_debt` MCP tool creates debt items with human approval (proposal mode)
9. `/ops/debt` dashboard shows summary metrics, FAIR risk matrix, filterable items table, and aging report
10. Debt items link to DigitalProduct and Portfolio for IT4IT value stream attribution
11. High/critical debt items can be escalated to formal RiskAssessment in the GRC domain
12. FAIR factor mapping to GRC qualitative scales produces consistent risk levels
13. No regression in existing ImprovementProposal or RiskAssessment flows

---

## Appendix A: Open FAIR Risk Analysis of Current Platform Debt

The following debt items are assessed using the FAIR framework against observable evidence from the current codebase. This serves as both a validation of the model and a practical debt inventory.

### TD-001: `.npmrc` contains pnpm-specific `node-linker=hoisted`

| Factor | Value | Rationale |
|---|---|---|
| **Debt Type** | environmental | npm ecosystem change; pnpm config not recognized by npm |
| **Category** | configuration | Package manager configuration mismatch |
| **Threat Event Frequency** | high | Every `npm` invocation produces a warning |
| **Contact Frequency** | daily | Developers and CI hit this on every build |
| **Probability of Action** | moderate | npm warns today; "will stop working in the next major version" = certain future breakage |
| **Vulnerability** | moderate | Build still works, but brittle — single config file, single point of failure |
| **Resistance Strength** | high | Project uses pnpm (CLAUDE.md mandates it); npm path is secondary |
| **Productivity Loss** | low | Warning noise in logs; minor developer confusion |
| **Response Cost** | low | Fix is trivial: delete the line or scope the file to pnpm |
| **Replacement Cost** | negligible | One-line config change |
| **Secondary Loss** | low | CI logs cluttered; new developer onboarding friction |
| **Interest Rate** | accelerating | npm explicitly says this will break in next major version |
| **Computed LEF** | moderate | High TEF but decent resistance |
| **Computed LM** | low | Minimal actual damage today |
| **Risk Score** | **medium (3.2/10)** | Low impact now, but accelerating interest means this becomes high-risk when npm ships the breaking change |

**Recommended action:** Schedule remediation in Phase A. Remove `node-linker=hoisted` from `.npmrc` or move it to `.npmrc` within a pnpm-workspace-scoped location. Verify build with both `pnpm install` and `npm install` paths.

---

### TD-002: Multiple `mcp-chrome` versions (3 distinct hashes)

| Factor | Value | Rationale |
|---|---|---|
| **Debt Type** | bit-rot | Multiple installations accumulated over time |
| **Category** | dependency | Duplicate browser automation dependencies |
| **Threat Event Frequency** | moderate | Not every interaction triggers all three; but disk bloat and potential version confusion |
| **Contact Frequency** | weekly | Playwright/MCP tests encounter this when browser binaries are resolved |
| **Probability of Action** | moderate | Wrong binary could be selected; version mismatch in CI vs local |
| **Vulnerability** | moderate | No pinning strategy visible; multiple versions coexist without governance |
| **Resistance Strength** | low | No automated cleanup or version pinning for browser binaries |
| **Productivity Loss** | moderate | Disk space, download time, confusion about which version is canonical |
| **Response Cost** | moderate | Debugging a test failure caused by wrong browser binary is non-trivial |
| **Replacement Cost** | low | `npx playwright install --with-deps chromium` to consolidate; update lockfile |
| **Secondary Loss** | negligible | No compliance or customer impact |
| **Interest Rate** | increasing | Each Playwright upgrade may add another version without cleaning old ones |
| **Computed LEF** | moderate | Regular encounters with moderate vulnerability |
| **Computed LM** | moderate | Productivity and response costs are the primary drivers |
| **Risk Score** | **medium (4.1/10)** | Material productivity drag with increasing interest |

**Recommended action:** Schedule remediation in Phase A. Audit Playwright browser installations, pin to single version, add cleanup step to CI pipeline.

---

### TD-003: Playwright/Chromium version sprawl (chromium-1208, chromium_headless_shell-1208, ffmpeg-1011)

| Factor | Value | Rationale |
|---|---|---|
| **Debt Type** | bit-rot | Multiple browser binaries accumulated across test tooling updates |
| **Category** | infrastructure | Test infrastructure binary management |
| **Threat Event Frequency** | low | Binaries generally work; issues arise during upgrades or CI cache invalidation |
| **Contact Frequency** | weekly | E2E test runs, CI pipeline execution |
| **Probability of Action** | low | Current versions are compatible; risk increases at next major Playwright upgrade |
| **Vulnerability** | low | Playwright manages its own binaries; version 1208 is current |
| **Resistance Strength** | moderate | Playwright's built-in version management provides some protection |
| **Productivity Loss** | low | ~500MB disk per browser version; CI cache bloat |
| **Response Cost** | low | Playwright provides clear upgrade path |
| **Replacement Cost** | negligible | `pnpm exec playwright install` handles it |
| **Secondary Loss** | negligible | No external impact |
| **Interest Rate** | stable | Playwright manages this reasonably well |
| **Computed LEF** | low | Low frequency, decent resistance |
| **Computed LM** | low | Minimal loss across all dimensions |
| **Risk Score** | **low (1.8/10)** | Manageable; monitor but don't prioritize |

**Recommended action:** Monitor. Include in next scheduled dependency audit. No immediate action required.

---

### Debt Portfolio Summary

| Item | Risk Score | Interest Rate | Recommended Timeline |
|---|---|---|---|
| TD-001: `.npmrc` pnpm config | Medium (3.2) | Accelerating | Phase A — before next npm major release |
| TD-002: Multiple mcp-chrome versions | Medium (4.1) | Increasing | Phase A — next dependency audit |
| TD-003: Playwright binary sprawl | Low (1.8) | Stable | Monitor — next quarterly review |

**Portfolio risk posture:** Medium overall. No critical items, but TD-001's accelerating interest rate makes it the highest-priority item despite its lower current risk score — it will become high-risk when npm ships the breaking change.
