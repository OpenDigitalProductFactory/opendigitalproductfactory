# AI Routing and UX Verification Test Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a maintainable verification architecture that catches wrong AI routing, stale coworker tool/prompt state, and visible UX workflow failures before they ship.

**Architecture:** Add a small test-facing route contract matrix, deterministic Vitest contract tests, Playwright route-family smoke fixtures, and normalized failure evidence. Refactor shared test helpers before adding broad coverage so future route/coworker tests do not duplicate login, route, and evidence setup.

**Spec:** `docs/superpowers/specs/2026-05-11-ai-routing-ux-verification-test-architecture-design.md`

**Tech Stack:** Next.js 16 App Router, Vitest 4, Testing Library, Playwright Test, Prisma through existing app/db helpers, DPF MCP backlog workflow for governed follow-up.

**AGENTS.md anchors:** §1 never fabricate, §4 PR and DCO workflow, §5 build gate, §6 live backlog first, §7 subagent prompts must include UI/theme rules, §12 theme-aware styling, §13 login/local QA.

---

## Execution Status (2026-05-11)

- Tasks 1-3 implemented with TDD: QA ID parser, route contract matrix, and functional failure evidence helpers.
- Tasks 4-5 implemented as reusable Playwright fixtures plus three route-family smoke projects for `/build`, `/platform/tools/discovery`, and `/ops`.
- Task 6 implemented by linking the manual QA plan to `apps/web/lib/testing/route-contracts.ts`.
- Task 7 verification completed for focused Vitest, web typecheck, targeted Playwright route smokes, and `pnpm --filter web build`.
- Task 8 remains a follow-up slice for governed backlog integration of functional failure evidence.

---

## Spec Readiness Gate (binding before Task 0)

The owning spec — `docs/superpowers/specs/2026-05-11-ai-routing-ux-verification-test-architecture-design.md` — is reviewed and approved for slice 1 implementation as of 2026-05-11. Per AGENTS.md §10 and Mark's standing process (`feedback_spec_commit_plan_process`: "approved spec is immediately committed AND fed to writing-plans"), implementation does not start before the spec is reviewed and approved.

This slice is additive: no schema changes, no production UI behavior change beyond accessible labels added when no selector exists, rollback = revert one PR. Two paths to authorize start:

- [x] **Path A (preferred):** chief architect approves the spec; spec moves from "Draft for review" to a binding status; then begin Task 0. Recorded 2026-05-11 from Mark's "documents reviewed and updated ... continue" instruction.
- [ ] **Path B (waiver):** chief architect explicitly waives the gate for slice 1 on the basis above, with the binding commitment that Task 8 (governed backlog loop) and any prompt patches do not start until the spec is approved.

Chosen path: Path A, Mark Bodman, 2026-05-11.

## Reality Check (binding context — read before editing tests)

The repo was inspected on 2026-05-11. Several names in the original spec draft did not match what's actually exported. Use these names verbatim:

- **Route → agent resolver:** `resolveAgentForRoute(pathname, { platformRole, isSuperuser })` — from `apps/web/lib/tak/agent-routing.ts:565`. **Not** `resolveRouteAgent`. The user-context argument is required; `canAssist` depends on `platformRole`.
- **Route → context resolver:** `resolveRouteContext(pathname): RouteContextDef` — from `apps/web/lib/tak/route-context-map.ts:964`. ✓
- **Tool → grant mapping:** `getToolGrantMapping(): Record<string, string[]>` — from `apps/web/lib/tak/agent-grants.ts`. **There is no `TOOL_TO_GRANTS` constant.** Per-agent grants come from `getAgentToolGrants(agentId)`.
- **Repo-canonical agent IDs and labels per route** (from `agent-routing.ts` `ROUTE_AGENT_MAP`):

  | Route | `agentId` | `agentName` |
  |---|---|---|
  | `/build` | `build-specialist` | Software Engineer |
  | `/ops` | `ops-coordinator` | **Scrum Master** (not "Operations Coordinator") |
  | `/platform/tools/discovery` | `inventory-specialist` | Digital Product Estate Specialist |
  | `/storefront` | `storefront-advisor` | Storefront Operations Manager (**not** marketing-specialist — `/customer/marketing` is the marketing route) |
  | `/customer/marketing` | `marketing-specialist` | Marketing Strategist |
  | `/platform/ai/authority` | `platform-engineer` | **AI Ops Engineer** (not "Platform Engineer") |
  | `/finance/settings/tax` | `finance-agent` | **Finance Specialist** (not "finance-controller" / "Finance Controller") |

- **Tool wiring vs tool existence.** Some MCP tools (`run_discovery_triage`, `record_tax_execution_outcome`) exist in `mcp-tools.ts` / `agent-grants.ts` but are **not** in the corresponding route's `domainTools` in `route-context-map.ts`. Asserting an unwired tool produces a false-negative test. The matrix's `requiredDomainTools` must be discovered from the route map, not asserted from memory. Where a route lacks a tool the spec expects, file a backlog item rather than failing the contract test.

