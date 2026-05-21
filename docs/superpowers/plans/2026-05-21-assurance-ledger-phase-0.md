# Assurance Ledger Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Assurance Ledger Phase 0 foundation: finding-substrate reconciliation guard, shared assurance adapter contracts, deterministic finding normalization, and capability/readiness checks before any SBOM or scanner UI claims ship.

**Architecture:** Keep Phase 0 additive and refactor-first. The existing regex diff scanner remains API-compatible, but it is wrapped by a shared assurance adapter contract so later Syft, Grype, OSV, Trivy, and commercial adapters do not invent their own output shapes. Readiness checks stay separate from scan execution so coworkers and UI can explain unavailable SBOM/security capabilities honestly.

**Tech Stack:** Next.js 16 monorepo, TypeScript, Vitest, Prisma schema grounding, DPF MCP backlog, Build Studio pre-PR gates.

---

## 1. Live Records

Created through the governed DPF MCP `/api/mcp/v1` surface on 2026-05-21 after live overlap sweep.

| Record | Purpose |
|--------|---------|
| `EP-ASSURANCE-LEDGER` | Parent epic for the reviewed Assurance Ledger spec. |
| `BI-ASSURANCE-P0-01` | Phase 0 finding-substrate reconciliation and debt guard. |
| `BI-ASSURANCE-P0-02` | Phase 0 adapter contract and finding normalizer foundation. |
| `BI-ASSURANCE-P0-03` | Phase 0 grant and adapter readiness resolver. |
| `BI-ASSURANCE-P1-01` | Phase 1 CycloneDX BOM persistence for Build Studio web workspace. |
| `BI-ASSURANCE-P1-02` | Phase 1 read-only vulnerability adapter and Build Studio Assurance Gate. |
| `BI-REFACTOR-CC46703A` | Technical debt item for unifying finding-shaped models before Phase 2. |

Related spec:

- `docs/superpowers/specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md`

## 2. File Structure

Phase 0 creates no Prisma migration and no UI. It prepares contracts and guards only.

| File | Responsibility |
|------|----------------|
| Create `apps/web/lib/assurance/types.ts` | Closed string unions and shared interfaces for scopes, findings, adapters, artifacts, and readiness. |
| Create `apps/web/lib/assurance/finding-key.ts` | Deterministic `findingKey` helper from spec section 6.4.1. |
| Create `apps/web/lib/assurance/finding-key.test.ts` | Stable-key and weak-identifier tests. |
| Create `apps/web/lib/assurance/adapter-contract.ts` | Adapter interface used by current and future assurance scanners. |
| Create `apps/web/lib/assurance/diff-security-adapter.ts` | Wrapper around `apps/web/lib/integrate/security-scan.ts`. |
| Create `apps/web/lib/assurance/diff-security-adapter.test.ts` | Ensures current regex scanner output normalizes without changing existing scanner behavior. |
| Create `apps/web/lib/assurance/readiness.ts` | Capability/readiness resolver for grants, runtime tools, token scope, and approved adapters. |
| Create `apps/web/lib/assurance/readiness.test.ts` | Covers aspirational, unmapped, denied, and unapproved states. |
| Modify `apps/web/lib/integrate/pre-pr-gates.ts` | Optional final step: include normalized assurance summary as metadata while preserving current gate result shape. |
| Modify `apps/web/lib/integrate/pre-pr-gates.test.ts` | Only if `pre-pr-gates.ts` receives metadata. Existing behavior must continue passing. |

## 3. Current Grounding

Known current files:

- `apps/web/lib/integrate/security-scan.ts` exposes `scanDiffForSecurityIssues(diff)` and `formatScanForDisplay(result)`.
- `apps/web/lib/security-scan.ts` is a shim re-exporting `./integrate/security-scan`.
- `apps/web/lib/integrate/pre-pr-gates.ts` imports `scanDiffForSecurityIssues` and expects the existing `SecurityScanResult`.
- `apps/web/lib/tak/agent-grants.ts` exports `getToolGrantMapping()` and `isToolAllowedByGrants()`.
- `register_tech_debt` exists as an MCP tool mapped to `backlog_write`; the reviewed spec debt was filed as `BI-REFACTOR-CC46703A`.

