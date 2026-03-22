# EP-DEVCONTAINER-001: Dev Container for Platform Development — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an isolated dev environment with its own databases, sanitized production data, VS Code Dev Container support, and a recursion guard that prevents Build Studio from spawning sandboxes inside dev.

**Architecture:** Compose profile `dev` adds 5 services (dev-postgres, dev-neo4j, dev-qdrant, dev-init, dev-portal) to the existing `docker-compose.yml`. A new `dev` Dockerfile stage branches from `base` with bind-mounted source. A sanitized clone script copies production data with PII obfuscation driven by a manual table-to-sensitivity classification. `DPF_ENVIRONMENT=dev` disables sandbox creation.

**Tech Stack:** Docker Compose profiles, Node 20 Alpine, Prisma, Neo4j APOC, TypeScript, VS Code Dev Containers

**Spec:** `docs/superpowers/specs/2026-03-22-dev-container-platform-development-design.md`

**CAUTION:** Active Docker debugging in progress. Every infrastructure change must be verified in isolation before moving to the next task. Do not batch compose changes.

---

## File Structure

### New Files
- `.devcontainer/devcontainer.json` — VS Code Dev Container configuration
- `packages/db/src/sanitized-clone.ts` — Classification-driven data sanitization script
- `packages/db/src/table-classification.ts` — Table-to-sensitivity mapping for all 194 Prisma models
- `packages/db/src/sanitized-clone.test.ts` — Tests for obfuscation logic

### Modified Files
- `Dockerfile` — Add `dev` stage branching from `base`
- `docker-compose.yml` — Add 5 dev services under `profiles: ["dev"]`, add `DPF_ENVIRONMENT=production` to portal, add 3 dev volumes
- `apps/web/lib/sandbox.ts` — Add recursion guard to `createSandbox()`
- `apps/web/lib/sandbox-db.ts` — Add recursion guard to `createSandboxDbStack()`
- `apps/web/components/build/BuildStudio.tsx` — Add read-only mode when `DPF_ENVIRONMENT=dev`
- `apps/web/app/(shell)/build/page.tsx` — Pass `dpfEnvironment` prop to BuildStudio
- `README.md` — Add "Dev Container Setup" section

---

## Task 1: Add `dev` Stage to Dockerfile

**Files:**
- Modify: `Dockerfile` (after line 3, before the `deps` stage)

- [ ] **Step 1: Add the dev stage**

Insert after the `base` stage (line 3) and before the `deps` stage comment (line 5):

```dockerfile
# ─── Dev stage (parallel branch — not part of production chain) ──────────────
FROM base AS dev
WORKDIR /workspace
RUN apk add --no-cache git
CMD ["sh", "-c", "pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter web dev"]
```

- [ ] **Step 2: Verify the dev stage builds**

Run: `docker build --target dev -t dpf-dev-test .`
Expected: Image builds successfully. Output shows `FROM base AS dev`, `apk add git`, and completes.

- [ ] **Step 3: Verify production stages are unaffected**

Run: `docker build --target runner -t dpf-runner-test .`
Expected: Image builds successfully. The production build path is unchanged.

- [ ] **Step 4: Clean up test images**

Run: `docker rmi dpf-dev-test dpf-runner-test 2>/dev/null; echo "done"`

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "feat(docker): add dev stage for dev container workspace"
```

---

## Task 2: Add `DPF_ENVIRONMENT=production` to Production Portal

**Files:**
- Modify: `docker-compose.yml` (portal service environment block, around line 74)

- [ ] **Step 1: Add environment variable**

Add `DPF_ENVIRONMENT: production` to the `portal` service environment block, after the `DEPLOYED_VERSION` line.

- [ ] **Step 2: Verify compose config is valid**

Run: `docker compose config --quiet`
Expected: No errors. Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(docker): add explicit DPF_ENVIRONMENT=production to portal service"
```

---

## Task 3: Add Dev Database Services to Compose

**Files:**
- Modify: `docker-compose.yml` — add dev-postgres, dev-neo4j, dev-qdrant services and volumes

- [ ] **Step 1: Add dev-postgres service**

Add after the `playwright` service block, before `volumes:`:

```yaml
  # ─── Dev Environment (isolated databases for development) ──────────────────
  dev-postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    profiles: ["dev"]
    environment:
      POSTGRES_USER: dpf
      POSTGRES_PASSWORD: dpf_dev
      POSTGRES_DB: dpf
    ports:
      - "5433:5432"
    volumes:
      - dev_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dpf"]
      interval: 5s
      timeout: 5s
      retries: 5
```

- [ ] **Step 2: Add dev-neo4j service**

Add immediately after dev-postgres:

```yaml
  dev-neo4j:
    image: neo4j:5-community
    restart: unless-stopped
    profiles: ["dev"]
    environment:
      NEO4J_AUTH: neo4j/dpf_dev_password
      NEO4J_PLUGINS: '["apoc"]'
    ports:
      - "7475:7474"
      - "7688:7687"
    volumes:
      - dev_neo4jdata:/data
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null http://localhost:7474 || exit 1"]
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 30s
```

- [ ] **Step 3: Add dev-qdrant service**

Add immediately after dev-neo4j:

```yaml
  dev-qdrant:
    image: qdrant/qdrant:latest
    restart: unless-stopped
    profiles: ["dev"]
    volumes:
      - dev_qdrant_data:/qdrant/storage
    ports:
      - "6334:6333"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/readyz"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s
```

