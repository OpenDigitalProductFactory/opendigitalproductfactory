# Discovery Fingerprint Contribution Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first safe slice of the Discovery Fingerprint Contribution Pipeline: persisted observations/reviews/rules, redaction, blast-radius-aware policy gates, deterministic catalog fixtures, and tests without changing live discovery attribution behavior yet.

**Architecture:** Keep the existing discovery pipeline intact. Add a parallel fingerprint knowledge layer that can ingest evidence later, evaluate redaction/policy decisions in pure functions, store reviewable observations and deterministic rule candidates, and validate repo-owned catalogs with fixtures before any runtime discovery path depends on them.

**Tech Stack:** Prisma 7, PostgreSQL, TypeScript, Vitest, pnpm workspaces, existing `@dpf/db` discovery modules.

---

## Scope Boundary

This plan implements the smallest next slice from the spec:

- yes: schema, pure helpers, catalog validation, tests, docs sync
- no: UI queue
- no: scheduled AI coworker
- no: automatic PR generation
- no: changing `attributeInventoryEntity(...)` behavior
- no: changing `persistBootstrapDiscoveryRun(...)` behavior except adding exports/model availability if needed
- no: auto-accepting live observations

Later plans should cover the review UI, daily coworker triage, runtime discovery integration, and contribution PR generation.

## File Structure

### Database schema and model smoke tests

- Modify: `packages/db/prisma/schema.prisma`
  - Add `DiscoveryFingerprintObservation`
  - Add `DiscoveryFingerprintReview`
  - Add `DiscoveryFingerprintRule`
  - Add `DiscoveryFingerprintCatalogVersion`
  - Add optional relations from `InventoryEntity` and `DiscoveryRun` only where Prisma relations are useful and low-risk
- Create: `packages/db/prisma/migrations/<timestamp>_discovery_fingerprint_foundation/migration.sql`
- Create: `packages/db/src/discovery-fingerprint-model.test.ts`

### Pure domain modules

- Create: `packages/db/src/discovery-fingerprint-types.ts`
  - Shared types for observations, evidence families, blast-radius tier, redaction status, policy decisions, and rule candidates
- Create: `packages/db/src/discovery-fingerprint-redaction.ts`
  - Redaction helpers and privacy scanning
- Create: `packages/db/src/discovery-fingerprint-redaction.test.ts`
- Create: `packages/db/src/discovery-fingerprint-policy.ts`
  - Identity/taxonomy threshold gate, blast-radius classifier, review reason generation
- Create: `packages/db/src/discovery-fingerprint-policy.test.ts`
- Create: `packages/db/src/discovery-fingerprint-rules.ts`
  - Deterministic matcher evaluator for bounded matcher types
- Create: `packages/db/src/discovery-fingerprint-rules.test.ts`
- Modify: `packages/db/src/index.ts`
  - Export the new pure helpers and types
- Modify: `packages/db/package.json`
  - Add an export path if this module needs package-level access later; otherwise skip

### Repo-owned catalog foundation

- Create: `packages/db/data/discovery_fingerprints/catalog.json`
- Create: `packages/db/data/discovery_fingerprints/rules/foundational-observability.json`
- Create: `packages/db/data/discovery_fingerprints/fixtures/positive/prometheus-target.json`
- Create: `packages/db/data/discovery_fingerprints/fixtures/negative/private-banner.json`
- Create: `packages/db/data/discovery_fingerprints/changelog.md`
- Create: `packages/db/src/discovery-fingerprint-catalog.ts`
- Create: `packages/db/src/discovery-fingerprint-catalog.test.ts`

### Documentation

- Modify: `docs/superpowers/specs/2026-04-25-discovery-fingerprint-contribution-pipeline-design.md`
  - Add an implementation status section after the slice lands

---

## Chunk 1: Schema And Model Foundation

### Task 1: Add failing Prisma model smoke tests

**Files:**
- Create: `packages/db/src/discovery-fingerprint-model.test.ts`
- Modify later: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Write the failing model smoke test**