## 4. Implementation Tasks

### Task 1: Branch and Review Guard

**Files:**
- Read: `docs/superpowers/specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md`
- Read: `apps/web/lib/integrate/security-scan.ts`
- Read: `apps/web/lib/tak/agent-grants.ts`

- [ ] **Step 1: Create the implementation worktree**

Run from `D:\DPF`:

```powershell
git fetch origin
git worktree add D:\DPF\.worktrees\assurance-ledger-phase-0 -b feat/assurance-ledger-phase-0 origin/main
Set-Location D:\DPF\.worktrees\assurance-ledger-phase-0
.\scripts\sync-mcp-worktrees.ps1
```

Expected: new worktree on `feat/assurance-ledger-phase-0`, not `main`, with MCP config linked.

- [ ] **Step 2: Confirm branch guard**

Run:

```powershell
git status --short --branch
git branch --show-current
```

Expected:

```text
## feat/assurance-ledger-phase-0...origin/main
feat/assurance-ledger-phase-0
```

- [ ] **Step 3: Reconfirm finding-shaped models before coding**

Run:

```powershell
rg -n "model (PortfolioQualityIssue|AuditFinding|WikiLintFinding|EaConformanceIssue|LicenseReadinessIssue|PlatformIssueReport)" packages/db/prisma/schema.prisma
```

Expected: all six models are found. If a model moved or was renamed, update the notes in this plan before writing code.

### Task 2: Add Assurance Types and Stable Finding Keys

**Files:**
- Create: `apps/web/lib/assurance/types.ts`
- Create: `apps/web/lib/assurance/finding-key.ts`
- Create: `apps/web/lib/assurance/finding-key.test.ts`

- [ ] **Step 1: Write the failing key tests**

Create `apps/web/lib/assurance/finding-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFindingKey, normalizeVendorIdentifier } from "./finding-key";

describe("createFindingKey", () => {
  it("creates a deterministic 24 character hex key", () => {
    const input = {
      adapterKey: "diff-security",
      findingKind: "vulnerability",
      affectedType: "bom-component",
      affectedId: "pkg:npm/react@19.0.0",
      vendorIdentifier: "CVE-2026-0001",
    } as const;

    expect(createFindingKey(input)).toBe(createFindingKey(input));
    expect(createFindingKey(input)).toMatch(/^[a-f0-9]{24}$/);
  });

  it("changes when the affected object changes", () => {
    const base = {
      adapterKey: "diff-security",
      findingKind: "policy-violation",
      affectedType: "source-file",
      vendorIdentifier: "xss",
    } as const;

    expect(createFindingKey({ ...base, affectedId: "a.tsx" })).not.toBe(
      createFindingKey({ ...base, affectedId: "b.tsx" }),
    );
  });
});

describe("normalizeVendorIdentifier", () => {
  it("marks scanner identifiers as strong", () => {
    expect(normalizeVendorIdentifier("CVE-2026-0001", "fallback")).toEqual({
      identifier: "CVE-2026-0001",
      stability: "strong",
    });
  });

  it("uses a weak fallback for scanners without stable identifiers", () => {
    const result = normalizeVendorIdentifier("", "Direct innerHTML assignment");
    expect(result.identifier).toMatch(/^weak:/);
    expect(result.stability).toBe("weak");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/assurance/finding-key.test.ts
```

Expected: fail because `apps/web/lib/assurance/finding-key.ts` does not exist.

- [ ] **Step 3: Add shared types**

Create `apps/web/lib/assurance/types.ts`:

```ts
export const ASSURANCE_FINDING_KINDS = [
  "vulnerability",
  "license",
  "malicious-package",
  "policy-violation",
  "provenance",
  "configuration-drift",
  "missing-patch",
  "unsupported-component",
  "maintainer-risk",
] as const;

export type AssuranceFindingKind = (typeof ASSURANCE_FINDING_KINDS)[number];

export const ASSURANCE_AFFECTED_TYPES = [
  "source-file",
  "bom-component",
  "inventory-entity",
  "build-artifact-revision",
  "release-bundle",
] as const;

export type AssuranceAffectedType = (typeof ASSURANCE_AFFECTED_TYPES)[number];

export const ASSURANCE_POLICY_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type AssurancePolicySeverity = (typeof ASSURANCE_POLICY_SEVERITIES)[number];

export const ASSURANCE_RELEASE_IMPACTS = ["block", "warn", "track", "none"] as const;
export type AssuranceReleaseImpact = (typeof ASSURANCE_RELEASE_IMPACTS)[number];

export const ASSURANCE_REACHABILITY = ["reachable", "not-reachable", "unknown"] as const;
export type AssuranceReachability = (typeof ASSURANCE_REACHABILITY)[number];

export const ASSURANCE_EXPOSURE = ["external", "internal", "lab", "unknown"] as const;
export type AssuranceExposure = (typeof ASSURANCE_EXPOSURE)[number];

export type FindingIdentifierStability = "strong" | "weak";

export interface FindingKeyInput {
  adapterKey: string;
  findingKind: AssuranceFindingKind;
  affectedType: AssuranceAffectedType;
  affectedId: string;
  vendorIdentifier: string;
}

export interface NormalizedAssuranceFinding extends FindingKeyInput {
  findingKey: string;
  title: string;
  description?: string;
  sourceSeverity?: string;
  policySeverity: AssurancePolicySeverity;
  releaseImpact: AssuranceReleaseImpact;
  reachability: AssuranceReachability;
  exposure: AssuranceExposure;
  identifierStability: FindingIdentifierStability;
  evidence: Record<string, unknown>;
  remediationHint: Record<string, unknown>;
}
```

- [ ] **Step 4: Implement finding key helper**

Create `apps/web/lib/assurance/finding-key.ts`:

```ts
import crypto from "crypto";
import type { FindingIdentifierStability, FindingKeyInput } from "./types";

export function createFindingKey(input: FindingKeyInput): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        input.adapterKey,
        input.findingKind,
        input.affectedType,
        input.affectedId,
        input.vendorIdentifier,
      ].join("::"),
    )
    .digest("hex")
    .slice(0, 24);
}

export function normalizeVendorIdentifier(
  vendorIdentifier: string | null | undefined,
  fallbackText: string,
): { identifier: string; stability: FindingIdentifierStability } {
  const trimmed = vendorIdentifier?.trim();
  if (trimmed) return { identifier: trimmed, stability: "strong" };

  const fallbackHash = crypto
    .createHash("sha256")
    .update(fallbackText.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);

  return { identifier: `weak:${fallbackHash}`, stability: "weak" };
}
```

- [ ] **Step 5: Verify tests pass**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/assurance/finding-key.test.ts
```

Expected: both suites pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/lib/assurance/types.ts apps/web/lib/assurance/finding-key.ts apps/web/lib/assurance/finding-key.test.ts
git commit -s -m "feat(assurance): add finding key foundation"
```

### Task 3: Wrap Current Security Scan as an Assurance Adapter

**Files:**
- Create: `apps/web/lib/assurance/adapter-contract.ts`
- Create: `apps/web/lib/assurance/diff-security-adapter.ts`
- Create: `apps/web/lib/assurance/diff-security-adapter.test.ts`

- [ ] **Step 1: Write failing adapter test**

Create `apps/web/lib/assurance/diff-security-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDiffSecurityAdapter } from "./diff-security-adapter";

describe("createDiffSecurityAdapter", () => {
  it("normalizes critical regex scanner findings into assurance findings", async () => {
    const adapter = createDiffSecurityAdapter();
    const output = await adapter.run({
      scope: { type: "source-file", id: "apps/web/app/page.tsx" },
      input: {
        diff: [
          "diff --git a/apps/web/app/page.tsx b/apps/web/app/page.tsx",
          "@@ -1,0 +1,1 @@",
          "+const html = { __html: userInput }; return <div dangerouslySetInnerHTML={html} />;",
        ].join("\n"),
      },
    });

    expect(output.status).toBe("failed");
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]).toMatchObject({
      adapterKey: "diff-security",
      findingKind: "policy-violation",
      affectedType: "source-file",
      affectedId: "apps/web/app/page.tsx",
      policySeverity: "critical",
      releaseImpact: "block",
      reachability: "unknown",
      exposure: "unknown",
    });
    expect(output.findings[0]?.findingKey).toMatch(/^[a-f0-9]{24}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/assurance/diff-security-adapter.test.ts
```