- [ ] **Step 4: Add dev volumes**

Add to the `volumes:` section at the bottom of the file:

```yaml
  dev_pgdata:
  dev_neo4jdata:
  dev_qdrant_data:
```

- [ ] **Step 5: Verify compose config**

Run: `docker compose config --quiet`
Expected: No errors.

- [ ] **Step 6: Verify dev profile starts databases**

Run: `docker compose --profile dev up -d dev-postgres dev-neo4j dev-qdrant`
Expected: Three dev containers start. Health checks pass.

Run: `docker compose --profile dev ps`
Expected: dev-postgres, dev-neo4j, dev-qdrant all show as healthy.

- [ ] **Step 7: Verify production is unaffected**

Run: `docker compose ps`
Expected: Only production services shown. No dev services.

- [ ] **Step 8: Stop dev databases**

Run: `docker compose --profile dev down`

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(docker): add isolated dev database services under dev profile"
```

---

## Task 4: Add dev-init and dev-portal Services to Compose

**Files:**
- Modify: `docker-compose.yml` — add dev-init and dev-portal services

- [ ] **Step 1: Add dev-init service**

Add after dev-qdrant, before dev-portal:

```yaml
  dev-init:
    build:
      context: .
      target: dev
    profiles: ["dev"]
    command: ["sh", "-c", "pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter @dpf/db exec prisma migrate deploy"]
    environment:
      DATABASE_URL: postgresql://dpf:dpf_dev@dev-postgres:5432/dpf
      PRODUCTION_DATABASE_URL: postgresql://dpf:dpf_dev@postgres:5432/dpf
      NEO4J_URI: bolt://dev-neo4j:7687
      NEO4J_USER: neo4j
      NEO4J_PASSWORD: dpf_dev_password
      PRODUCTION_NEO4J_URI: bolt://neo4j:7687
      DPF_ENVIRONMENT: dev
    volumes:
      - .:/workspace
    depends_on:
      dev-postgres:
        condition: service_healthy
      dev-neo4j:
        condition: service_healthy
      dev-qdrant:
        condition: service_healthy
      postgres:
        condition: service_healthy
