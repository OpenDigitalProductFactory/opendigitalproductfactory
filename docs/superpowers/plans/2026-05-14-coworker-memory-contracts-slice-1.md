# Coworker Memory Shape Contracts — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make the AI Coworker chat input bundle visible as a declared, typed contract with a run-local delivery report — without changing what context is delivered today.

**Architecture:** Add a new `apps/web/lib/coworker-contracts/` module containing (a) the `CoworkerInputContract` / `CoworkerInputFieldContract` / `CoworkerContextDelivery` types from spec §6, (b) a static chat contract declaration covering spec §8.1's eight fields, and (c) a loader that observes the existing prompt-assembly path in `apps/web/lib/actions/agent-coworker.ts` and emits a delivery report (delivered / compressed / withheld / missingRequired / tokenEstimate). The loader is **observational only** in tasks 1–4 (no behaviour change) and gains required-field enforcement in task 5. Both the unified and legacy prompt paths feed the same loader.

**Tech stack:** TypeScript, vitest, Next.js 16 (App Router), Prisma 7.x. No new dependencies. No schema changes. No Qdrant payload changes.

**Spec:** [docs/superpowers/specs/2026-05-14-coworker-memory-shape-contracts-design.md](../specs/2026-05-14-coworker-memory-shape-contracts-design.md) — sections 0, 3, 5, 6, 8.1, 10 ("Slice 1"), 11.

**Backlog alignment:** [BI-MEM-5A41C7](../../../) under EP-TAK-3F9A21 (verified live via `mcp__dpf__get_backlog_item` on 2026-05-14: status open, priority 1, size L). Slice 1 is a foundational sub-deliverable of this BI; the BI as a whole covers all governed memory policy classes, freshness rules, and runtime effectiveness checks and will require subsequent slices to close.

**Sister principles being sharpened:** P3 (Structured Handoffs) — Slice 1 is the input-side complement; P5 (Selective Memory) — Slice 1 instruments visibility into what was actually selected. See [docs/architecture/ai-coworker-development-principles.md](../../architecture/ai-coworker-development-principles.md). **No principle wiki pages are authored in Slice 1** — P9–P11 land in a later batch once enforcement evidence is in hand.

---

## Pre-flight (do once before Task 1)

Run from inside this worktree:

```powershell
git status --short                       # confirm clean worktree apart from this plan file
git fetch origin                         # ensure origin/main is current
git rev-list --left-right --count origin/main...HEAD  # confirm "0 N" with N == commits on this branch
# Confirm the typecheck script exists in the web package before relying on it:
node -e "console.log(JSON.parse(require('fs').readFileSync('apps/web/package.json','utf8')).scripts.typecheck)"
# Expected output: `next typegen && tsc --noEmit`
pnpm --filter web typecheck              # baseline; must pass before any task
pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker.test.ts apps/web/lib/actions/agent-coworker-server.test.ts apps/web/lib/tak/governed-memory.test.ts apps/web/lib/wiki/recall.test.ts
```

Expected: typecheck exits 0, vitest passes the existing four suites. If anything fails before Task 1, **stop** and surface — Slice 1 must not depend on a pre-broken main.

---

## Task 1: Type definitions

**Files:**
- Create: `apps/web/lib/coworker-contracts/types.ts`
- Create: `apps/web/lib/coworker-contracts/index.ts` (barrel)
- Create: `apps/web/lib/coworker-contracts/types.test.ts`

**Rationale:** Establish the shape every later task imports from. The shapes are copied verbatim from spec §6, no embellishment.