- **Known-failing test by design — AI-15.** [tests/e2e/platform-qa-plan.md:249](tests/e2e/platform-qa-plan.md:249) explicitly says: *"the Estate Specialist prompt … does not yet teach this four-signal framing by name; the test will fail until the prompt is updated to reference Identity / Taxonomy / Evidence / Reproducibility explicitly. Track that gap as a backlog item if AI-15 fails."* This plan's Task 5 Step 2 asserts that exact framing and **is expected to fail** until the Estate Specialist prompt is patched. Capture this as a backlog item; do not weaken the assertion.

- **Existing role-conditional coverage in `apps/web/lib/tak/agent-routing.test.ts` is preserved verbatim.** The new contract matrix layers a high-risk-route summary on top — it does not replace the existing role-conditional assertions (`superuser`, `opsUser`, `noRole`).

- **Login flow is required.** `/build`, `/ops`, `/storefront`, `/finance/*`, `/platform/*` all redirect to `/welcome` for unauthenticated users. The Playwright fixture must use the existing `e2e/global-setup.ts` (or equivalent storage-state pattern) to authenticate as `admin@dpf.local` with `ADMIN_PASSWORD` from repo-root `.env` (per AGENTS.md §13). Without this, every smoke test fails on the URL guard before it asserts anything useful.

---

## File Structure

**Create:**

- `apps/web/lib/testing/route-contracts.ts` - canonical test-facing route contract matrix for the first high-risk route families.
- `apps/web/lib/testing/route-contracts.test.ts` - deterministic tests for route to agent/context/tool/grant/prompt/QA-ID alignment.
- `apps/web/lib/testing/qa-plan-index.ts` - parser/index for stable QA IDs in `tests/e2e/platform-qa-plan.md`.
- `apps/web/lib/testing/qa-plan-index.test.ts` - tests that route contracts reference real QA IDs.
- `apps/web/lib/testing/functional-evidence.ts` - typed evidence payload builder for functional test failures.
- `apps/web/lib/testing/functional-evidence.test.ts` - evidence schema and redaction tests.
- `e2e/fixtures/dpf-test.ts` - Playwright base fixture with auth, route open, coworker panel, and evidence attachment helpers.
- `e2e/fixtures/evidence.ts` - Playwright-side writer for `FunctionalFailureEvidence`.
- `e2e/ai-routing-build-studio.spec.ts` - first Build Studio smoke suite.
- `e2e/ai-routing-discovery.spec.ts` - first Discovery specialist smoke suite.
- `e2e/ai-routing-ops-backlog.spec.ts` - first Ops/backlog smoke suite.

**Modify:**

- `playwright.config.ts` - add route-family projects or grep tags for the new smoke suites.
- `tests/e2e/platform-qa-plan.md` - add a short "Automated Coverage Mapping" section that points to the route contract matrix.
- `apps/web/lib/tak/agent-routing.test.ts` - **leave the existing role-conditional assertions intact.** They cover the `superuser`/`opsUser`/`noRole` access dimension that the new contract matrix does not. The matrix layers a high-risk-route summary on top, it does not replace this file. Add a comment at the top pointing readers to `apps/web/lib/testing/route-contracts.ts` for the broader route surface.
- `apps/web/lib/tak/route-context-map.test.ts` - add or keep narrow tests for route-specific domain tool invariants that are easier to express close to the route map.

**Investigate (do not modify in slice 1, but flag in PR body):**