Create `packages/db/src/discovery-fingerprint-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/client";

describe("discovery fingerprint Prisma models", () => {
  it("exposes fingerprint contribution pipeline models", () => {
    expect(Prisma.ModelName.DiscoveryFingerprintObservation).toBe("DiscoveryFingerprintObservation");
    expect(Prisma.ModelName.DiscoveryFingerprintReview).toBe("DiscoveryFingerprintReview");
    expect(Prisma.ModelName.DiscoveryFingerprintRule).toBe("DiscoveryFingerprintRule");
    expect(Prisma.ModelName.DiscoveryFingerprintCatalogVersion).toBe("DiscoveryFingerprintCatalogVersion");
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-model.test.ts
```

Expected: FAIL because the Prisma model names do not exist yet.

- [ ] **Step 3: Add the Prisma models**

Modify `packages/db/prisma/schema.prisma` near the existing discovery models.

Add:

```prisma
model DiscoveryFingerprintObservation {
  id                   String   @id @default(cuid())
  observationKey       String   @unique
  inventoryEntityId    String?
  discoveryRunId       String?
  sourceKind           String
  signalClass          String
  protocol             String?
  rawEvidenceLocal     Json?
  normalizedEvidence   Json
  redactionStatus      String   @default("not_required")
  evidenceFamilies     String[] @default([])
  identityCandidates   Json     @default("[]")
  taxonomyCandidates   Json     @default("[]")
  identityConfidence   Float?
  taxonomyConfidence   Float?
  candidateMargin      Float?
  blastRadiusTier      String   @default("medium")
  decisionStatus       String   @default("pending")
  reviewReason         String?
  approvedRuleId       String?
  firstSeenAt          DateTime @default(now())
  lastSeenAt           DateTime @default(now())
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  inventoryEntity      InventoryEntity? @relation(fields: [inventoryEntityId], references: [id], onDelete: SetNull)
  discoveryRun         DiscoveryRun? @relation(fields: [discoveryRunId], references: [id], onDelete: SetNull)
  approvedRule         DiscoveryFingerprintRule? @relation("ApprovedFingerprintRule", fields: [approvedRuleId], references: [id], onDelete: SetNull)
  reviews              DiscoveryFingerprintReview[]

  @@index([sourceKind])
  @@index([signalClass])
  @@index([redactionStatus])
  @@index([decisionStatus])
  @@index([blastRadiusTier])
  @@index([inventoryEntityId])
  @@index([discoveryRunId])
}

model DiscoveryFingerprintReview {
  id             String   @id @default(cuid())
  observationId  String
  reviewerType   String
  reviewerId     String?
  decision       String
  reason         String?
  previousStatus String?
  nextStatus     String
  auditPayload   Json     @default("{}")
  createdAt      DateTime @default(now())

  observation DiscoveryFingerprintObservation @relation(fields: [observationId], references: [id], onDelete: Cascade)

  @@index([observationId])
  @@index([decision])
  @@index([reviewerType])
}

model DiscoveryFingerprintRule {
  id                       String   @id @default(cuid())
  ruleKey                  String   @unique
  catalogVersionId          String?
  status                   String   @default("draft")
  scope                    String   @default("global")
  matchExpression          Json
  requiredEvidenceFamilies String[] @default([])
  excludedSignals          Json     @default("[]")
  resolvedIdentity         Json
  taxonomyNodeId           String?
  identityConfidence       Float
  taxonomyConfidence       Float
  source                   String   @default("manual")
  redactionReport          Json     @default("{}")
  fixtureRefs              String[] @default([])
  sourceObservationIds     String[] @default([])
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  catalogVersion DiscoveryFingerprintCatalogVersion? @relation(fields: [catalogVersionId], references: [id], onDelete: SetNull)
  taxonomyNode   TaxonomyNode? @relation(fields: [taxonomyNodeId], references: [id], onDelete: SetNull)
  approvedObservations DiscoveryFingerprintObservation[] @relation("ApprovedFingerprintRule")

  @@index([status])
  @@index([scope])
  @@index([taxonomyNodeId])
  @@index([catalogVersionId])
}

model DiscoveryFingerprintCatalogVersion {
  id            String   @id @default(cuid())
  catalogKey    String
  version       String
  schemaVersion String
  source        String   @default("repo")
  importedAt    DateTime @default(now())
  changelog     String?
  validation    Json     @default("{}")

  rules DiscoveryFingerprintRule[]

  @@unique([catalogKey, version])
}
```