- [ ] **Step 1: Write the failing test** — create `types.test.ts` asserting that `CoworkerContextShape`, `MemoryAuthority`, `FreshnessPolicy`, `ContractDegradation`, `CoworkerInputFieldContract`, `CoworkerInputContract`, and `CoworkerContextDelivery` are exported from the barrel. Use type-only `expectTypeOf` (vitest) assertions plus runtime barrel-export checks. Member counts to assert against spec §6: `CoworkerContextShape` 7 members, `MemoryAuthority` 4, `FreshnessPolicy` 3, `ContractDegradation` 4.

  ```typescript
  import { describe, it, expectTypeOf } from "vitest";
  import * as Contracts from ".";
  import type {
    CoworkerContextShape,
    MemoryAuthority,
    FreshnessPolicy,
    ContractDegradation,
    CoworkerInputFieldContract,
    CoworkerInputContract,
    CoworkerContextDelivery,
  } from ".";

  describe("coworker-contracts types", () => {
    it("exports the four enum unions declared in spec §6 (shape 7, authority 4, freshness 3, degradation 4)", () => {
      expectTypeOf<CoworkerContextShape>().toEqualTypeOf<
        "prose" | "structured-doc" | "tabular" | "relational" | "filesystem" | "text-diff" | "receipt"
      >();
      expectTypeOf<MemoryAuthority>().toEqualTypeOf<
        "authoritative" | "user-confirmed" | "inferred" | "advisory"
      >();
      expectTypeOf<FreshnessPolicy>().toEqualTypeOf<
        "any" | "current-only" | "revalidate-before-consequential-action"
      >();
      expectTypeOf<ContractDegradation>().toEqualTypeOf<
        "block-run" | "omit-field" | "compress" | "fallback-to-primary-source"
      >();
    });

    it("CoworkerInputFieldContract requires name/shape/primitive/authority/required/freshness/degradation/sourceRef", () => {
      type Required = "name" | "shape" | "primitive" | "authority" | "required" | "freshness" | "degradation" | "sourceRef";
      expectTypeOf<keyof CoworkerInputFieldContract>().toEqualTypeOf<Required | "tokenBudget" | "promptLabel">();
    });

    it("CoworkerContextDelivery has the report fields", () => {
      const probe: CoworkerContextDelivery = {
        delivered: [],
        compressed: [],
        withheld: [],
        missingRequired: [],
        tokenEstimate: 0,
      };
      expectTypeOf(probe).toMatchTypeOf<CoworkerContextDelivery>();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/coworker-contracts/types.test.ts
  ```

  Expected: failure with module-not-found on `.` (the barrel does not exist yet).

- [ ] **Step 3: Write minimal implementation** — paste the type definitions from spec §6 verbatim into `types.ts`, then re-export from `index.ts`:

  ```typescript
  // apps/web/lib/coworker-contracts/types.ts
  export type CoworkerContextShape =
    | "prose"
    | "structured-doc"
    | "tabular"
    | "relational"
    | "filesystem"
    | "text-diff"
    | "receipt";

  export type MemoryAuthority =
    | "authoritative"
    | "user-confirmed"
    | "inferred"
    | "advisory";

  export type FreshnessPolicy =
    | "any"
    | "current-only"
    | "revalidate-before-consequential-action";

  export type ContractDegradation =
    | "block-run"
    | "omit-field"
    | "compress"
    | "fallback-to-primary-source";

  export type CoworkerInputFieldContract = {
    name: string;
    shape: CoworkerContextShape;
    primitive: string;
    authority: MemoryAuthority;
    required: boolean;
    freshness: FreshnessPolicy;
    degradation: ContractDegradation;
    tokenBudget?: number;
    sourceRef: string;
    promptLabel?: string;
  };

  export type CoworkerInputContract = {
    coworkerId: string;
    routeScope?: readonly string[];
    fields: readonly CoworkerInputFieldContract[];
    output: {
      writes: readonly string[];
      receipts?: readonly string[];
      handoff?: "PhaseHandoff" | "TaskMessage" | "TaskArtifact" | "none";
    };
  };

  export type CoworkerContextDelivery = {
    delivered: string[];
    compressed: string[];
    withheld: Array<{ field: string; reason: string }>;
    missingRequired: string[];
    tokenEstimate: number;
  };
  ```

  ```typescript
  // apps/web/lib/coworker-contracts/index.ts
  export * from "./types";
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/coworker-contracts/types.test.ts
  pnpm --filter web typecheck
  ```

  Expected: vitest passes, typecheck exits 0.

- [ ] **Step 5: Commit** on a branch `feat/coworker-contracts-types` off `origin/main`:

  ```powershell
  git checkout -b feat/coworker-contracts-types origin/main
  git add apps/web/lib/coworker-contracts/types.ts apps/web/lib/coworker-contracts/index.ts apps/web/lib/coworker-contracts/types.test.ts
  git commit -s -m "feat(coworker-contracts): introduce CoworkerInputContract type shapes (slice 1 task 1)"
  git push -u origin feat/coworker-contracts-types
  gh pr create --title "feat(coworker-contracts): introduce CoworkerInputContract type shapes" --body "Slice 1 task 1 of EP-TAK-3F9A21 / BI-MEM-5A41C7. Type definitions only — no consumers yet. Spec §6."
  ```

---

## Task 2: AI Coworker chat contract declaration

**Files:**
- Create: `apps/web/lib/coworker-contracts/registry/ai-coworker-chat.ts`
- Create: `apps/web/lib/coworker-contracts/registry/ai-coworker-chat.test.ts`
- Modify: `apps/web/lib/coworker-contracts/index.ts` — add `export * from "./registry/ai-coworker-chat";`

**Rationale:** Declare the eight-field contract from spec §8.1 as a static, immutable object. No loader yet — pure data.