- `apps/web/lib/agent-routing.ts` (2-line re-export) — duplicates `apps/web/lib/tak/agent-routing.ts` and is imported by 12 callers. Per `feedback_zero_technical_debt`, file a separate `clean/` PR to either delete the duplicate (rewriting imports to point at `@/lib/tak/agent-routing`) or to convert it into an explicit re-export with a comment explaining why both paths exist. Out of scope for this slice (would touch UI components — risk doesn't fit a test-architecture slice).

**Do not modify in the first slice:**

- `packages/db/prisma/schema.prisma`
- `packages/db/src/seed.ts`
- route persona prompt content, unless a contract test exposes a current broken invariant and the user explicitly approves the fix slice
- production UI components, except to add stable accessible labels or test IDs when a smoke test proves there is no accessible selector

---

## Task 0: Backlog And Branch Hygiene

**Files:** none unless an MCP backlog item is linked later.

- [x] Run the DPF MCP `list_epics` and confirm whether an AI routing / UX verification epic already exists. Result on 2026-05-11: no active or done epic with that title or obvious overlap in the first 100 live epics.
- [x] Run the DPF MCP `search_specs_and_plans` for `routing UX verification test architecture`. Result on 2026-05-11: no existing indexed spec/plan match.
- [x] If an overlapping active epic exists, record its `EP-*` in the implementation PR body and do not create a duplicate. Result: no overlapping active epic found.
- [x] If no epic exists, ask Mark whether to create the governed epic now or land the spec/plan first and create the epic from the reviewed artifacts. Decision: land reviewed spec/plan and slice-1 implementation first; create/reuse the governed epic from reviewed artifacts in the follow-up backlog slice rather than with a half-formed Task 0 shell.
- [x] Confirm the implementation worktree is not on `main`: `git branch --show-current`. Result: `chore/ai-routing-ux-verification-tests`.
- [x] If no branch is active, create `chore/ai-routing-ux-verification-tests`. Per AGENTS.md §4 the allowed branch prefixes are `feat/ fix/ chore/ doc/ clean/`; `codex/...` is the worktree-naming convention, not a git-branch convention.

Expected: no duplicate epic is created, and implementation starts from a named branch with an AGENTS.md-compliant prefix.

---

## Task 1: QA Plan Index

**Goal:** Make stable QA IDs machine-checkable so route contract tests cannot cite nonexistent manual cases.

**Files:**

- Create: `apps/web/lib/testing/qa-plan-index.ts`
- Create: `apps/web/lib/testing/qa-plan-index.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/testing/qa-plan-index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractQaPlanIds, hasQaPlanId } from "./qa-plan-index";

const sample = `
| BUILD-20 | Advance a build from plan -> build -> review | UX status flips running |
| AI-15 | Ask why this item needs human review | Uses four signals |
| AUTH-GOV-11 | On /ops, ask agent to create a backlog item | ToolExecution record appears |
`;

describe("qa-plan-index", () => {
  it("extracts stable QA IDs from markdown tables", () => {
    expect(extractQaPlanIds(sample)).toEqual(["BUILD-20", "AI-15", "AUTH-GOV-11"]);
  });

  it("checks whether an ID exists in the parsed index", () => {
    const ids = extractQaPlanIds(sample);
    expect(hasQaPlanId(ids, "AI-15")).toBe(true);
    expect(hasQaPlanId(ids, "AI-99")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
pnpm --filter web exec vitest run lib/testing/qa-plan-index.test.ts
```

Expected: fail because `qa-plan-index.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `apps/web/lib/testing/qa-plan-index.ts`:

```ts
const QA_ID_PATTERN = /\b(?:AUTH|SETUP|DASH|EMP|CRM|FIN|GRC|OPS|PORT|INV|EA|BUILD|STORE|AI|ADMIN|REF-LOCALITY|DOCS|AUTH-GOV)-\d+\b/g;

export function extractQaPlanIds(markdown: string): string[] {
  const seen = new Set<string>();
  for (const match of markdown.matchAll(QA_ID_PATTERN)) {
    seen.add(match[0]);
  }
  return Array.from(seen);
}

export function hasQaPlanId(ids: readonly string[], id: string): boolean {
  return ids.includes(id);
}
```

- [ ] **Step 4: Verify**

Run:

```powershell
pnpm --filter web exec vitest run lib/testing/qa-plan-index.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/testing/qa-plan-index.ts apps/web/lib/testing/qa-plan-index.test.ts
git commit -s -m "test(routing): index QA plan IDs"
```

---

## Task 2: Route Contract Matrix

**Goal:** Add a small reviewable contract matrix for the highest-risk AI routing and UX surfaces.

**Files:**

- Create: `apps/web/lib/testing/route-contracts.ts`
- Create: `apps/web/lib/testing/route-contracts.test.ts`
- Modify: `apps/web/lib/tak/agent-routing.test.ts`
- Modify: `apps/web/lib/tak/route-context-map.test.ts`

- [ ] **Step 1: Write failing route contract tests**

Create `apps/web/lib/testing/route-contracts.test.ts`. Repo-canonical names (per Reality Check above): the resolver is `resolveAgentForRoute(pathname, userCtx)`; the grant mapping comes from `getToolGrantMapping()`; there is no `TOOL_TO_GRANTS` constant.

```ts
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTE_CONTRACTS } from "./route-contracts";
import { extractQaPlanIds } from "./qa-plan-index";
import { resolveAgentForRoute } from "@/lib/tak/agent-routing";
import { resolveRouteContext } from "@/lib/tak/route-context-map";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";

// Resolve repo root from this test file's location, not process.cwd() — vitest
// can run from either repo root or apps/web depending on invocation.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const qaPlan = readFileSync(join(repoRoot, "tests/e2e/platform-qa-plan.md"), "utf8");
const qaIds = extractQaPlanIds(qaPlan);
const grantMapping = getToolGrantMapping();

// Superuser context: gates `canAssist` on platformRole; superuser bypasses
// access control so the matrix can assert routing identity without entangling
// role-conditional access. Role-conditional coverage stays in
// apps/web/lib/tak/agent-routing.test.ts.
const SUPERUSER_CTX = { platformRole: "HR-000", isSuperuser: true } as const;