Also add relation arrays where needed:

```prisma
model InventoryEntity {
  // existing fields
  fingerprintObservations DiscoveryFingerprintObservation[]
}

model DiscoveryRun {
  // existing fields
  fingerprintObservations DiscoveryFingerprintObservation[]
}
```

- [ ] **Step 4: Create and apply the migration**

Run:

```sh
pnpm --filter @dpf/db exec prisma migrate dev --name discovery_fingerprint_foundation
```

Expected: migration generated, applied, and Prisma client regenerated.

- [ ] **Step 5: Run the model smoke test to verify GREEN**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/discovery-fingerprint-model.test.ts
git commit -s -m "feat(db): add discovery fingerprint schema foundation"
```

---

## Chunk 2: Redaction And Blast-Radius Policy

### Task 2: Add fingerprint types, redaction, and threshold policy

**Files:**
- Create: `packages/db/src/discovery-fingerprint-types.ts`
- Create: `packages/db/src/discovery-fingerprint-redaction.ts`
- Create: `packages/db/src/discovery-fingerprint-redaction.test.ts`
- Create: `packages/db/src/discovery-fingerprint-policy.ts`
- Create: `packages/db/src/discovery-fingerprint-policy.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing redaction tests**

Create `packages/db/src/discovery-fingerprint-redaction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redactFingerprintEvidence } from "./discovery-fingerprint-redaction";

describe("redactFingerprintEvidence", () => {
  it("redacts private network and tenant identifiers", () => {
    const result = redactFingerprintEvidence({
      banner: "prod-acme-sql-01.internal.example.com 10.0.4.15 serial ABC123",
      mac: "aa:bb:cc:dd:ee:ff",
      model: "PostgreSQL 16",
    });

    expect(result.status).toBe("redacted");
    expect(JSON.stringify(result.normalizedEvidence)).not.toContain("acme");
    expect(JSON.stringify(result.normalizedEvidence)).not.toContain("10.0.4.15");
    expect(JSON.stringify(result.normalizedEvidence)).not.toContain("aa:bb:cc");
    expect(result.redactedFields).toEqual(expect.arrayContaining(["banner", "mac"]));
  });

  it("blocks secrets instead of trying to sanitize them", () => {
    const result = redactFingerprintEvidence({
      header: "Authorization: Bearer secret-token",
    });

    expect(result.status).toBe("blocked_sensitive");
    expect(result.blockedReasons).toContain("secret_like_token");
  });
});
```

- [ ] **Step 2: Write failing blast-radius policy tests**

Create `packages/db/src/discovery-fingerprint-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateFingerprintPolicy } from "./discovery-fingerprint-policy";

describe("evaluateFingerprintPolicy", () => {
  it("auto-accepts low blast-radius observations with strong evidence", () => {
    const result = evaluateFingerprintPolicy({
      identityConfidence: 0.96,
      taxonomyConfidence: 0.88,
      candidateMargin: 0.12,
      evidenceFamilies: ["container_image", "process_name"],
      redactionStatus: "not_required",
      blastRadiusTier: "low",
      hasDeprecatedTaxonomyCandidate: false,
      hasManualConflict: false,
      hasEstateAmbiguity: false,
      affectedEntityCount: 1,
    });

    expect(result.decision).toBe("auto_accept");
  });

  it("routes customer-critical observations to human review regardless of confidence", () => {
    const result = evaluateFingerprintPolicy({
      identityConfidence: 1,
      taxonomyConfidence: 1,
      candidateMargin: 0.5,
      evidenceFamilies: ["snmp", "http_banner"],
      redactionStatus: "redacted",
      blastRadiusTier: "customer-critical",
      hasDeprecatedTaxonomyCandidate: false,
      hasManualConflict: false,
      hasEstateAmbiguity: false,
      affectedEntityCount: 1,
    });

    expect(result.decision).toBe("human_review");
    expect(result.reasons).toContain("customer_critical_blast_radius");
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-redaction.test.ts discovery-fingerprint-policy.test.ts
```