- [ ] **Step 1: Write the failing test** — assert the declaration has the eight named fields from §8.1, each with the documented shape/authority/primitive. Sample assertions:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { aiCoworkerChatContract } from ".";

  describe("aiCoworkerChatContract", () => {
    it("declares the eight fields from spec §8.1", () => {
      const names = aiCoworkerChatContract.fields.map((f) => f.name).sort();
      expect(names).toEqual([
        "governed_user_facts",
        "principal_identity",
        "recent_thread_window",
        "route_context",
        "semantic_recall",
        "thread_summary",
        "tool_grants",
        "wiki_context",
      ]);
    });

    it("marks principal_identity and tool_grants as required + authoritative", () => {
      const byName = Object.fromEntries(aiCoworkerChatContract.fields.map((f) => [f.name, f]));
      expect(byName.principal_identity).toMatchObject({ required: true, authority: "authoritative", shape: "tabular" });
      expect(byName.tool_grants).toMatchObject({ required: true, authority: "authoritative", shape: "tabular" });
    });

    it("declares semantic_recall as prose/inferred and thread_summary as prose/inferred", () => {
      const byName = Object.fromEntries(aiCoworkerChatContract.fields.map((f) => [f.name, f]));
      expect(byName.semantic_recall).toMatchObject({ shape: "prose", authority: "inferred" });
      expect(byName.thread_summary).toMatchObject({ shape: "prose", authority: "inferred" });
    });

    it("declares wiki_context as structured-doc with revalidate-before-consequential-action freshness", () => {
      const byName = Object.fromEntries(aiCoworkerChatContract.fields.map((f) => [f.name, f]));
      expect(byName.wiki_context).toMatchObject({
        shape: "structured-doc",
        freshness: "revalidate-before-consequential-action",
      });
    });

    it("declares no output handoff yet (chat is conversational)", () => {
      expect(aiCoworkerChatContract.output.handoff).toBe("none");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/coworker-contracts/registry/ai-coworker-chat.test.ts
  ```

- [ ] **Step 3: Write minimal implementation** — create the declaration with all eight fields. Translate spec §8.1's table row-by-row. Use `as const satisfies CoworkerInputContract` to lock readonly-ness. `sourceRef` points at the file:line where the value is fetched today in `agent-coworker.ts`:

  ```typescript
  // apps/web/lib/coworker-contracts/registry/ai-coworker-chat.ts
  import type { CoworkerInputContract } from "../types";

  export const aiCoworkerChatContract = {
    coworkerId: "ai-coworker-chat",
    fields: [
      {
        name: "principal_identity",
        shape: "tabular",
        primitive: "postgres:User+Principal+AIDoc",
        authority: "authoritative",
        required: true,
        freshness: "current-only",
        degradation: "block-run",
        sourceRef: "apps/web/lib/actions/agent-coworker.ts:230 (requireAuthUser)",
        promptLabel: "Principal",
      },
      {
        name: "route_context",
        shape: "tabular",
        primitive: "route-registry + page-context",
        authority: "authoritative",
        required: true,
        freshness: "current-only",
        degradation: "omit-field",
        sourceRef: "apps/web/lib/actions/agent-coworker.ts:432 (resolveRouteContext) + :437 (getRouteDataContext)",
        promptLabel: "Route context",
      },
      {
        name: "recent_thread_window",
        shape: "prose",
        primitive: "postgres:AgentMessage windowed by createdAt + token budget",
        authority: "inferred",
        required: false,
        freshness: "any",
        degradation: "compress",
        tokenBudget: 4000,
        sourceRef: "apps/web/lib/actions/agent-coworker.ts:371-390 (RECENT_WINDOW / CHAT_HISTORY_TOKEN_BUDGET)",
        promptLabel: "Recent conversation",
      },
      {
        name: "thread_summary",
        shape: "prose",
        primitive: "rolling summary (not yet implemented — placeholder)",
        authority: "inferred",
        required: false,
        freshness: "any",
        degradation: "omit-field",
        sourceRef: "(future) rolling summary writer; see spec §8.1 highest-value fix",
        promptLabel: "Earlier conversation summary",
      },
      {
        name: "governed_user_facts",
        shape: "tabular",
        primitive: "postgres:UserFact via loadGovernedUserFacts",
        authority: "authoritative",
        required: false,
        freshness: "revalidate-before-consequential-action",
        degradation: "compress",
        sourceRef: "apps/web/lib/tak/governed-memory.ts:51 (loadGovernedUserFacts)",
        promptLabel: "Known user facts",
      },
      {
        name: "semantic_recall",
        shape: "prose",
        primitive: "qdrant:agent-memory via recallGovernedContext",
        authority: "inferred",
        required: false,
        freshness: "any",
        degradation: "compress",
        sourceRef: "apps/web/lib/tak/governed-memory.ts:68 (recallGovernedContext)",
        promptLabel: "Relevant recall",
      },
      {
        name: "wiki_context",
        shape: "structured-doc",
        primitive: "qdrant:wiki-pages via recallWikiContext",
        authority: "authoritative",
        required: false,
        freshness: "revalidate-before-consequential-action",
        degradation: "omit-field",
        sourceRef: "apps/web/lib/wiki/recall.ts:74 (recallWikiContext)",
        promptLabel: "Wiki context",
      },
      {
        name: "tool_grants",
        shape: "tabular",
        primitive: "agent-grants resolver intersected with platform tools",
        authority: "authoritative",
        required: true,
        freshness: "current-only",
        degradation: "block-run",
        sourceRef: "apps/web/lib/actions/agent-coworker.ts:668 (getAvailableTools) + :713 (filterToolsForCoworkerRuntime)",
        promptLabel: "Available tools",
      },
    ],
    output: {
      writes: ["postgres:AgentMessage", "qdrant:agent-memory (inferred scope)"],
      receipts: [],
      handoff: "none",
    },
  } as const satisfies CoworkerInputContract;
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/coworker-contracts/registry/ai-coworker-chat.test.ts
  pnpm --filter web typecheck
  ```

- [ ] **Step 5: Commit** on a branch `feat/coworker-contracts-chat-declaration` off `origin/main`. Note: this branch can be created in parallel with Task 1's PR if Task 1 has merged. Otherwise wait for Task 1 to merge and rebase.

  ```powershell
  git checkout -b feat/coworker-contracts-chat-declaration origin/main
  git add apps/web/lib/coworker-contracts/registry/ai-coworker-chat.ts apps/web/lib/coworker-contracts/registry/ai-coworker-chat.test.ts apps/web/lib/coworker-contracts/index.ts
  git commit -s -m "feat(coworker-contracts): declare AI Coworker chat input contract (slice 1 task 2)"
  git push -u origin feat/coworker-contracts-chat-declaration
  gh pr create --title "feat(coworker-contracts): declare AI Coworker chat input contract" --body "Slice 1 task 2 of EP-TAK-3F9A21 / BI-MEM-5A41C7. Static declaration only — no consumers yet. Spec §8.1."
  ```

---

## Task 3: Contract loader + delivery report generator (pure)

**Files:**
- Create: `apps/web/lib/coworker-contracts/loader.ts`
- Create: `apps/web/lib/coworker-contracts/loader.test.ts`
- Modify: `apps/web/lib/coworker-contracts/index.ts` — `export * from "./loader";`

**Rationale:** A pure function that takes a contract + a "what was actually delivered" record and produces the `CoworkerContextDelivery` report. No I/O, no Prisma, no Qdrant — just shape transformation. This is the unit-testable core.

- [ ] **Step 1: Write the failing test** — cover the four report buckets (delivered / compressed / withheld / missingRequired) plus token accounting:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { aiCoworkerChatContract } from "./registry/ai-coworker-chat";
  import { computeContractDelivery, type FieldOutcome } from "./loader";

  describe("computeContractDelivery", () => {
    it("classifies fields by outcome and tallies tokens", () => {
      const outcomes: Record<string, FieldOutcome> = {
        principal_identity: { status: "delivered", tokens: 12 },
        route_context: { status: "delivered", tokens: 40 },
        recent_thread_window: { status: "compressed", tokens: 1800, reason: "token budget" },
        thread_summary: { status: "omitted", reason: "not yet implemented" },
        governed_user_facts: { status: "delivered", tokens: 230 },
        semantic_recall: { status: "withheld", reason: "stale for consequential action" },
        wiki_context: { status: "delivered", tokens: 120 },
        tool_grants: { status: "delivered", tokens: 60 },
      };
      const report = computeContractDelivery(aiCoworkerChatContract, outcomes);
      expect(report.delivered.sort()).toEqual([
        "governed_user_facts",
        "principal_identity",
        "route_context",
        "tool_grants",
        "wiki_context",
      ]);
      expect(report.compressed).toEqual(["recent_thread_window"]);
      expect(report.withheld).toEqual([{ field: "semantic_recall", reason: "stale for consequential action" }]);
      expect(report.missingRequired).toEqual([]);
      expect(report.tokenEstimate).toBe(12 + 40 + 1800 + 230 + 120 + 60);
    });

    it("flags missingRequired when a required field is not delivered or compressed", () => {
      const outcomes: Record<string, FieldOutcome> = {
        principal_identity: { status: "omitted", reason: "auth failed" },
        route_context: { status: "delivered", tokens: 40 },
        tool_grants: { status: "delivered", tokens: 60 },
      };
      const report = computeContractDelivery(aiCoworkerChatContract, outcomes);
      expect(report.missingRequired).toContain("principal_identity");
    });

    it("treats unmentioned optional fields as omitted (not delivered)", () => {
      const outcomes: Record<string, FieldOutcome> = {
        principal_identity: { status: "delivered", tokens: 12 },
        route_context: { status: "delivered", tokens: 40 },
        tool_grants: { status: "delivered", tokens: 60 },
      };
      const report = computeContractDelivery(aiCoworkerChatContract, outcomes);
      expect(report.delivered).not.toContain("thread_summary");
      expect(report.compressed).not.toContain("thread_summary");
      expect(report.withheld).not.toContainEqual({ field: "thread_summary", reason: expect.anything() });
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/coworker-contracts/loader.test.ts
  ```

- [ ] **Step 3: Write minimal implementation**

  ```typescript
  // apps/web/lib/coworker-contracts/loader.ts
  import type { CoworkerInputContract, CoworkerContextDelivery } from "./types";

  export type FieldOutcome =
    | { status: "delivered"; tokens: number }
    | { status: "compressed"; tokens: number; reason: string }
    | { status: "withheld"; reason: string }
    | { status: "omitted"; reason?: string };

  export function computeContractDelivery(
    contract: CoworkerInputContract,
    outcomes: Record<string, FieldOutcome>,
  ): CoworkerContextDelivery {
    const delivered: string[] = [];
    const compressed: string[] = [];
    const withheld: Array<{ field: string; reason: string }> = [];
    const missingRequired: string[] = [];
    let tokenEstimate = 0;

    for (const field of contract.fields) {
      const outcome = outcomes[field.name] ?? { status: "omitted" as const };
      switch (outcome.status) {
        case "delivered":
          delivered.push(field.name);
          tokenEstimate += outcome.tokens;
          break;
        case "compressed":
          compressed.push(field.name);
          tokenEstimate += outcome.tokens;
          break;
        case "withheld":
          withheld.push({ field: field.name, reason: outcome.reason });
          if (field.required) missingRequired.push(field.name);
          break;
        case "omitted":
          if (field.required) missingRequired.push(field.name);
          break;
      }
    }

    return { delivered, compressed, withheld, missingRequired, tokenEstimate };
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/coworker-contracts/loader.test.ts
  pnpm --filter web typecheck
  ```

- [ ] **Step 5: Commit** on a branch `feat/coworker-contracts-loader` off `origin/main` (after task 2 merges, or in parallel with rebase).

  ```powershell
  git checkout -b feat/coworker-contracts-loader origin/main
  git add apps/web/lib/coworker-contracts/loader.ts apps/web/lib/coworker-contracts/loader.test.ts apps/web/lib/coworker-contracts/index.ts
  git commit -s -m "feat(coworker-contracts): contract delivery report generator (slice 1 task 3)"
  git push -u origin feat/coworker-contracts-loader
  gh pr create --title "feat(coworker-contracts): contract delivery report generator" --body "Slice 1 task 3 of EP-TAK-3F9A21 / BI-MEM-5A41C7. Pure function. Spec §6 + §8.1."
  ```

---

## Task 4: Wire delivery report into `sendMessage` (observe only, no behaviour change)

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts` — both the unified branch (around lines 471–548) and the legacy branch (around lines 550–660).
- Modify: `apps/web/lib/actions/agent-coworker.test.ts` (or add a new colocated suite).

**Rationale:** Build a `FieldOutcome` map from the existing field-fetch calls, compute the delivery report, log it. Behaviour is unchanged — only observability is added. **No required-field enforcement yet** (that's Task 5).

This task is the only one that touches a hot path. Keep the diff small: compute outcomes alongside existing assignments, call `computeContractDelivery`, log once. Do not refactor existing variables. Do not move the `contextSources` array.

- [ ] **Step 1: Write the failing test** — **extend the existing happy-path `sendMessage` test in `agent-coworker.test.ts`** rather than authoring a new fixture (the file already has Prisma/recallWikiContext/buildGovernedMemoryContext mocks wired). Add a `vi.spyOn(console, "log")` capture and assert that exactly one call argv matches `["[coworker-contract]", expect.stringMatching(/"coworkerId":"ai-coworker-chat"/)]`. Parse that JSON string and assert:
  - `delivery.delivered` contains `"principal_identity"` and `"tool_grants"` for the happy path
  - `delivery.missingRequired` is empty for the happy path
  - `delivery.tokenEstimate` is a positive number

  If `agent-coworker.test.ts` has no existing happy-path test that reaches the post-`availableTools` codepath, instead add the assertion to `agent-coworker-server.test.ts` which already does (verified at task-write time). State in the PR description which existing test you extended.

- [ ] **Step 2: Run test to verify it fails**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker.test.ts
  ```

- [ ] **Step 3: Write minimal implementation** — **placement: immediately after `availableTools` is assigned (currently `apps/web/lib/actions/agent-coworker.ts:716`) and before the inference adapter call.** This is the first line reached unconditionally by both `useUnified` and legacy branches *and* where every outcome's source variable exists. Do not move it earlier — `tool_grants` derivation requires `availableTools.length`. Do not move it later — it must run before inference so the log lands when the operator looks for it.

  Assemble a `FieldOutcome` map. Approximate token counts using the existing `countTokens` utility (imported at line 448 inside the unified branch — re-import at module top for use in both branches), or `Math.ceil(s.length / 4)` for legacy-branch strings where `countTokens` was not imported in scope. The eight outcomes derive from existing locals already in scope at line 716:

  | Field | Outcome derivation (variables that exist at line 716) |
  |---|---|
  | `principal_identity` | `delivered` with `tokens: Math.ceil((user.id?.length ?? 0) / 4) + 4` (always present — auth gate at line 230 already returned `Unauthorized` if missing). |
  | `route_context` | `delivered` with tokens of `input.routeContext` (always present; both branches stash it into `populatedPrompt`). |
  | `recent_thread_window` | `delivered` if `trimmedMessages.length === recentMessages.length`, else `compressed` with `reason: "token budget"`. Tokens = `historyTokens`. |
  | `thread_summary` | `omitted` with `reason: "not yet implemented (placeholder)"` (always — see §"thread_summary placeholder" note below). |
  | `governed_user_facts` | The unified branch has `factsContext` in scope (line 466); the legacy branch has `governedMemory.factsContext` (line 651). Hoist one shared `governedMemoryFactsContext` variable to function scope to cover both. `delivered` if non-null with tokens via `countTokens` or length/4; `omitted` with `reason: "no facts"` otherwise. |
  | `semantic_recall` | Same hoist for `governedMemory.recalledContext`. `delivered` if non-null; `omitted` otherwise. |
  | `wiki_context` | Unified branch has `wikiContext` (line 531). Legacy branch does **not** call `recallWikiContext` — declare the outcome as `omitted` with `reason: "wiki recall not enabled on legacy prompt path"` in that branch. |
  | `tool_grants` | `delivered` with `tokens: availableTools.length * 30` (heuristic — fine for an observability metric); track `availableTools.length` separately as `count` if you want richer telemetry. If `availableTools.length === 0`, emit `withheld` with `reason: "no granted tools for route"` so the run blocks in Task 5. |

  Then call `computeContractDelivery(aiCoworkerChatContract, outcomes)` and emit a structured log:

  ```typescript
  // Add to the import block at the top of the file:
  import { aiCoworkerChatContract, computeContractDelivery, type FieldOutcome } from "@/lib/coworker-contracts";
  import { countTokens } from "@/lib/tak/context-arbitrator"; // already imported dynamically in unified branch — promote to module top

  // ... existing code ...

  // After line 716 (the `filterToolsForCoworkerRuntime` assignment), before any inference adapter call:
  const contractOutcomes: Record<string, FieldOutcome> = {
    principal_identity: { status: "delivered", tokens: 12 },
    route_context: { status: "delivered", tokens: countTokens(input.routeContext) },
    recent_thread_window:
      trimmedMessages.length === recentMessages.length
        ? { status: "delivered", tokens: historyTokens }
        : { status: "compressed", tokens: historyTokens, reason: "token budget" },
    thread_summary: { status: "omitted", reason: "not yet implemented (placeholder)" },
    governed_user_facts: governedMemoryFactsContext
      ? { status: "delivered", tokens: countTokens(governedMemoryFactsContext) }
      : { status: "omitted", reason: "no facts" },
    semantic_recall: governedMemoryRecalledContext
      ? { status: "delivered", tokens: countTokens(governedMemoryRecalledContext) }
      : { status: "omitted", reason: "no recall" },
    wiki_context: wikiContextForReport
      ? { status: "delivered", tokens: countTokens(wikiContextForReport) }
      : { status: "omitted", reason: useUnified ? "no wiki hit" : "wiki recall not enabled on legacy prompt path" },
    tool_grants:
      availableTools.length === 0
        ? { status: "withheld", reason: "no granted tools for route" }
        : { status: "delivered", tokens: availableTools.length * 30 },
  };
  const contractDelivery = computeContractDelivery(aiCoworkerChatContract, contractOutcomes);
  console.log(
    "[coworker-contract]",
    JSON.stringify({
      coworkerId: aiCoworkerChatContract.coworkerId,
      threadId: input.threadId,
      routeContext: input.routeContext,
      delivery: contractDelivery,
    }),
  );
  ```

  To make `governedMemoryFactsContext`, `governedMemoryRecalledContext`, and `wikiContextForReport` available at the convergence point, declare them at the top of `sendMessage` as `let governedMemoryFactsContext: string | null = null;` (etc.) and assign inside each branch where the existing locals are set. Keep the diff scoped to those additions — do not refactor the existing variables.

  **`thread_summary` placeholder note:** because this field is `required: false` + `degradation: "omit-field"` and always emits `omitted` until the rolling summary writer exists, Slice 2's Memory Contract Inspector should suppress always-omitted placeholder fields from the "withheld/missing" panel to avoid permanent noise. Flag this in the Slice 2 plan when it's written; out-of-scope for Slice 1 implementation.

- [ ] **Step 4: Run test to verify it passes; run typecheck + production build per AGENTS.md §5**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker.test.ts
  pnpm --filter web typecheck
  cd apps/web; pnpm exec next build; cd ../..
  ```

  Expected: vitest passes, typecheck exits 0, `next build` completes with zero errors.

- [ ] **Step 5: UX verification per AGENTS.md §5(3)** — start the Docker portal (`docker compose up -d portal portal-init`), log in as `admin@dpf.local` with `ADMIN_PASSWORD` from repo-root `.env`, send a message in any coworker chat (e.g. `/storefront` page), then tail the portal logs and confirm one `[coworker-contract] {...}` JSON line appears with eight fields classified. **State explicitly in the PR description** which routes were exercised and paste one anonymised log line.

- [ ] **Step 6: Commit** on a branch `feat/coworker-contracts-delivery-observability` off `origin/main`:

  ```powershell
  git checkout -b feat/coworker-contracts-delivery-observability origin/main
  git add apps/web/lib/actions/agent-coworker.ts apps/web/lib/actions/agent-coworker.test.ts
  git commit -s -m "feat(coworker-contracts): emit delivery report from sendMessage (slice 1 task 4)"
  git push -u origin feat/coworker-contracts-delivery-observability
  gh pr create --title "feat(coworker-contracts): emit delivery report from sendMessage" --body "Slice 1 task 4 of EP-TAK-3F9A21 / BI-MEM-5A41C7. Observability-only — no behaviour change. UX verified on routes [list]. Spec §8.1."
  ```

---

## Task 5: Required-field enforcement (degradation behaviour)

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts` — add the enforcement check after `computeContractDelivery`.
- Modify: `apps/web/lib/actions/agent-coworker.test.ts` — assert the run blocks when a required field is missing.

**Rationale:** Activate the `block-run` degradation behaviour from Task 2's declaration for the two `required: true` fields (`principal_identity`, `tool_grants`). Any other declared `block-run` field that lands in `missingRequired` also blocks. Non-blocking degradations (`omit-field`, `compress`, `fallback-to-primary-source`) continue without intervention in Slice 1.

**Important:** `principal_identity` is already guarded by `requireAuthUser()` at the top of `sendMessage` — by the time Task 4's outcome map runs, the auth check has already returned `Unauthorized` if missing. `tool_grants` is the field most likely to surface in `missingRequired`: Task 4 step 3 emits `withheld` when `availableTools.length === 0`, which lands in `missingRequired` because `tool_grants` is `required: true`. Task 5 turns that into a visible run-block instead of a silent tools-less response. **This is the only behavioural change Slice 1 introduces.**

- [ ] **Step 1: Write the failing test** — assert that `sendMessage` returns an `error` shape (matching the existing `{ error: string }` return arm) when `availableTools` is empty AND the contract's `tool_grants` field has `degradation: "block-run"`. Stub `getAvailableTools` to return `[]`.

  ```typescript
  it("blocks the run when tool_grants are empty and degradation is block-run", async () => {
    // ...mock getAvailableTools to return []
    const result = await sendMessage({ threadId: "t", content: "hello", routeContext: "/somewhere" });
    expect(result).toMatchObject({ error: expect.stringContaining("tool_grants") });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker.test.ts
  ```

- [ ] **Step 3: Write minimal implementation** — after `computeContractDelivery`, check for `block-run` degradations among `missingRequired`:

  ```typescript
  const blockingMissing = contractDelivery.missingRequired.filter((name) => {
    const field = aiCoworkerChatContract.fields.find((f) => f.name === name);
    return field?.degradation === "block-run";
  });
  if (blockingMissing.length > 0) {
    return {
      error: `Coworker contract violation — required fields missing or withheld: ${blockingMissing.join(", ")}. See [coworker-contract] log for details.`,
    };
  }
  ```

  Place the check immediately after the `console.log` from Task 4. Keep the diff additive.

- [ ] **Step 4: Run test to verify it passes; run typecheck + production build**

  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker.test.ts
  pnpm --filter web typecheck
  cd apps/web; pnpm exec next build; cd ../..
  ```

- [ ] **Step 5: UX verification per AGENTS.md §5(3)** — concrete repro:
  1. On a throwaway branch, edit `packages/db/data/agent_registry.json` and temporarily set `config_profile.tool_grants` to `[]` for the route coworker assigned to a non-critical route (e.g. `coworker-storefront`). The registry is imported at module load (`apps/web/lib/tak/agent-grants.ts:2`) — a portal rebuild is required.
  2. `docker compose build --no-cache portal portal-init && docker compose up -d portal portal-init`.
  3. Log in as `admin@dpf.local`, visit the affected route, send a message.
  4. Expect the coworker panel to render the contract-violation error string from Task 5 Step 3 (containing `tool_grants`) instead of a silent empty response.
  5. Tail portal logs and confirm one `[coworker-contract]` JSON line shows `tool_grants` in `missingRequired` and `withheld`.
  6. Revert the `agent_registry.json` edit; the throwaway branch never lands in PR. Capture the panel text and one log line in the Task 5 PR description.

- [ ] **Step 6: Commit** on a branch `feat/coworker-contracts-block-run` off `origin/main`:

  ```powershell
  git checkout -b feat/coworker-contracts-block-run origin/main
  git add apps/web/lib/actions/agent-coworker.ts apps/web/lib/actions/agent-coworker.test.ts
  git commit -s -m "feat(coworker-contracts): block run on missing required fields (slice 1 task 5)"
  git push -u origin feat/coworker-contracts-block-run
  gh pr create --title "feat(coworker-contracts): block run on missing required fields" --body "Slice 1 task 5 of EP-TAK-3F9A21 / BI-MEM-5A41C7. Activates the block-run degradation behaviour declared in task 2. UX verified by [scenario]. Spec §6 + §8.1."
  ```

---

## Slice 1 completion checklist

- [ ] All five tasks merged via separate PRs
- [ ] `apps/web/lib/coworker-contracts/` contains: `types.ts`, `loader.ts`, `index.ts`, `registry/ai-coworker-chat.ts`, plus matching tests
- [ ] `sendMessage` emits one `[coworker-contract]` log per call
- [ ] `sendMessage` returns the `{ error }` arm with a contract violation message when required fields are missing
- [ ] No Prisma migration was created
- [ ] No Qdrant payload schema changed
- [ ] No new admin UI (the Memory Contract Inspector is Slice 2)
- [ ] `BI-MEM-5A41C7` status remains `open` (Slice 1 is foundational; subsequent slices close the BI)
- [ ] Spec section 10's Slice 1 row in the phasing table is annotated "delivered in [list of PR numbers]" via a follow-up doc PR

---

## Operational discipline (apply to every task)

- **DCO sign-off required.** Every commit uses `git commit -s`. The DCO bot blocks merge until every commit has a `Signed-off-by:` trailer (per AGENTS.md §4).
- **Worktree discipline.** Each task PR comes from its own branch off `origin/main`. Do not stack the five branches; each is independent. (See `AGENTS.md` §4 and the user's `feedback_worktree_base_origin_main` memory.)
- **Concurrent-session guard.** Always pass explicit file paths to `git add` and `git commit` (no `git add -A`). (See `feedback_git_commit_only_for_concurrent_sessions` memory.)
- **Pre-push overlap sweep.** Before each `git push`, run `git fetch origin && gh pr list --state open --search "coworker-contracts"` and confirm nobody else has opened an overlapping PR. (See `feedback_pr_overlap_check_before_pushing` memory.)
- **No mention of "Generated with Claude Code"** in the commit body; the trailer goes only in the PR description per existing conventions (DCO trailer line at end of commit is sufficient).

---

## Out of scope for Slice 1

The following items are explicitly **NOT** part of Slice 1 — they live in Slice 2+ per spec §10:

- The Memory Contract Inspector UI (Slice 2)
- Qdrant payload changes (authority field on `agent-memory` points — Slice 3)
- `PhaseHandoff` enforcement (Slice 4)
- Section-aware spec/plan retriever (Slice 5)
- `TaskRun` continuation summary (Slice 6)
- Neo4j build-graph projection (Slice 7)
- Rediscovery-rate metrics on the coworker panel (Slice 8)
- Authoring P9–P11 wiki kernel pages (deferred to a future principles batch once enforcement evidence is in hand per PR #570 / #592 cadence)
- Contracts for any coworker other than AI Coworker chat (subsequent Slice 1.x follow-ups can declare the Build Studio phase contracts, Hive Scout, Scheduled, etc.)