describe("AI routing route contracts", () => {
  it("covers the first high-risk route families", () => {
    expect(ROUTE_CONTRACTS.map((contract) => contract.family)).toEqual([
      "build-studio",
      "ops-backlog",
      "discovery",
      "storefront",
      "marketing",
      "platform-ai",
      "finance-tax",
    ]);
  });

  it("routes each contract path to the expected coworker (id + label)", () => {
    for (const contract of ROUTE_CONTRACTS) {
      const agent = resolveAgentForRoute(contract.route, SUPERUSER_CTX);
      expect(agent.agentId, contract.route).toBe(contract.expectedAgentId);
      expect(agent.agentName, contract.route).toBe(contract.expectedLabel);
    }
  });

  it("delivers required route tools and grant mappings", () => {
    for (const contract of ROUTE_CONTRACTS) {
      const context = resolveRouteContext(contract.route);
      for (const toolName of contract.requiredDomainTools) {
        expect(context.domainTools, `${contract.route} missing ${toolName}`).toContain(toolName);
        // Tools without an explicit mapping default to allowed; the assertion
        // is "if a mapping exists, it must be non-empty" — not "every tool
        // must appear in the mapping."
        if (toolName in grantMapping) {
          expect(grantMapping[toolName], `${toolName} grant mapping must be non-empty`).not.toHaveLength(0);
        }
      }
    }
  });

  it("links every route contract to real QA plan IDs", () => {
    for (const contract of ROUTE_CONTRACTS) {
      for (const qaId of contract.qaIds) {
        expect(qaIds, `${contract.route} references missing ${qaId}`).toContain(qaId);
      }
    }
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
pnpm --filter web exec vitest run lib/testing/route-contracts.test.ts
```

Expected: fail because `route-contracts.ts` does not exist.

- [ ] **Step 3: Implement the initial contract matrix**

Create `apps/web/lib/testing/route-contracts.ts`. **Names below are repo-canonical** (see Reality Check). `requiredDomainTools` lists only tools actually wired to the route in `apps/web/lib/tak/route-context-map.ts` — do not list MCP tools that exist platform-wide but are not surfaced to the route's `domainTools`.

```ts
export type RouteContractFamily =
  | "build-studio"
  | "ops-backlog"
  | "discovery"
  | "storefront"
  | "marketing"
  | "platform-ai"
  | "finance-tax";

export type RouteContract = {
  family: RouteContractFamily;
  route: string;
  expectedAgentId: string;
  expectedLabel: string;
  requiredDomainTools: string[];
  qaIds: string[];
};

export const ROUTE_CONTRACTS: RouteContract[] = [
  {
    family: "build-studio",
    route: "/build",
    expectedAgentId: "build-specialist",
    expectedLabel: "Software Engineer",
    requiredDomainTools: ["saveBuildEvidence", "run_ux_test", "report_quality_issue"],
    qaIds: ["BUILD-20", "BUILD-41", "BUILD-43"],
  },
  {
    family: "ops-backlog",
    route: "/ops",
    expectedAgentId: "ops-coordinator",
    expectedLabel: "Scrum Master",
    requiredDomainTools: ["create_backlog_item", "query_backlog", "update_backlog_item"],
    qaIds: ["OPS-01", "OPS-05", "AUTH-GOV-11"],
  },
  {
    family: "discovery",
    route: "/platform/tools/discovery",
    expectedAgentId: "inventory-specialist",
    expectedLabel: "Digital Product Estate Specialist",
    // requiredDomainTools intentionally empty until the route map surfaces
    // discovery-specific domainTools. `run_discovery_triage` exists as an MCP
    // tool but is not currently wired to this route's domainTools — file as
    // a backlog item rather than asserting an unwired tool here.
    requiredDomainTools: [],
    qaIds: ["INV-08", "AI-15"],
  },
  {
    family: "storefront",
    route: "/storefront",
    expectedAgentId: "storefront-advisor",
    expectedLabel: "Storefront Operations Manager",
    requiredDomainTools: [],
    qaIds: ["STORE-01"],
  },
  {
    family: "marketing",
    route: "/customer/marketing",
    expectedAgentId: "marketing-specialist",
    expectedLabel: "Marketing Strategist",
    requiredDomainTools: ["save_marketing_review", "create_backlog_item"],
    qaIds: [],
  },
  {
    family: "platform-ai",
    route: "/platform/ai/authority",
    expectedAgentId: "platform-engineer",
    expectedLabel: "AI Ops Engineer",
    requiredDomainTools: ["evaluate_tool"],
    qaIds: ["AUTH-GOV-11"],
  },
  {
    family: "finance-tax",
    route: "/finance/settings/tax",
    expectedAgentId: "finance-agent",
    expectedLabel: "Finance Specialist",
    // record_tax_execution_outcome exists as an MCP tool but is not wired to
    // this route's domainTools — file a backlog item if the spec requires it.
    requiredDomainTools: [],
    qaIds: ["FIN-09", "FIN-12"],
  },
];
```

**Verification before commit.** Run `rg -n "agentName:|domainTools" apps/web/lib/tak/agent-routing.ts apps/web/lib/tak/route-context-map.ts` and confirm every `expectedAgentId` / `expectedLabel` / `requiredDomainTools` entry above matches the source. If any name in the source has changed since 2026-05-11, update the matrix to match — the test must reflect ground truth, not aspiration.

The empty `requiredDomainTools` and shortened `qaIds` arrays are deliberate slice-1 honesty. They prevent the test from failing on real coverage gaps that the contract test cannot itself fix. Each gap should become a tracked backlog item with a follow-up plan to wire the missing tool to the route or update the QA plan.

- [ ] **Step 4: Reconcile actual names (final guardrail)**

Even though the matrix was authored against the 2026-05-11 inspection, agent IDs and route-context entries change. Before committing, re-grep against current head:

```powershell
rg -n "agentId:|agentName:|domainTools|run_ux_test|report_quality_issue|record_tax_execution_outcome|save_marketing_review|evaluate_tool|run_discovery_triage" apps/web/lib/tak apps/web/lib/mcp-tools.ts
```

Decision rules:

- **Name changed in the source** (e.g., `finance-agent` renamed) → update the matrix.
- **Source still missing a tool the spec expects** to be wired (e.g., `run_discovery_triage` on the discovery route) → leave the matrix as-is (with the empty / partial `requiredDomainTools`), file a backlog item naming the gap, and reference it in the PR body.
- **Source has a NEW tool wired since 2026-05-11** that belongs in the matrix → add it. Don't expand the matrix beyond the current high-risk-route surface in this slice.

Never weaken an assertion to make it pass. If something looks wrong, ask before changing the matrix.

- [ ] **Step 5: Verify**

Run:

```powershell
pnpm --filter web exec vitest run lib/testing/route-contracts.test.ts lib/tak/agent-routing.test.ts lib/tak/route-context-map.test.ts
```

Expected: pass, or fail only on a real current contract gap that is converted into a backlog item.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/testing/route-contracts.ts apps/web/lib/testing/route-contracts.test.ts apps/web/lib/tak/agent-routing.test.ts apps/web/lib/tak/route-context-map.test.ts
git commit -s -m "test(routing): add high-risk route contracts"
```

---

## Task 3: Functional Evidence Schema

**Goal:** Normalize Playwright failures into backlog-ready evidence without adding direct DB writes.

**Files:**

- Create: `apps/web/lib/testing/functional-evidence.ts`
- Create: `apps/web/lib/testing/functional-evidence.test.ts`
- Create: `e2e/fixtures/evidence.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/testing/functional-evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFunctionalFailureEvidence, redactEvidence } from "./functional-evidence";

describe("functional evidence", () => {
  it("builds backlog-ready failure evidence", () => {
    const evidence = buildFunctionalFailureEvidence({
      testId: "BUILD-41",
      suite: "build-studio",
      route: "/build",
      expected: "header stays within main pane",
      actual: "header overlapped coworker panel",
      screenshotPath: "test-results/build-41/screenshot.png",
      tracePath: "test-results/build-41/trace.zip",
      userRole: "HR-400",
      agentId: "build-specialist",
      routeContext: "/build",
      reproCommand: "pnpm test:e2e -- --project=build-studio -g BUILD-41",
    });

    expect(evidence.likelyOwnerArea).toBe("build-studio");
    expect(evidence.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("redacts sensitive values before attaching evidence", () => {
    const evidence = buildFunctionalFailureEvidence({
      testId: "AUTH-GOV-11",
      suite: "ops-backlog",
      route: "/ops",
      expected: "tool execution appears",
      actual: "Authorization Bearer dpfmcp_secret leaked in log",
      screenshotPath: null,
      tracePath: null,
      userRole: "HR-400",
      agentId: "ops-coordinator",
      routeContext: "/ops",
      reproCommand: "pnpm test:e2e -- --project=ops-backlog -g AUTH-GOV-11",
    });

    expect(redactEvidence(evidence).actual).not.toContain("dpfmcp_secret");
    expect(redactEvidence(evidence).actual).toContain("[redacted-token]");
  });
});
```

- [ ] **Step 2: Run the failing test**

```powershell
pnpm --filter web exec vitest run lib/testing/functional-evidence.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement evidence helpers**

Create `apps/web/lib/testing/functional-evidence.ts`:

```ts
export type FunctionalFailureEvidenceInput = {
  testId: string;
  suite: string;
  route: string;
  expected: string;
  actual: string;
  screenshotPath: string | null;
  tracePath: string | null;
  userRole: string;
  agentId: string | null;
  routeContext: string;
  reproCommand: string;
  buildId?: string | null;
  backlogItemId?: string | null;
};

export type FunctionalFailureEvidence = FunctionalFailureEvidenceInput & {
  createdAt: string;
  likelyOwnerArea: string;
};

// Two specific patterns, not one greedy pattern:
//   dpfmcp_ tokens look like dpfmcp_<base64-ish> per AGENTS.md §8
//   Bearer auth headers carry the token after a space: "Bearer <token>"
// A single greedy /\b(?:dpfmcp|Bearer)\S*/gi over-matches innocuous strings
// like "Bearer Down" or "dpfmcp-related" that appear in error messages.
const TOKEN_PATTERNS = [
  /\bdpfmcp_[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._-]+/g,
];

export function buildFunctionalFailureEvidence(input: FunctionalFailureEvidenceInput): FunctionalFailureEvidence {
  return {
    ...input,
    createdAt: new Date().toISOString(),
    likelyOwnerArea: inferOwnerArea(input.suite, input.route),
  };
}

export function redactEvidence(evidence: FunctionalFailureEvidence): FunctionalFailureEvidence {
  const redact = (text: string) =>
    TOKEN_PATTERNS.reduce((acc, pat) => acc.replace(pat, "[redacted-token]"), text);
  return {
    ...evidence,
    actual: redact(evidence.actual),
    expected: redact(evidence.expected),
  };
}

function inferOwnerArea(suite: string, route: string): string {
  if (suite.includes("build") || route.startsWith("/build")) return "build-studio";
  if (route.startsWith("/ops")) return "ops-backlog";
  if (route.includes("/discovery")) return "discovery";
  if (route.startsWith("/storefront")) return "storefront";
  if (route.startsWith("/platform/ai")) return "platform-ai";
  if (route.startsWith("/finance")) return "finance";
  return "platform";
}
```

- [ ] **Step 4: Add Playwright evidence writer**

Create `e2e/fixtures/evidence.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TestInfo } from "@playwright/test";
import {
  buildFunctionalFailureEvidence,
  redactEvidence,
  type FunctionalFailureEvidenceInput,
} from "../../apps/web/lib/testing/functional-evidence";

export async function attachFunctionalFailureEvidence(testInfo: TestInfo, input: FunctionalFailureEvidenceInput) {
  const evidence = redactEvidence(buildFunctionalFailureEvidence(input));
  const outputPath = join(testInfo.outputDir, "functional-failure-evidence.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(evidence, null, 2), "utf8");
  testInfo.attachments.push({
    name: "functional-failure-evidence",
    contentType: "application/json",
    path: outputPath,
  });
  return evidence;
}
```

- [ ] **Step 5: Verify**

```powershell
pnpm --filter web exec vitest run lib/testing/functional-evidence.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/testing/functional-evidence.ts apps/web/lib/testing/functional-evidence.test.ts e2e/fixtures/evidence.ts
git commit -s -m "test(ux): add functional failure evidence schema"
```

---

## Task 4: Playwright Fixture Refactor

**Goal:** Spend the refactoring budget on stable functional-test helpers before adding route suites.

**Files:**

- Create: `e2e/fixtures/dpf-test.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Confirm the existing auth-state setup is reusable**

The repo already has `e2e/global-setup.ts`. Read it before writing the fixture and confirm the fixture below can rely on the storage state it produces (or extend `global-setup.ts` to write a reusable storage-state file under `e2e/.auth/admin.json` and have the new projects opt into it via `use: { storageState: ".auth/admin.json" }`).

If `global-setup.ts` does not currently produce a storage-state file usable by the new projects, add that capability in this step — do not paper over it in the fixture by re-logging on every test (slow + flaky).

Per AGENTS.md §13: login email is `admin@dpf.local`, password is `ADMIN_PASSWORD` from repo-root `.env`. Read it from there, not from `apps/web/.env.local` (which often omits it).

- [ ] **Step 2: Add the fixture**

Create `e2e/fixtures/dpf-test.ts`:

```ts
import { test as base, expect, type Page } from "@playwright/test";
import { attachFunctionalFailureEvidence } from "./evidence";

type DpfFixtures = {
  openAppRoute: (route: string) => Promise<void>;
  openCoworkerPanel: () => Promise<void>;
  expectNotRedirectedToWelcome: () => Promise<void>;
  attachRouteFailure: (input: {
    testId: string;
    suite: string;
    route: string;
    expected: string;
    actual: string;
    agentId?: string | null;
  }) => Promise<void>;
};

export const test = base.extend<DpfFixtures>({
  openAppRoute: async ({ page }, use) => {
    await use(async (route: string) => {
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/welcome|\/login/);
    });
  },
  openCoworkerPanel: async ({ page }, use) => {
    await use(async () => {
      const button = page.getByRole("button", { name: /open ai coworker|ai coworker|coworker/i }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click();
      }
      await expect(page.getByRole("textbox").or(page.getByPlaceholder(/message|ask/i))).toBeVisible();
    });
  },
  expectNotRedirectedToWelcome: async ({ page }, use) => {
    await use(async () => {
      await expect(page).not.toHaveURL(/\/welcome|\/login/);
    });
  },
  attachRouteFailure: async ({}, use, testInfo) => {
    await use(async (input) => {
      await attachFunctionalFailureEvidence(testInfo, {
        ...input,
        screenshotPath: testInfo.attachments.find((a) => a.contentType === "image/png")?.path ?? null,
        tracePath: null,
        userRole: "admin",
        routeContext: input.route,
        agentId: input.agentId ?? null,
        reproCommand: `pnpm test:e2e -- --project=${input.suite} -g ${input.testId}`,
      });
    });
  },
});

export { expect };
export type { Page };
```

- [ ] **Step 3: Add route-family projects**

Modify `playwright.config.ts` to include project entries (each opting into the shared admin storage state from Step 1):

```ts
{
  name: "build-studio",
  testMatch: /.*ai-routing-build-studio\.spec\.ts/,
  use: { storageState: ".auth/admin.json" },
},
{
  name: "discovery",
  testMatch: /.*ai-routing-discovery\.spec\.ts/,
  use: { storageState: ".auth/admin.json" },
},
{
  name: "ops-backlog",
  testMatch: /.*ai-routing-ops-backlog\.spec\.ts/,
  use: { storageState: ".auth/admin.json" },
},
```

Keep existing projects/config intact. If `e2e/.auth/` doesn't exist yet, add it to `.gitignore` in the same commit.

- [ ] **Step 4: Verify config loads**

Run:

```powershell
pnpm exec playwright test --list
```

Expected: command lists existing tests and the three new projects once specs exist. If specs do not exist yet, config still loads without syntax errors.

- [ ] **Step 5: Commit**

```powershell
git add e2e/fixtures/dpf-test.ts playwright.config.ts e2e/global-setup.ts .gitignore
git commit -s -m "test(e2e): add DPF route smoke fixtures"
```

---

## Task 5: First Route-Family Smoke Tests

**Goal:** Add three high-value smoke suites that prove route loading, coworker selection, and visible workflow state.

**Files:**

- Create: `e2e/ai-routing-build-studio.spec.ts`
- Create: `e2e/ai-routing-discovery.spec.ts`
- Create: `e2e/ai-routing-ops-backlog.spec.ts`

- [ ] **Step 1: Build Studio smoke**

Create `e2e/ai-routing-build-studio.spec.ts`:

```ts
import { test, expect } from "./fixtures/dpf-test";

test("BUILD-41 /build keeps workflow usable with coworker panel open", async ({ page, openAppRoute, openCoworkerPanel, attachRouteFailure }) => {
  await openAppRoute("/build");
  await page.screenshot({ path: test.info().outputPath("build-before-coworker.png"), fullPage: true });

  await openCoworkerPanel();

  await expect(page.getByRole("heading", { name: /build studio|build/i }).first()).toBeVisible();
  await expect(page.getByText(/workflow|ideate|plan|build|review|ship/i).first()).toBeVisible();
  await expect(page.getByText(/software engineer|build specialist/i).first()).toBeVisible();

  if (await page.locator("body").evaluate((body) => body.scrollWidth > body.clientWidth)) {
    await attachRouteFailure({
      testId: "BUILD-41",
      suite: "build-studio",
      route: "/build",
      expected: "Build Studio should not overflow horizontally with coworker open",
      actual: "Body scrollWidth exceeded clientWidth",
      agentId: "build-specialist",
    });
    throw new Error("Build Studio overflowed horizontally with coworker open");
  }
});
```

- [ ] **Step 2: Discovery smoke**

Create `e2e/ai-routing-discovery.spec.ts`. **Expected to fail until the Estate Specialist prompt is patched.** Per [tests/e2e/platform-qa-plan.md:249](tests/e2e/platform-qa-plan.md:249), the prompt does not yet teach the four-signal framing (Identity / Taxonomy / Evidence / Reproducibility) by name. The test asserts the framing on purpose — the failure is a known platform gap, not a test bug. File a backlog item linking to AI-15 if this is the first time the failure is observed; do not weaken the assertion.

```ts
import { test, expect } from "./fixtures/dpf-test";

test("AI-15 discovery route opens the estate specialist context", async ({ page, openAppRoute, openCoworkerPanel }) => {
  await openAppRoute("/platform/tools/discovery");
  await expect(page.getByText(/discovery|estate|triage/i).first()).toBeVisible();

  await openCoworkerPanel();

  await expect(page.getByText(/digital product estate specialist|estate specialist|inventory specialist/i).first()).toBeVisible();
  // Known failure until Estate Specialist prompt patched — see AI-15 in QA plan.
  await expect(page.getByText(/identity|taxonomy|evidence|reproducible/i).first()).toBeVisible();
});
```

- [ ] **Step 3: Ops/backlog smoke**

Create `e2e/ai-routing-ops-backlog.spec.ts`:

```ts
import { test, expect } from "./fixtures/dpf-test";

test("AUTH-GOV-11 ops route exposes backlog and governed coworker surface", async ({ page, openAppRoute, openCoworkerPanel }) => {
  await openAppRoute("/ops");
  await expect(page.getByText(/backlog|epic|improvements/i).first()).toBeVisible();

  await openCoworkerPanel();

  await expect(page.getByText(/operations coordinator|coo|operations/i).first()).toBeVisible();
  await expect(page.getByRole("textbox").or(page.getByPlaceholder(/message|ask/i))).toBeVisible();
});
```

- [ ] **Step 4: Preconditions**

Before running smoke tests, confirm:

- Docker stack is up: `docker compose ps` shows `portal`, `postgres`, `neo4j`, `qdrant` all running.
- `ADMIN_PASSWORD` is set in repo-root `.env`.
- The app responds at the install's configured URL (per AGENTS.md §13: `AUTH_URL` / `APP_URL` from `.env`, **not** a stale `next dev` session).
- The shared admin storage state file from Task 4 exists at `e2e/.auth/admin.json` and was generated within the last hour (sessions expire).

If any precondition fails, stop and resolve it. Do not run smoke tests against a half-up stack — the failure modes are confusing and the evidence is misleading.

- [ ] **Step 5: Run the smoke tests against the Docker-served app**

```powershell
pnpm exec playwright test --project=build-studio --project=discovery --project=ops-backlog --trace=retain-on-failure
```

Expected:
- `BUILD-41` build-studio smoke: PASS.
- `AUTH-GOV-11` ops-backlog smoke: PASS.
- `AI-15` discovery smoke: **FAIL** until the Estate Specialist prompt is patched (see Step 2 above). File a backlog item; do not weaken the assertion.

If `/build` or another route redirects to `/welcome`, the storage state has expired or the login flow regressed — fix the auth setup, do not weaken the assertion.

- [ ] **Step 6: Commit**

```powershell
git add e2e/ai-routing-build-studio.spec.ts e2e/ai-routing-discovery.spec.ts e2e/ai-routing-ops-backlog.spec.ts
git commit -s -m "test(e2e): add AI routing UX smoke suites"
```

If the pre-commit typecheck hook fails, fix the underlying error and re-stage. Do not bypass with `DPF_SKIP_TYPECHECK=1` — the hook exists because TS errors only surface in `next build` and CI (AGENTS.md §5).

---

## Task 6: QA Plan Coverage Mapping

**Goal:** Make the manual QA plan and automated contract matrix point at each other.

**Files:**

- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Add automated coverage section**

Add near the "Test Execution" section:

```md
## Automated Coverage Mapping

High-risk AI routing and UX checks are mapped in `apps/web/lib/testing/route-contracts.ts`.

When adding or changing a QA ID for Build Studio, Ops/backlog, Discovery, Storefront, Platform AI, or Finance tax, update the route contract matrix in the same PR. Route contracts are not a replacement for this plan; they are the automated assertion layer that prevents route-agent-tool-prompt drift from silently invalidating these manual cases.
```

- [ ] **Step 2: Verify docs references**

Run:

```powershell
rg -n "Automated Coverage Mapping|route-contracts" tests/e2e/platform-qa-plan.md apps/web/lib/testing
```

Expected: both the QA plan and test module references appear.

- [ ] **Step 3: Commit**

```powershell
git add tests/e2e/platform-qa-plan.md
git commit -s -m "docs(qa): map manual QA IDs to route contracts"
```

---

## Task 7: Verification Gate

**Goal:** Prove the new architecture works without claiming full release automation.

- [ ] Run focused unit tests:

```powershell
pnpm --filter web exec vitest run lib/testing/qa-plan-index.test.ts lib/testing/route-contracts.test.ts lib/testing/functional-evidence.test.ts lib/tak/agent-routing.test.ts lib/tak/route-context-map.test.ts
```

Expected: pass.

- [ ] Run web typecheck:

```powershell
pnpm --filter web typecheck
```

Expected: pass.

- [ ] Run Playwright smoke projects against the running app:

```powershell
pnpm exec playwright test --project=build-studio --project=discovery --project=ops-backlog --trace=retain-on-failure
```

Expected:
- `BUILD-41` and `AUTH-GOV-11` PASS.
- `AI-15` discovery FAIL — known platform gap (Estate Specialist prompt). Filed as a backlog item per Task 5 Step 2; do not weaken the assertion.

Per AGENTS.md §5, if the Docker-served app is unavailable the verification gate is **incomplete**. Halt and bring the stack up rather than recording incomplete evidence as success.

- [ ] Run production build if this is the final task in the epic or if any app code changed beyond tests:

```powershell
pnpm --filter web build
```

Expected: pass.

- [ ] Commit final verification notes if any docs were updated:

```powershell
git status --short
```

Expected: clean except for intentionally untracked local hook files already present before this work.

---

## Task 8: Follow-Up Backlog Loop

**Goal:** Move from local functional evidence artifacts to governed backlog integration in a separate slice.

This task is intentionally a follow-up because it touches platform workflow behavior.

- [ ] Review the governed MCP backlog tools available in the target worktree.
- [ ] Add or reuse a platform-side action/API that accepts `FunctionalFailureEvidence`.
- [ ] Require dedupe by `testId + route + normalized actual`.
- [ ] Link failures to the active AI Routing and UX Verification epic.
- [ ] Record a `BacklogItemActivity` entry with screenshot/trace references when a matching item already exists.
- [ ] Add tests proving direct DB fallback is not the normal path.

Acceptance for this follow-up:

- a failing Playwright smoke test can produce a governed backlog-ready item or activity without raw SQL
- repeated failures update the existing item/activity instead of creating duplicates
- evidence redaction protects bearer tokens and local credentials

---

## Self-Review Checklist

- [ ] Spec readiness gate at the top is checked (Path A or Path B with date + signer).
- [ ] All names in `route-contracts.ts` were re-verified against `agent-routing.ts` and `route-context-map.ts` at HEAD before commit (Task 2 Step 4).
- [ ] `apps/web/lib/tak/agent-routing.test.ts` role-conditional assertions are intact — not stripped or absorbed.
- [ ] AI-15 discovery smoke is documented as expected-to-fail and tracked as a backlog item.
- [ ] Playwright fixture relies on the existing `e2e/global-setup.ts` (or extended storage-state pattern) — no per-test re-login.
- [ ] Branch name uses an AGENTS.md §4 prefix (`chore/` or `feat/`), not `codex/`.
- [ ] Spec requirement "route contract matrix" maps to Tasks 1 and 2.
- [ ] Spec requirement "coworker behavior proof" starts in Task 2 and is extended by follow-up model probes.
- [ ] Spec requirement "UX functional smoke" maps to Tasks 4 and 5.
- [ ] Spec requirement "evidence and backlog loop" maps to Tasks 3 and 8.
- [ ] Spec requirement "20 percent refactoring budget" — Task 4 (fixture refactor) and the modify-list note about leaving existing tests intact carry the discipline. If Task 4 effort is below 20% of the actual slice spend, file a tracked refactoring follow-up rather than skipping.
- [ ] No task requires direct DB edits.
- [ ] Every command uses `pnpm` workspace tooling rather than `npx`.
- [ ] New UI-facing tests use accessible labels and user-visible behavior.