Expected: FAIL because modules do not exist yet.

- [ ] **Step 4: Create shared types**

Create `packages/db/src/discovery-fingerprint-types.ts`:

```ts
export type RedactionStatus = "not_required" | "redacted" | "needs_review" | "blocked_sensitive";

export type BlastRadiusTier = "low" | "medium" | "high" | "customer-critical";

export type FingerprintPolicyDecision = "auto_accept" | "human_review" | "unresolved";

export type FingerprintEvidenceFamily =
  | "container_image"
  | "process_name"
  | "package_name"
  | "snmp"
  | "mdns"
  | "dhcp"
  | "http_banner"
  | "tls_certificate"
  | "prometheus_target"
  | "human_confirmation";

export type FingerprintPolicyInput = {
  identityConfidence: number;
  taxonomyConfidence: number;
  candidateMargin: number;
  evidenceFamilies: string[];
  redactionStatus: RedactionStatus;
  blastRadiusTier: BlastRadiusTier;
  hasDeprecatedTaxonomyCandidate: boolean;
  hasManualConflict: boolean;
  hasEstateAmbiguity: boolean;
  affectedEntityCount: number;
};
```

- [ ] **Step 5: Implement redaction helper**

Create `packages/db/src/discovery-fingerprint-redaction.ts`.

Implementation requirements:

- recursively inspect string values
- replace IPv4 literals with `[redacted-ip]`
- replace MAC literals with `[redacted-mac]`
- replace internal-looking hostnames with `[redacted-hostname]`
- replace serial markers with `[redacted-serial]`
- block token-like values instead of redacting
- return `normalizedEvidence`, `status`, `redactedFields`, and `blockedReasons`

- [ ] **Step 6: Implement policy gate**

Create `packages/db/src/discovery-fingerprint-policy.ts`.

Policy table:

```ts
const THRESHOLDS = {
  low: { identity: 0.95, taxonomy: 0.85, margin: 0.10, rolloutCap: 25 },
  medium: { identity: 0.97, taxonomy: 0.90, margin: 0.15, rolloutCap: 10 },
  high: { identity: 0.99, taxonomy: 0.95, margin: 0.20, rolloutCap: 3 },
  "customer-critical": null,
} as const;
```

Return reasons such as:

- `customer_critical_blast_radius`
- `identity_confidence_below_threshold`
- `taxonomy_confidence_below_threshold`
- `candidate_margin_below_threshold`
- `insufficient_evidence_families`
- `blocked_sensitive_evidence`
- `manual_conflict`
- `estate_ambiguity`
- `deprecated_taxonomy_candidate`
- `rollout_cap_exceeded`

- [ ] **Step 7: Export helpers**

Modify `packages/db/src/index.ts`:

```ts
export * from "./discovery-fingerprint-types";
export * from "./discovery-fingerprint-redaction";
export * from "./discovery-fingerprint-policy";
```

- [ ] **Step 8: Run tests to verify GREEN**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-redaction.test.ts discovery-fingerprint-policy.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```sh
git add packages/db/src/discovery-fingerprint-*.ts packages/db/src/index.ts
git commit -s -m "feat(db): add fingerprint redaction and policy gates"
```

---

## Chunk 3: Deterministic Rule Evaluator

### Task 3: Add bounded deterministic rule matching

**Files:**
- Create: `packages/db/src/discovery-fingerprint-rules.ts`
- Create: `packages/db/src/discovery-fingerprint-rules.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing rule evaluator tests**

Create `packages/db/src/discovery-fingerprint-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateFingerprintRule } from "./discovery-fingerprint-rules";