Expected: fail because the adapter files do not exist.

- [ ] **Step 3: Add adapter contract**

Create `apps/web/lib/assurance/adapter-contract.ts`:

```ts
import type { AssuranceAffectedType, NormalizedAssuranceFinding } from "./types";

export interface AssuranceRunScope {
  type: AssuranceAffectedType;
  id: string;
}

export interface AssuranceRunInput {
  scope: AssuranceRunScope;
  input: Record<string, unknown>;
}

export interface AssuranceArtifact {
  artifactKind: "raw-output" | "bom" | "summary";
  name: string;
  digest?: string;
  value: unknown;
}

export interface AssuranceRunOutput {
  status: "passed" | "failed" | "partial" | "error";
  summary: Record<string, unknown>;
  findings: NormalizedAssuranceFinding[];
  artifacts: AssuranceArtifact[];
}

export interface AssuranceAdapter {
  adapterKey: string;
  adapterVersion: string;
  supportedScopes: AssuranceAffectedType[];
  run(input: AssuranceRunInput): Promise<AssuranceRunOutput>;
}
```

- [ ] **Step 4: Implement diff security adapter**

Create `apps/web/lib/assurance/diff-security-adapter.ts`:

```ts
import { scanDiffForSecurityIssues, type ScanFinding } from "@/lib/integrate/security-scan";
import type { AssuranceAdapter, AssuranceRunInput, AssuranceRunOutput } from "./adapter-contract";
import { createFindingKey, normalizeVendorIdentifier } from "./finding-key";
import type { AssurancePolicySeverity, AssuranceReleaseImpact, NormalizedAssuranceFinding } from "./types";

const ADAPTER_KEY = "diff-security";
const ADAPTER_VERSION = "1";

function mapSeverity(severity: ScanFinding["severity"]): AssurancePolicySeverity {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "medium";
  return "info";
}

function mapReleaseImpact(severity: ScanFinding["severity"]): AssuranceReleaseImpact {
  if (severity === "critical") return "block";
  if (severity === "warning") return "warn";
  return "track";
}

function normalizeFinding(finding: ScanFinding): NormalizedAssuranceFinding {
  const affectedId = finding.file || "unknown-source-file";
  const vendor = normalizeVendorIdentifier(finding.category, `${finding.file}:${finding.line}:${finding.message}`);
  const keyInput = {
    adapterKey: ADAPTER_KEY,
    findingKind: "policy-violation" as const,
    affectedType: "source-file" as const,
    affectedId,
    vendorIdentifier: vendor.identifier,
  };

  return {
    ...keyInput,
    findingKey: createFindingKey(keyInput),
    title: finding.message,
    description: finding.evidence,
    sourceSeverity: finding.severity,
    policySeverity: mapSeverity(finding.severity),
    releaseImpact: mapReleaseImpact(finding.severity),
    reachability: "unknown",
    exposure: "unknown",
    identifierStability: vendor.stability,
    evidence: {
      file: finding.file,
      line: finding.line,
      category: finding.category,
      snippet: finding.evidence,
    },
    remediationHint: {},
  };
}

export function createDiffSecurityAdapter(): AssuranceAdapter {
  return {
    adapterKey: ADAPTER_KEY,
    adapterVersion: ADAPTER_VERSION,
    supportedScopes: ["source-file", "build-artifact-revision", "release-bundle"],
    async run(input: AssuranceRunInput): Promise<AssuranceRunOutput> {
      const diff = typeof input.input.diff === "string" ? input.input.diff : "";
      const result = scanDiffForSecurityIssues(diff);
      return {
        status: result.passed ? "passed" : "failed",
        summary: {
          scannedFiles: result.scannedFiles,
          criticalCount: result.criticalCount,
          warningCount: result.warningCount,
          summary: result.summary,
        },
        findings: result.findings.map(normalizeFinding),
        artifacts: [
          {
            artifactKind: "summary",
            name: "diff-security-scan-summary",
            value: result,
          },
        ],
      };
    },
  };
}
```