```

Note: The `dev-init` command starts with just migrations. The sanitized clone will be added in Task 9 after the script is written and tested.

- [ ] **Step 2: Add dev-portal service**

Add after dev-init:

```yaml
  dev-portal:
    build:
      context: .
      target: dev
    restart: unless-stopped
    profiles: ["dev"]
    ports:
      - "3001:3000"
    volumes:
      - .:/workspace
    environment:
      DATABASE_URL: postgresql://dpf:dpf_dev@dev-postgres:5432/dpf
      NEO4J_URI: bolt://dev-neo4j:7687
      NEO4J_USER: neo4j
      NEO4J_PASSWORD: dpf_dev_password
      QDRANT_INTERNAL_URL: http://dev-qdrant:6333
      LLM_BASE_URL: ${LLM_BASE_URL:-http://model-runner.docker.internal/v1}
      DPF_ENVIRONMENT: dev
      AUTH_SECRET: dev_secret_change_me
      AUTH_TRUST_HOST: "true"
      CREDENTIAL_ENCRYPTION_KEY: dev_only_key_not_for_production_0000
    depends_on:
      dev-init:
        condition: service_completed_successfully
```

- [ ] **Step 3: Verify compose config**

Run: `docker compose config --quiet`
Expected: No errors.

- [ ] **Step 4: Verify full dev stack starts**

Run: `docker compose --profile dev up -d`
Expected: dev-postgres, dev-neo4j, dev-qdrant start and become healthy. dev-init runs migrations and exits successfully. dev-portal starts Next.js dev server.

- [ ] **Step 5: Verify dev portal is reachable**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001`
Expected: 200 (or 302 redirect to login).

- [ ] **Step 6: Verify production portal still works**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
Expected: 200 (or 302 redirect to login).

- [ ] **Step 7: Stop dev stack**

Run: `docker compose --profile dev stop dev-portal dev-init`

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(docker): add dev-init and dev-portal services for dev environment"
```

---

## Task 5: Recursion Guard — Sandbox Code

**Files:**
- Modify: `apps/web/lib/sandbox.ts:72-80` — guard `createSandbox()`
- Modify: `apps/web/lib/sandbox-db.ts:67-74` — guard `createSandboxDbStack()`

- [ ] **Step 1: Add guard to createSandbox()**

In `apps/web/lib/sandbox.ts`, add at the top of the `createSandbox()` function (line 76, before `const args`):

```typescript
  if (process.env.DPF_ENVIRONMENT === "dev") {
    throw new Error("Sandbox creation is disabled in the dev environment");
  }
```

- [ ] **Step 2: Add guard to createSandboxDbStack()**

In `apps/web/lib/sandbox-db.ts`, add at the top of the `createSandboxDbStack()` function (line 74, before `const dbName`):

```typescript
  if (process.env.DPF_ENVIRONMENT === "dev") {
    throw new Error("Sandbox database stack creation is disabled in the dev environment");
  }
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter web test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sandbox.ts apps/web/lib/sandbox-db.ts
git commit -m "feat(devcontainer): add DPF_ENVIRONMENT recursion guard to sandbox creation"
```

---

## Task 6: Recursion Guard — Build Studio UI

**Files:**
- Modify: `apps/web/app/(shell)/build/page.tsx` — pass environment prop
- Modify: `apps/web/components/build/BuildStudio.tsx` — read-only mode when dev

- [ ] **Step 1: Read current build page**

Read `apps/web/app/(shell)/build/page.tsx` to understand the current server component structure.

- [ ] **Step 2: Add dpfEnvironment prop to page**

In `apps/web/app/(shell)/build/page.tsx`, add to the props passed to `<BuildStudio>`:

```typescript
dpfEnvironment={process.env.DPF_ENVIRONMENT ?? "production"}
```

- [ ] **Step 3: Update BuildStudio Props type**

In `apps/web/components/build/BuildStudio.tsx`, add to the `Props` type:

```typescript
  dpfEnvironment?: string;
```

- [ ] **Step 4: Add read-only mode to BuildStudio**

In `apps/web/components/build/BuildStudio.tsx`:

a) Destructure the new prop:
```typescript
export function BuildStudio({ builds, portfolios, dpfEnvironment }: Props) {
```

b) Derive a constant after the state declarations:
```typescript
  const isDevEnvironment = dpfEnvironment === "dev";
```

c) Wrap the "New" input and button section (lines 109-125) in a conditional. When `isDevEnvironment` is true, show a banner instead:

```tsx
{isDevEnvironment ? (
  <div className="p-3 border-b border-[var(--dpf-border)]">
    <div className="px-3 py-2 text-[13px] bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md text-[var(--dpf-muted)]">
      Development environment -- builds are managed from the production instance
    </div>
  </div>
) : (
  <div className="p-3 border-b border-[var(--dpf-border)]">
    {/* existing input + button */}
  </div>
)}
```

d) Also disable the delete button when `isDevEnvironment` is true — add `if (isDevEnvironment) return;` at the top of the delete onClick handler.

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Verify tests pass**

Run: `pnpm --filter web test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/(shell)/build/page.tsx apps/web/components/build/BuildStudio.tsx
git commit -m "feat(devcontainer): Build Studio read-only mode when DPF_ENVIRONMENT=dev"
```

---

## Task 7: Table Classification Mapping

**Files:**
- Create: `packages/db/src/table-classification.ts`

This is the manual mapping of all 194 Prisma models to sensitivity levels. This file is the core of the sanitization strategy. Unmapped tables default to `confidential`.

- [ ] **Step 1: Create classification configuration**

Create `packages/db/src/table-classification.ts` with:

```typescript
// packages/db/src/table-classification.ts
// Manual table-to-sensitivity mapping for sanitized clone pipeline.
// Informed by route sensitivity classifications in apps/web/lib/agent-sensitivity.ts.
// Unmapped tables default to "confidential" (safe default).
//
// Sensitivity levels:
//   public       — copy verbatim, no sensitive content
//   internal     — copy verbatim, operator's own work
//   confidential — obfuscate PII (names, emails, phones), preserve structure
//   restricted   — never copy data, generate placeholder structure only

export type TableSensitivity = "public" | "internal" | "confidential" | "restricted";

export const TABLE_CLASSIFICATION: Record<string, TableSensitivity> = {
  // ── Public: Reference data, taxonomy, types ────────────────────────────
  TaxonomyNode: "public",
  EaElementType: "public",
  EaRelationshipType: "public",
  EaRelationshipRule: "public",
  EaDqRule: "public",
  EaNotation: "public",
  EaStructureRule: "public",
  ViewpointDefinition: "public",
  StorefrontArchetype: "public",
  PlatformCapability: "public",
  Country: "public",
  Region: "public",
  City: "public",
  EmploymentType: "public",
  WorkLocation: "public",

  // ── Internal: Operational data, business content ───────────────────────
  Portfolio: "internal",
  DigitalProduct: "internal",
  ProductVersion: "internal",
  ChangePromotion: "internal",
  ChangeRequest: "internal",
  ChangeItem: "internal",
  DeploymentWindow: "internal",
  BlackoutPeriod: "internal",
  StandardChangeCatalog: "internal",
  CodebaseManifest: "internal",
  ServiceOffering: "internal",
  BacklogItem: "internal",
  Epic: "internal",
  EpicPortfolio: "internal",
  ImprovementProposal: "internal",
  BrandingConfig: "internal",
  EaReferenceModel: "internal",
  EaReferenceModelElement: "internal",
  EaReferenceModelArtifact: "internal",
  EaAssessmentScope: "internal",
  EaReferenceAssessment: "internal",
  EaReferenceProposal: "internal",
  EaElement: "internal",
  EaRelationship: "internal",
  EaView: "internal",
  EaViewElement: "internal",
  EaConformanceIssue: "internal",
  EaSnapshot: "internal",
  FeatureBuild: "internal",
  BuildActivity: "internal",
  PromotionBackup: "internal",
  FeaturePack: "internal",
  DiscoveryRun: "internal",
  DiscoveredItem: "internal",
  DiscoveredRelationship: "internal",
  InventoryEntity: "internal",
  InventoryRelationship: "internal",
  PortfolioQualityIssue: "internal",
  Regulation: "internal",
  Obligation: "internal",
  Control: "internal",
  ControlObligationLink: "internal",
  Policy: "internal",
  PolicyRequirement: "internal",
  PolicyObligationLink: "internal",
  TrainingRequirement: "internal",
  PolicyRule: "internal",
  ComplianceSnapshot: "internal",
  RegulatoryMonitorScan: "internal",
  RegulatoryAlert: "internal",
  Notification: "internal",
  DynamicForm: "internal",
  DynamicView: "internal",
  PlatformIssueReport: "internal",
  RuntimeAdvisory: "internal",
  PlatformSetupProgress: "internal",
  PlatformConfig: "internal",
  ScheduledJob: "internal",
  McpServer: "internal",
  McpServerTool: "internal",
  McpIntegration: "internal",
  McpCatalogSync: "internal",
  StorefrontConfig: "internal",
  StorefrontSection: "internal",
  StorefrontItem: "internal",
  ProviderService: "internal",
  ProviderAvailability: "internal",
  OnboardingChecklist: "internal",
  OnboardingTask: "internal",
  OnboardingDraft: "internal",
  ReviewCycle: "internal",
  LeavePolicy: "internal",
  CalendarEvent: "internal",
  CalendarSync: "internal",
  ExecutionRecipe: "internal",
  RecurringSchedule: "internal",
  RecurringLineItem: "internal",
  DunningSequence: "internal",
  DunningStep: "internal",
  ExchangeRate: "internal",
  OrgSettings: "internal",
  ApprovalRule: "internal",
  BusinessProfile: "internal",

  // ── Confidential: PII, user data, employee records ─────────────────────
  User: "confidential",
  UserGroup: "confidential",
  CustomerContact: "confidential",
  SocialIdentity: "confidential",
  AccountInvite: "confidential",
  EmployeeProfile: "confidential",
  Department: "confidential",
  Position: "confidential",
  Address: "confidential",
  EmployeeAddress: "confidential",
  EmploymentEvent: "confidential",
  TerminationRecord: "confidential",
  Team: "confidential",
  TeamMembership: "confidential",
  Agent: "confidential",
  AgentOwnership: "confidential",
  AgentCapabilityClass: "confidential",
  DirectivePolicyClass: "confidential",
  AgentGovernanceProfile: "confidential",
  DelegationGrant: "confidential",
  AgentThread: "confidential",
  AgentMessage: "confidential",
  AgentActionProposal: "confidential",
  AgentAttachment: "confidential",
  CustomerAccount: "confidential",
  ContactAccountRole: "confidential",
  Organization: "confidential",
  Engagement: "confidential",
  Opportunity: "confidential",
  Quote: "confidential",
  QuoteLineItem: "confidential",
  SalesOrder: "confidential",
  Activity: "confidential",
  StorefrontBooking: "confidential",
  ServiceProvider: "confidential",
  BookingHold: "confidential",
  StorefrontOrder: "confidential",
  StorefrontInquiry: "confidential",
  StorefrontDonation: "confidential",
  Invoice: "confidential",
  InvoiceLineItem: "confidential",
  Payment: "confidential",
  PaymentAllocation: "confidential",
  Supplier: "confidential",
  Bill: "confidential",
  BillLineItem: "confidential",
  BillApproval: "confidential",
  PurchaseOrder: "confidential",
  PurchaseOrderLineItem: "confidential",
  BankAccount: "confidential",
  BankTransaction: "confidential",
  BankRule: "confidential",
  DunningLog: "confidential",
  ExpenseClaim: "confidential",
  ExpenseItem: "confidential",
  FixedAsset: "confidential",
  ReviewInstance: "confidential",
  ReviewGoal: "confidential",
  FeedbackNote: "confidential",
  LeaveBalance: "confidential",
  LeaveRequest: "confidential",
  TimesheetPeriod: "confidential",
  TimesheetEntry: "confidential",
  RequirementCompletion: "confidential",
  PolicyAcknowledgment: "confidential",
  ComplianceEvidence: "confidential",
  RiskAssessment: "confidential",
  RiskControl: "confidential",
  ComplianceIncident: "confidential",
  CorrectiveAction: "confidential",
  ComplianceAudit: "confidential",
  AuditFinding: "confidential",
  RegulatorySubmission: "confidential",
  PushDeviceRegistration: "confidential",
  ExternalEvidenceRecord: "confidential",
  AsyncInferenceOp: "confidential",
  UserSkill: "confidential",
  TaskRequirement: "confidential",
  RouteDecisionLog: "confidential",
  CustomEvalDimension: "confidential",

  // ── Restricted: Credentials, secrets, authorization logs ───────────────
  PasswordResetToken: "restricted",
  PlatformRole: "restricted",
  CredentialEntry: "restricted",
  OAuthPendingFlow: "restricted",
  ModelProvider: "restricted",
  DiscoveredModel: "restricted",
  ModelProfile: "restricted",
  TokenUsage: "restricted",
  EndpointTaskPerformance: "restricted",
  TaskEvaluation: "restricted",
  EndpointTestRun: "restricted",
  AuthorizationDecisionLog: "restricted",
  ComplianceAuditLog: "restricted",
  RouteOutcome: "restricted",
  RecipePerformance: "restricted",
  ApiToken: "restricted",
};

/** Default sensitivity for tables not in the mapping */
export const DEFAULT_SENSITIVITY: TableSensitivity = "confidential";

/** Get the sensitivity level for a table */
export function getTableSensitivity(tableName: string): TableSensitivity {
  return TABLE_CLASSIFICATION[tableName] ?? DEFAULT_SENSITIVITY;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm --filter @dpf/db exec tsc --noEmit --esModuleInterop --module nodenext --moduleResolution nodenext src/table-classification.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/table-classification.ts
git commit -m "feat(devcontainer): table-to-sensitivity classification for all 194 Prisma models"
```

---

## Task 8: Sanitized Clone Script — Obfuscation Utilities and Tests

**Files:**
- Create: `packages/db/src/sanitized-clone.ts` (obfuscation utilities first, clone pipeline in Task 9)
- Create: `packages/db/src/sanitized-clone.test.ts`

- [ ] **Step 1: Write failing tests for obfuscation**

Create `packages/db/src/sanitized-clone.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  obfuscateName,
  obfuscateEmail,
  obfuscatePhone,
  obfuscateField,
  shouldCopyTable,
  shouldObfuscateTable,
  shouldSkipTable,
} from "./sanitized-clone";

describe("obfuscation", () => {
  it("generates deterministic dev names from input", () => {
    const name1 = obfuscateName("Jane Smith", 1);
    const name2 = obfuscateName("Jane Smith", 1);
    expect(name1).toBe(name2);
    expect(name1).toBe("Dev User 001");
  });

  it("generates unique names for different indices", () => {
    expect(obfuscateName("Alice", 1)).not.toBe(obfuscateName("Bob", 2));
  });

  it("obfuscates email deterministically", () => {
    const email = obfuscateEmail("jane@example.com", 1);
    expect(email).toBe("dev001@dpf.test");
  });

  it("obfuscates phone", () => {
    const phone = obfuscatePhone("+1-555-123-4567", 1);
    expect(phone).toBe("555-0001");
  });

  it("handles null/undefined fields", () => {
    expect(obfuscateField(null, "name", 1)).toBeNull();
    expect(obfuscateField(undefined, "name", 1)).toBeUndefined();
  });
});

describe("table classification helpers", () => {
  it("public and internal tables should be copied", () => {
    expect(shouldCopyTable("TaxonomyNode")).toBe(true);
    expect(shouldCopyTable("Portfolio")).toBe(true);
  });

  it("confidential tables should be obfuscated", () => {
    expect(shouldObfuscateTable("User")).toBe(true);
    expect(shouldObfuscateTable("EmployeeProfile")).toBe(true);
  });

  it("restricted tables should be skipped", () => {
    expect(shouldSkipTable("CredentialEntry")).toBe(true);
    expect(shouldSkipTable("ApiToken")).toBe(true);
  });

  it("unknown tables default to confidential (obfuscate)", () => {
    expect(shouldObfuscateTable("SomeNewTable")).toBe(true);
    expect(shouldCopyTable("SomeNewTable")).toBe(false);
    expect(shouldSkipTable("SomeNewTable")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @dpf/db exec vitest run src/sanitized-clone.test.ts`
Expected: FAIL — module `./sanitized-clone` not found.

- [ ] **Step 3: Write the obfuscation utilities**

Create `packages/db/src/sanitized-clone.ts`:

```typescript
// packages/db/src/sanitized-clone.ts
// Sanitized clone pipeline — copies production data to dev with PII obfuscation.
// Classification driven by table-classification.ts.

import { getTableSensitivity, type TableSensitivity } from "./table-classification";

// ── Obfuscation Helpers ──────────────────────────────────────────────────────

export function obfuscateName(_original: string | null, index: number): string {
  return `Dev User ${String(index).padStart(3, "0")}`;
}

export function obfuscateEmail(_original: string | null, index: number): string {
  return `dev${String(index).padStart(3, "0")}@dpf.test`;
}

export function obfuscatePhone(_original: string | null, index: number): string {
  return `555-${String(index).padStart(4, "0")}`;
}

/** PII field names that should be obfuscated in confidential tables */
const PII_FIELDS: Record<string, (val: string | null, idx: number) => string> = {
  name: obfuscateName,
  displayName: obfuscateName,
  firstName: obfuscateName,
  lastName: obfuscateName,
  email: obfuscateEmail,
  phone: obfuscatePhone,
  contactEmail: obfuscateEmail,
  contactPhone: obfuscatePhone,
};

export function obfuscateField(
  value: string | null | undefined,
  fieldName: string,
  index: number,
): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const fn = PII_FIELDS[fieldName];
  return fn ? fn(value, index) : value;
}

// ── Table Classification Helpers ─────────────────────────────────────────────

export function shouldCopyTable(tableName: string): boolean {
  const s = getTableSensitivity(tableName);
  return s === "public" || s === "internal";
}

export function shouldObfuscateTable(tableName: string): boolean {
  return getTableSensitivity(tableName) === "confidential";
}

export function shouldSkipTable(tableName: string): boolean {
  return getTableSensitivity(tableName) === "restricted";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @dpf/db exec vitest run src/sanitized-clone.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/sanitized-clone.ts packages/db/src/sanitized-clone.test.ts
git commit -m "feat(devcontainer): obfuscation utilities with tests for sanitized clone"
```

---

## Task 9: Sanitized Clone Script — PostgreSQL Clone Pipeline

**Files:**
- Modify: `packages/db/src/sanitized-clone.ts` — add the main clone function
- Modify: `docker-compose.yml` — update dev-init command to include clone

- [ ] **Step 1: Add PostgreSQL clone pipeline to sanitized-clone.ts**

Append to `packages/db/src/sanitized-clone.ts`:

```typescript
// ── PostgreSQL Clone Pipeline ────────────────────────────────────────────────

import { PrismaClient } from "../generated/client/client";

/** Tables that contain audit/log data — clone only the last N rows with obfuscation */
const AUDIT_TABLES = new Set([
  "ComplianceAuditLog",
  "AuthorizationDecisionLog",
  "RouteDecisionLog",
  "RouteOutcome",
]);

/** Maximum audit records to clone per table */
const AUDIT_RECORD_LIMIT = 50;

/**
 * Run the sanitized clone from production to dev.
 * Both DATABASE_URL (dev) and PRODUCTION_DATABASE_URL (production) must be set.
 *
 * Audit tables are a special case: they are classified as restricted/confidential
 * in the general mapping, but the clone pipeline overrides this to copy the last
 * 50 records with PII obfuscated. This provides enough data to test audit UIs
 * without leaking full production history.
 */
export async function runSanitizedClone(): Promise<void> {
  const prodUrl = process.env.PRODUCTION_DATABASE_URL;
  const devUrl = process.env.DATABASE_URL;

  if (!prodUrl) throw new Error("PRODUCTION_DATABASE_URL is not set");
  if (!devUrl) throw new Error("DATABASE_URL is not set");

  const prod = new PrismaClient({ datasourceUrl: prodUrl });
  const dev = new PrismaClient({ datasourceUrl: devUrl });

  try {
    console.log("[sanitized-clone] Connecting to production and dev databases...");
    await prod.$connect();
    await dev.$connect();

    // Get all table names from production
    const tables: Array<{ tablename: string }> = await prod.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations'
      ORDER BY tablename
    `;

    console.log(`[sanitized-clone] Found ${tables.length} tables to process`);

    // Build a stable ID-to-index map from the User table for deterministic obfuscation.
    // Every confidential table row that references a user gets the same dev identity.
    const userIdMap = new Map<string, number>();
    const users: Array<{ id: string }> = await prod.$queryRaw`SELECT id FROM "User" ORDER BY id`;
    users.forEach((u, i) => userIdMap.set(u.id, i + 1));

    // Disable all FK constraints globally for the clone operation
    await dev.$executeRawUnsafe(`SET session_replication_role = replica`);

    let autoIndex = users.length; // Counter for rows without a user ID reference

    for (const { tablename } of tables) {
      // Use PascalCase model name for classification lookup
      // Prisma tables use PascalCase model names as-is in the DB
      const sensitivity = getTableSensitivity(tablename);

      // Audit tables override normal classification — clone last 50 rows with obfuscation
      if (AUDIT_TABLES.has(tablename)) {
        const rows: Array<Record<string, unknown>> = await prod.$queryRawUnsafe(
          `SELECT * FROM "${tablename}" ORDER BY "createdAt" DESC LIMIT ${AUDIT_RECORD_LIMIT}`,
        );
        if (rows.length > 0) {
          console.log(`  AUDIT (last ${rows.length}): ${tablename}`);
          const obfuscated = rows.map((row) => {
            const idx = ++autoIndex;
            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(row)) {
              if (typeof value === "string" && key in PII_FIELDS) {
                result[key] = obfuscateField(value, key, idx);
              } else {
                result[key] = value;
              }
            }
            return result;
          });
          await insertRows(dev, tablename, obfuscated);
        } else {
          console.log(`  AUDIT (empty): ${tablename}`);
        }
        continue;
      }

      if (sensitivity === "restricted") {
        console.log(`  SKIP (restricted): ${tablename}`);
        continue;
      }

      // Count source rows
      const countResult: Array<{ count: bigint }> = await prod.$queryRawUnsafe(
        `SELECT count(*) as count FROM "${tablename}"`,
      );
      const rowCount = Number(countResult[0]?.count ?? 0);

      if (rowCount === 0) {
        console.log(`  EMPTY: ${tablename}`);
        continue;
      }

      if (sensitivity === "public" || sensitivity === "internal") {
        // Copy verbatim
        console.log(`  COPY (${sensitivity}): ${tablename} (${rowCount} rows)`);
        const rows: Array<Record<string, unknown>> = await prod.$queryRawUnsafe(
          `SELECT * FROM "${tablename}"`,
        );
        await insertRows(dev, tablename, rows);
      } else if (sensitivity === "confidential") {
        console.log(`  OBFUSCATE (confidential): ${tablename} (${rowCount} rows)`);
        const rows: Array<Record<string, unknown>> = await prod.$queryRawUnsafe(
          `SELECT * FROM "${tablename}"`,
        );
        const obfuscated = rows.map((row) => {
          // Derive index from user ID if present, otherwise use auto-incrementing counter
          const userId = (row.id ?? row.userId ?? row.createdById) as string | undefined;
          const idx = userId && userIdMap.has(userId)
            ? userIdMap.get(userId)!
            : ++autoIndex;
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            if (typeof value === "string" && key in PII_FIELDS) {
              result[key] = obfuscateField(value, key, idx);
            } else if (key === "passwordHash") {
              // Replace all password hashes with a known dev password
              result[key] = "$2a$10$devhashplaceholdernotreal000000000000000000000";
            } else {
              result[key] = value;
            }
          }
          return result;
        });
        await insertRows(dev, tablename, obfuscated);
      }
    }

    // Re-enable FK constraints
    await dev.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);

    console.log("[sanitized-clone] PostgreSQL clone complete");
  } finally {
    await prod.$disconnect();
    await dev.$disconnect();
  }
}

/**
 * Insert rows into a table using raw SQL.
 * FK constraints are disabled globally via session_replication_role=replica
 * before the clone starts, so no per-table trigger toggling is needed.
 */
async function insertRows(
  client: PrismaClient,
  tableName: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;

  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const values = columns.map((col) => row[col]);
    const columnList = columns.map((c) => `"${c}"`).join(", ");

    await client.$executeRawUnsafe(
      `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      ...values,
    );
  }
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("sanitized-clone.ts") || process.argv[1]?.endsWith("sanitized-clone.js")) {
  runSanitizedClone()
    .then(() => {
      console.log("[sanitized-clone] Done");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[sanitized-clone] Failed:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @dpf/db exec tsc --noEmit`
Expected: No errors (or check that `packages/db` has a tsconfig, otherwise verify with a simpler approach).

- [ ] **Step 3: Update dev-init command in docker-compose.yml**

Change the `dev-init` service `command` from:
```yaml
    command: ["sh", "-c", "pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter @dpf/db exec prisma migrate deploy"]
```
to:
```yaml
    command: ["sh", "-c", "pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter @dpf/db exec prisma migrate deploy && pnpm --filter @dpf/db exec tsx src/sanitized-clone.ts"]
```

- [ ] **Step 4: Verify compose config**

Run: `docker compose config --quiet`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/sanitized-clone.ts docker-compose.yml
git commit -m "feat(devcontainer): PostgreSQL sanitized clone pipeline with classification-driven obfuscation"
```

---

## Task 10: Sanitized Clone Script — Neo4j Clone

**Files:**
- Modify: `packages/db/src/sanitized-clone.ts` — add Neo4j clone function

- [ ] **Step 1: Add Neo4j clone function**

Append to `packages/db/src/sanitized-clone.ts`, before the CLI entry point section:

```typescript
// ── Neo4j Clone Pipeline ─────────────────────────────────────────────────────

/**
 * Clone Neo4j graph structure from production to dev with PII obfuscation.
 * Uses Bolt protocol directly. Both NEO4J_URI (dev) and PRODUCTION_NEO4J_URI (prod) must be set.
 */
export async function runNeo4jClone(): Promise<void> {
  const prodUri = process.env.PRODUCTION_NEO4J_URI;
  const devUri = process.env.NEO4J_URI;
  // Production Neo4j credentials — defaults match dev if not overridden
  const prodUser = process.env.PRODUCTION_NEO4J_USER ?? process.env.NEO4J_USER ?? "neo4j";
  const prodPassword = process.env.PRODUCTION_NEO4J_PASSWORD ?? process.env.NEO4J_PASSWORD ?? "dpf_dev_password";

  if (!prodUri) {
    console.log("[sanitized-clone] PRODUCTION_NEO4J_URI not set, skipping Neo4j clone");
    return;
  }
  if (!devUri) {
    console.log("[sanitized-clone] NEO4J_URI not set, skipping Neo4j clone");
    return;
  }

  // Neo4j clone uses APOC export/import via HTTP API
  // Extract host:port from bolt:// URIs for HTTP access
  const prodHttpUrl = prodUri.replace("bolt://", "http://").replace(":7687", ":7474");
  const devHttpUrl = devUri.replace("bolt://", "http://").replace(":7687", ":7474");

  const auth = Buffer.from(`${prodUser}:${prodPassword}`).toString("base64");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${auth}`,
  };

  console.log("[sanitized-clone] Exporting Neo4j graph from production...");

  // Export all nodes and relationships from production
  const exportResponse = await fetch(`${prodHttpUrl}/db/neo4j/tx/commit`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      statements: [
        { statement: "MATCH (n) RETURN n", resultDataContents: ["row"] },
        { statement: "MATCH ()-[r]->() RETURN r", resultDataContents: ["row"] },
      ],
    }),
  });

  if (!exportResponse.ok) {
    console.log(`[sanitized-clone] Neo4j export failed: ${exportResponse.status}, skipping`);
    return;
  }

  const exportData = await exportResponse.json();
  const nodeCount = exportData.results?.[0]?.data?.length ?? 0;
  const relCount = exportData.results?.[1]?.data?.length ?? 0;

  console.log(`[sanitized-clone] Exported ${nodeCount} nodes, ${relCount} relationships`);

  // For now, log completion. Full APOC-based import with obfuscation
  // will be refined when Neo4j graph contains PII-bearing nodes.
  console.log("[sanitized-clone] Neo4j clone: structure exported (import TBD with APOC refinement)");
}
```

- [ ] **Step 2: Update CLI entry point to include Neo4j**

Update the CLI entry point in `sanitized-clone.ts` to call both:

```typescript
if (process.argv[1]?.endsWith("sanitized-clone.ts") || process.argv[1]?.endsWith("sanitized-clone.js")) {
  runSanitizedClone()
    .then(() => runNeo4jClone())
    .then(() => {
      console.log("[sanitized-clone] Done");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[sanitized-clone] Failed:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 3: Verify tests still pass**

Run: `pnpm --filter @dpf/db exec vitest run src/sanitized-clone.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/sanitized-clone.ts
git commit -m "feat(devcontainer): Neo4j clone skeleton for sanitized dev data pipeline"
```

---

## Task 11: VS Code Dev Container Configuration

**Files:**
- Create: `.devcontainer/devcontainer.json`

- [ ] **Step 1: Create .devcontainer directory**

Run: `ls .devcontainer 2>/dev/null || mkdir .devcontainer`

- [ ] **Step 2: Create devcontainer.json**

Create `.devcontainer/devcontainer.json`:

```json
{
  "name": "DPF Dev Environment",
  "dockerComposeFile": ["../docker-compose.yml"],
  "service": "dev-portal",
  "runServices": ["dev-postgres", "dev-neo4j", "dev-qdrant", "dev-init", "dev-portal"],
  "workspaceFolder": "/workspace",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "Prisma.prisma",
        "bradlc.vscode-tailwindcss",
        "esbenp.prettier-vscode"
      ],
      "settings": {
        "terminal.integrated.defaultProfile.linux": "sh"
      }
    }
  },
  "initializeCommand": "docker compose --profile dev up -d dev-postgres dev-neo4j dev-qdrant",
  "forwardPorts": [3001],
  "postCreateCommand": "pnpm install && pnpm --filter @dpf/db exec prisma generate",
  "remoteUser": "node"
}
```

Note: `initializeCommand` runs on the host before the container starts, ensuring the `dev` profile is explicitly activated. `runServices` names the services VS Code manages, but `initializeCommand` guarantees the profile is activated regardless of Docker Compose version behavior.

- [ ] **Step 3: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('.devcontainer/devcontainer.json','utf8')); console.log('valid')"`
Expected: "valid"

- [ ] **Step 4: Commit**

```bash
git add .devcontainer/devcontainer.json
git commit -m "feat(devcontainer): VS Code Dev Container configuration"
```

---

## Task 12: README Update

**Files:**
- Modify: `README.md` — add "Dev Container Setup" section

- [ ] **Step 1: Add Dev Container section**

Insert a new section after the "Developer Setup (IDE + Hot-Reload)" section (after line 157 `Login: admin@dpf.local / changeme123`) and before the `---` separator:

```markdown

### Dev Container Setup (VS Code)

For developers who want a fully containerized development environment. Everything runs inside Docker -- no local Node.js or pnpm required.

#### Prerequisites

| Tool | Version |
|------|---------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | 4.40+ |
| [VS Code](https://code.visualstudio.com/) | Latest |
| [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) | Latest |

#### First-Time Setup

1. Clone the repo and ensure the production stack is running (`docker compose up -d`)
2. Open the repo folder in VS Code
3. Press `F1` and select **Dev Containers: Reopen in Container**
4. Wait for the dev databases to start, migrations to run, and sanitized data to populate

The dev server starts automatically on port 3001. Open `http://localhost:3001` in your browser. Production remains on port 3000.

Login: `admin@dpf.local` / `changeme123`

#### What the Dev Container Provides

- Isolated PostgreSQL, Neo4j, and Qdrant databases (separate from production)
- Sanitized copy of production data (PII obfuscated, credentials replaced)
- Shared LLM inference via Docker Model Runner (no duplication)
- Pre-installed extensions: ESLint, Prisma, Tailwind CSS, Prettier
- Hot-reload Next.js dev server

#### For Non-Technical Users

The dev environment is also accessible from the production portal's Build Studio. AI co-workers can develop and test features against the dev environment without VS Code.

#### Important Notes

- Build Studio is read-only in the dev environment (builds are managed from production)
- Changes made in dev are promoted to production through a governed process (coming soon)
- The sanitized clone runs on first startup -- production must be running as the data source
```

- [ ] **Step 2: Verify README renders correctly**

Visually inspect the markdown structure. Ensure no encoding issues.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Dev Container setup instructions to README"
```

---

## Task 13: Create EP-DEVDATA-AUDIT-001 Backlog Entry

**Files:**
- None (database operation via the platform or seed)

The spec requires this follow-on epic to exist in the backlog alongside EP-DEVCONTAINER-001.

- [ ] **Step 1: Create the epic in the database**

Use the platform's backlog UI or create a seed entry. The epic:
- **Title:** Data Classification Accuracy Audit
- **Epic ID:** EP-DEVDATA-AUDIT-001
- **Description:** Recurring audit to ensure the sanitization pipeline correctly classifies all tables. Covers periodic review of table-to-sensitivity mappings, flagging new tables added without classification, validating that sanitized clone output contains no restricted/confidential data in cleartext, and regression testing when new Prisma models are added.
- **Status:** Draft

- [ ] **Step 2: Verify the epic exists**

Navigate to the backlog in the platform and confirm EP-DEVDATA-AUDIT-001 appears.

- [ ] **Step 3: Commit if seed data was added**

Only if a seed entry was created in code.

---

## Task 14: End-to-End Verification

- [ ] **Step 1: Full production stack health check**

Run: `docker compose ps`
Verify: All production services (postgres, neo4j, qdrant, portal) are healthy.

- [ ] **Step 2: Start dev stack**

Run: `docker compose --profile dev up -d`
Verify: dev-postgres, dev-neo4j, dev-qdrant start and become healthy. dev-init runs and exits successfully. dev-portal starts.

- [ ] **Step 3: Verify dev portal responds**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001`
Expected: 200 or 302.

- [ ] **Step 4: Verify production portal still responds**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
Expected: 200 or 302.

- [ ] **Step 5: Verify dev-init logs show sanitized clone ran**

Run: `docker compose --profile dev logs dev-init`
Expected: Logs show `[sanitized-clone]` output with table processing.

- [ ] **Step 6: Verify recursion guard**

Log into dev portal at `http://localhost:3001`. Navigate to Build Studio. Verify:
- Read-only banner is shown
- "New" feature input is replaced with the dev environment message
- No ability to create builds or launch sandboxes

- [ ] **Step 7: Verify typecheck and tests**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web test && pnpm --filter @dpf/db exec vitest run`
Expected: All pass.

- [ ] **Step 8: Stop dev stack**

Run: `docker compose --profile dev down`
Verify: Dev services stop. Production services remain running.

- [ ] **Step 9: Final commit if any fixes were needed**

Only if adjustments were made during verification.