describe("evaluateFingerprintRule", () => {
  it("matches when all required evidence families and expressions match", () => {
    const result = evaluateFingerprintRule({
      ruleKey: "observability:prometheus-node-exporter",
      requiredEvidenceFamilies: ["prometheus_target", "process_name"],
      matchExpression: {
        all: [
          { type: "contains", path: "job", value: "node-exporter" },
          { type: "contains", path: "process", value: "node_exporter" },
        ],
      },
    }, {
      evidenceFamilies: ["prometheus_target", "process_name"],
      normalizedEvidence: { job: "node-exporter", process: "node_exporter" },
    });

    expect(result.matched).toBe(true);
  });

  it("does not match when required evidence is missing", () => {
    const result = evaluateFingerprintRule({
      ruleKey: "observability:prometheus-node-exporter",
      requiredEvidenceFamilies: ["prometheus_target", "process_name"],
      matchExpression: {
        all: [{ type: "contains", path: "job", value: "node-exporter" }],
      },
    }, {
      evidenceFamilies: ["prometheus_target"],
      normalizedEvidence: { job: "node-exporter" },
    });

    expect(result.matched).toBe(false);
    expect(result.reasons).toContain("missing_required_evidence_family:process_name");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-rules.test.ts
```

Expected: FAIL because the evaluator does not exist.

- [ ] **Step 3: Implement bounded matcher evaluator**

Create `packages/db/src/discovery-fingerprint-rules.ts`.

Support only these matcher forms:

```ts
type MatchClause =
  | { type: "exact"; path: string; value: string }
  | { type: "contains"; path: string; value: string }
  | { type: "regex"; path: string; pattern: string }
  | { type: "snmp_oid_prefix"; path: string; value: string };

type MatchExpression =
  | { all: MatchClause[] }
  | { any: MatchClause[] };
```

Do not execute arbitrary code. Keep nested paths simple dot paths.

- [ ] **Step 4: Export evaluator**

Modify `packages/db/src/index.ts`:

```ts
export * from "./discovery-fingerprint-rules";
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-rules.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/db/src/discovery-fingerprint-rules.ts packages/db/src/discovery-fingerprint-rules.test.ts packages/db/src/index.ts
git commit -s -m "feat(db): add deterministic fingerprint rule evaluator"
```

---

## Chunk 4: Repo Catalog Validation

### Task 4: Add catalog fixture format and validator

**Files:**
- Create: `packages/db/data/discovery_fingerprints/catalog.json`
- Create: `packages/db/data/discovery_fingerprints/rules/foundational-observability.json`
- Create: `packages/db/data/discovery_fingerprints/fixtures/positive/prometheus-target.json`
- Create: `packages/db/data/discovery_fingerprints/fixtures/negative/private-banner.json`
- Create: `packages/db/data/discovery_fingerprints/changelog.md`
- Create: `packages/db/src/discovery-fingerprint-catalog.ts`
- Create: `packages/db/src/discovery-fingerprint-catalog.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing catalog validation tests**

Create `packages/db/src/discovery-fingerprint-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateFingerprintCatalog } from "./discovery-fingerprint-catalog";

describe("validateFingerprintCatalog", () => {
  it("accepts the repo catalog fixtures", async () => {
    const result = await validateFingerprintCatalog("packages/db/data/discovery_fingerprints/catalog.json");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-catalog.test.ts
```

Expected: FAIL because catalog files and validator do not exist.

- [ ] **Step 3: Add minimal catalog files**

Create `packages/db/data/discovery_fingerprints/catalog.json`:

```json
{
  "catalogKey": "dpf-discovery-fingerprints",
  "version": "0.1.0",
  "schemaVersion": "1",
  "rules": [
    "rules/foundational-observability.json"
  ]
}
```

Create `packages/db/data/discovery_fingerprints/rules/foundational-observability.json` with a single safe Prometheus/node-exporter rule.

Create positive and negative fixture files. The negative fixture must intentionally include private-looking evidence and must not match or pass redaction as contribution-ready.

- [ ] **Step 4: Implement catalog validator**

Create `packages/db/src/discovery-fingerprint-catalog.ts`.

Validator requirements:

- load catalog JSON
- load each rule JSON
- reject duplicate rule keys
- reject missing fixtures
- run each positive fixture through `evaluateFingerprintRule`
- ensure negative fixtures do not match
- run redaction scan and reject private tokens in contribution-ready rules
- reject deprecated taxonomy references if taxonomy fixtures include a deprecated marker

- [ ] **Step 5: Export catalog helper**

Modify `packages/db/src/index.ts`:

```ts
export * from "./discovery-fingerprint-catalog";
```

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-catalog.test.ts discovery-fingerprint-rules.test.ts discovery-fingerprint-redaction.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/db/data/discovery_fingerprints packages/db/src/discovery-fingerprint-catalog.ts packages/db/src/discovery-fingerprint-catalog.test.ts packages/db/src/index.ts
git commit -s -m "feat(db): add fingerprint catalog validation"
```

---

## Chunk 5: Persistence Helpers Without Runtime Behavior Change

### Task 5: Add repository helpers for observations and reviews

**Files:**
- Create: `packages/db/src/discovery-fingerprint-store.ts`
- Create: `packages/db/src/discovery-fingerprint-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing store tests using a mocked Prisma-like client**

Create `packages/db/src/discovery-fingerprint-store.test.ts`.

Test:

- upserts observation by `observationKey`
- creates a review event
- links an approved rule
- preserves raw local evidence in `rawEvidenceLocal`
- stores redacted evidence in `normalizedEvidence`

- [ ] **Step 2: Run test to verify RED**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-store.test.ts
```

Expected: FAIL because store helper does not exist.

- [ ] **Step 3: Implement store helpers**

Create `packages/db/src/discovery-fingerprint-store.ts`.

Export:

```ts
export async function upsertFingerprintObservation(...)
export async function recordFingerprintReview(...)
export async function activateFingerprintRule(...)
```

Keep the helper standalone. Do not call it from `discovery-sync.ts` yet.

- [ ] **Step 4: Export store helpers**

Modify `packages/db/src/index.ts`:

```ts
export * from "./discovery-fingerprint-store";
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/db/src/discovery-fingerprint-store.ts packages/db/src/discovery-fingerprint-store.test.ts packages/db/src/index.ts
git commit -s -m "feat(db): add fingerprint observation store helpers"
```

---

## Chunk 6: Final Verification And Documentation Sync

### Task 6: Run focused verification and update spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-04-25-discovery-fingerprint-contribution-pipeline-design.md`

- [ ] **Step 1: Run focused DB tests**

Run:

```sh
pnpm --filter @dpf/db test -- discovery-fingerprint-model.test.ts discovery-fingerprint-redaction.test.ts discovery-fingerprint-policy.test.ts discovery-fingerprint-rules.test.ts discovery-fingerprint-catalog.test.ts discovery-fingerprint-store.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run DB typecheck**

Run:

```sh
pnpm --filter @dpf/db typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build only if web-facing exports changed**

If any `apps/web` code was touched, run:

```sh
cd apps/web
npx next build
```

Expected: PASS.

If no `apps/web` code was touched, note that production build was skipped because the slice is DB/docs-only and does not change shipped UI/runtime behavior.

- [ ] **Step 4: Update implementation status in the spec**

Add a short section to `docs/superpowers/specs/2026-04-25-discovery-fingerprint-contribution-pipeline-design.md`:

```md
## Implemented Slice Status

Implemented in this slice:

- fingerprint observation/review/rule/catalog schema foundation
- redaction and privacy scanning helpers
- blast-radius-aware auto-accept policy gate
- bounded deterministic rule evaluator
- repo-owned catalog fixture validation
- persistence helpers for future ingestion

Deferred:

- review queue UI
- scheduled daily AI coworker triage
- live discovery integration
- contribution PR generation
- automatic rule activation in runtime discovery
```

- [ ] **Step 5: Commit docs sync**

```sh
git add docs/superpowers/specs/2026-04-25-discovery-fingerprint-contribution-pipeline-design.md
git commit -s -m "docs: sync fingerprint contribution implementation status"
```

---

## Execution Notes

- Keep user or reviewer edits to the spec intact.
- Do not modify existing committed migration files.
- Do not edit `packages/db/src/seed.ts` for runtime truth.
- Do not wire the new policy into `attributeInventoryEntity(...)` in this slice.
- Do not create backlog rows unless the user explicitly asks to mutate the live backlog.
- All commits must use `git commit -s`.
- If implementation touches `.ts` files, run the affected typecheck before committing.