- [ ] **Step 5: Verify adapter test passes**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/assurance/diff-security-adapter.test.ts
```

Expected: pass.

- [ ] **Step 6: Verify existing pre-PR gate tests still pass**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/pre-pr-gates.test.ts
```

Expected: pass. If this fails, the adapter changed scanner behavior and must be fixed before commit.

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/web/lib/assurance/adapter-contract.ts apps/web/lib/assurance/diff-security-adapter.ts apps/web/lib/assurance/diff-security-adapter.test.ts
git commit -s -m "feat(assurance): wrap diff scanner as adapter"
```

### Task 4: Add Grant and Adapter Readiness Resolver

**Files:**
- Create: `apps/web/lib/assurance/readiness.ts`
- Create: `apps/web/lib/assurance/readiness.test.ts`

- [ ] **Step 1: Write failing readiness tests**

Create `apps/web/lib/assurance/readiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAssuranceReadiness } from "./readiness";

describe("resolveAssuranceReadiness", () => {
  it("returns ready when grant, runtime tool, token scope, and adapter approval all pass", () => {
    expect(
      resolveAssuranceReadiness({
        toolName: "create_backlog_item",
        agentGrants: ["backlog_write"],
        runtimeTools: ["create_backlog_item"],
        tokenScope: "write",
        requiredScope: "write",
        adapterKey: "diff-security",
        approvedAdapters: ["diff-security"],
      }),
    ).toEqual({ ready: true, reasons: [] });
  });

  it("reports unmapped runtime tools", () => {
    expect(
      resolveAssuranceReadiness({
        toolName: "vulnerability_scan",
        agentGrants: ["vulnerability_scan"],
        runtimeTools: ["create_backlog_item"],
        tokenScope: "write",
        requiredScope: "write",
        adapterKey: "grype",
        approvedAdapters: ["grype"],
      }).reasons,
    ).toContain("tool_not_mapped_to_grant");
  });

  it("reports missing runtime tool and unapproved adapter separately", () => {
    const result = resolveAssuranceReadiness({
      toolName: "evaluate_tool",
      agentGrants: ["tool_evaluation_create"],
      runtimeTools: [],
      tokenScope: "read",
      requiredScope: "write",
      adapterKey: "black-duck",
      approvedAdapters: [],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      "runtime_tool_unavailable",
      "insufficient_token_scope",
      "adapter_not_approved",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/assurance/readiness.test.ts
```

Expected: fail because `readiness.ts` does not exist.

- [ ] **Step 3: Implement readiness resolver**

Create `apps/web/lib/assurance/readiness.ts`:

```ts
import { getToolGrantMapping, isToolAllowedByGrants } from "@/lib/tak/agent-grants";

export type TokenScope = "read" | "write" | "admin";

export type AssuranceReadinessReason =
  | "tool_not_mapped_to_grant"
  | "agent_grant_missing"
  | "runtime_tool_unavailable"
  | "insufficient_token_scope"
  | "adapter_not_approved";

export interface AssuranceReadinessInput {
  toolName: string;
  agentGrants: string[];
  runtimeTools: string[];
  tokenScope: TokenScope;
  requiredScope: TokenScope;
  adapterKey?: string;
  approvedAdapters?: string[];
}

export interface AssuranceReadinessResult {
  ready: boolean;
  reasons: AssuranceReadinessReason[];
}

const TOKEN_SCOPE_RANK: Record<TokenScope, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

export function resolveAssuranceReadiness(input: AssuranceReadinessInput): AssuranceReadinessResult {
  const reasons: AssuranceReadinessReason[] = [];
  const grantMapping = getToolGrantMapping();

  if (!grantMapping[input.toolName]) {
    reasons.push("tool_not_mapped_to_grant");
  } else if (!isToolAllowedByGrants(input.toolName, input.agentGrants)) {
    reasons.push("agent_grant_missing");
  }

  if (!input.runtimeTools.includes(input.toolName)) {
    reasons.push("runtime_tool_unavailable");
  }

  if (TOKEN_SCOPE_RANK[input.tokenScope] < TOKEN_SCOPE_RANK[input.requiredScope]) {
    reasons.push("insufficient_token_scope");
  }

  if (input.adapterKey && !(input.approvedAdapters ?? []).includes(input.adapterKey)) {
    reasons.push("adapter_not_approved");
  }

  return { ready: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/assurance/readiness.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/assurance/readiness.ts apps/web/lib/assurance/readiness.test.ts
git commit -s -m "feat(assurance): add readiness resolver"
```

### Task 5: Optional Pre-PR Gate Metadata Hook

**Files:**
- Modify: `apps/web/lib/integrate/pre-pr-gates.ts`
- Modify: `apps/web/lib/integrate/pre-pr-gates.test.ts`

Only do this task if Tasks 2-4 pass cleanly. This task must not change gate decisions.

- [ ] **Step 1: Inspect current gate result type**

Run:

```powershell
Get-Content apps\web\lib\integrate\pre-pr-gates.ts -TotalCount 140
```

Expected: find the `PrePRGateReport` or equivalent result object that already includes `securityScan`.

- [ ] **Step 2: Add metadata without changing existing fields**

Modify the pre-PR report type to add:

```ts
assurance?: {
  adapterKey: string;
  findingCount: number;
  releaseBlockCount: number;
};
```

In the security gate path, compute it with `createDiffSecurityAdapter()`:

```ts
const adapter = createDiffSecurityAdapter();
const assuranceOutput = await adapter.run({
  scope: { type: "release-bundle", id: "pre-pr-diff" },
  input: { diff },
});
```

If the gate function is currently synchronous, do not convert the public API in this task. Instead skip this task and record why in the backlog item evidence. The reviewed spec requires async jobs for full assurance; this optional metadata hook must not create a risky sync/async churn inside pre-PR gates.

- [ ] **Step 3: Run existing tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/pre-pr-gates.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit only if the hook was added**

Run:

```powershell
git add apps/web/lib/integrate/pre-pr-gates.ts apps/web/lib/integrate/pre-pr-gates.test.ts
git commit -s -m "feat(assurance): expose pre-pr gate assurance metadata"
```

### Task 6: Final Verification and Evidence

**Files:**
- Update: none unless evidence notes are added to the backlog through MCP.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/assurance/finding-key.test.ts apps/web/lib/assurance/diff-security-adapter.test.ts apps/web/lib/assurance/readiness.test.ts apps/web/lib/integrate/pre-pr-gates.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: pass.

- [ ] **Step 3: Check branch status**

Run:

```powershell
git status --short --branch
git log --oneline --decorate -5
```

Expected: clean branch with DCO-signed commits.

- [ ] **Step 4: Push**

Run:

```powershell
git push -u origin feat/assurance-ledger-phase-0
```

Expected: branch is pushed. Do not open a PR until the relevant build gate has passed and the branch is ready to merge.

- [ ] **Step 5: Record MCP evidence**

Use `record_execution_evidence` on:

- `BI-ASSURANCE-P0-02` for adapter/normalizer tests.
- `BI-ASSURANCE-P0-03` for readiness tests.
- `BI-ASSURANCE-P0-01` for the finding-substrate debt linkage.

Evidence summary examples:

```text
Focused Phase 0 assurance tests passed: finding-key, diff-security-adapter, readiness, pre-pr-gates.
```

```text
Typecheck passed for web package after Phase 0 assurance foundation.
```

## 5. Self-Review

- Spec coverage: Phase 0 covers finding-substrate reconciliation guard, adapter contract, finding key, existing diff scanner wrapper, and readiness resolver. Phase 1 BOM persistence and vulnerability adapter are explicitly represented as backlog items but not implemented in this plan.
- Placeholder scan: no banned placeholder markers are used.
- Type consistency: `findingKey`, `FindingIdentifierStability`, `AssuranceAdapter`, and `resolveAssuranceReadiness` names are consistent across tasks.

## 6. Execution Handoff

Execute this plan in a new implementation worktree. The first code branch should target `BI-ASSURANCE-P0-02` and `BI-ASSURANCE-P0-03` together because both are foundation-only and share the same `apps/web/lib/assurance/` package boundary. Keep `BI-ASSURANCE-P1-01` and `BI-ASSURANCE-P1-02` for the next slice after Phase 0 lands.
