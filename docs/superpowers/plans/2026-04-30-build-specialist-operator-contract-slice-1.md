# Build Specialist Operator Contract — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land Slice 1 (Contract Enforcement) of [the Build Specialist Operator Contract spec](../specs/2026-04-30-build-specialist-operator-contract.md): resolve the missing canonical-pattern dependency, rewrite the build-specialist prompt with the operator contract, deliver the missing `report_quality_issue` tool, add platform-side enforcement guards in the agentic loop, ship the `PlatformIssueReport.featureBuildId` migration, and prove the BI-E9CD1B92 Ideate path saves evidence instead of refusing callable tools.

**Architecture:** Three behavioral layers — (1) declarative system prompt that tells the LLM what it owes the platform per turn (clauses 2.1-2.9 of the spec); (2) curated runtime tool list per route at `apps/web/lib/tak/route-context-map.ts:460-540`; (3) agentic-loop guards in `apps/web/lib/tak/agentic-loop.ts` (re-exported by `apps/web/lib/agentic-loop.ts`) that detect contract violations the LLM cannot self-report. The new guards share one small issue-report writer instead of scattering raw `prisma.platformIssueReport.create()` calls. State lives on existing `FeatureBuild` JSON columns and `PlatformIssueReport` rows with one nullable FK column added in this slice.

**Test strategy clarification:** The four LLM-prompt-behavior clauses (2.3 short-confirmations-advance, 2.7 no-repeat-diagnosis, 2.8 clear-next-step, 2.9 one-clarification-cap) are verified via two layers in Slice 1: (a) prompt-text structural assertions in Task 3 confirm the clause language is present in the prompt, and (b) the BI-E9CD1B92 acceptance demo (Task 9) exercises them with a live LLM at least through Ideate. Mock-LLM behavioral unit tests for these four clauses are deferred. Slice 1 ships the contract definition plus deterministic platform-enforced clauses (2.4, 2.6).

**Tech Stack:** Next.js 16, Prisma 7.x, TypeScript, Vitest, pnpm workspaces. Runtime: Docker-served portal + sandbox per AGENTS.md §13.

**Critical context for implementer (no codebase familiarity assumed):**

- **Spec:** Read `docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md` end-to-end before starting. The contract clauses in §2 are the source of truth for prompt content.
- **Dependency gate:** The spec currently records that `docs/superpowers/specs/2026-04-30-ai-coworker-operator-pattern.md` is missing from this worktree. Before code edits, either merge/copy the wave-1 canonical pattern artifact or update the spec with the correct canonical link. Do not implement against a broken cross-spec reference.
- **Slice scope:** This plan is Slice 1 only. Slices 2 (Build Studio UI visibility) and 3 (build skill playbooks) are deferred to follow-up plans. Do not implement them.
- **AGENTS.md:** Read `/AGENTS.md` first. Especially §4 (Branching, Commits & PRs — DCO `git commit -s` required, PR against main, branch from main, never push to main, never use `--no-verify`), §5 (Verification — focused Vitest, production build, migration applies cleanly), §3 (string enums use lowercase + hyphens), §12 (theme-aware styling — no hardcoded colors).
- **The original failure today:** the build-specialist prompt at `prompts/route-persona/build-specialist.prompt.md:62-66` told the LLM its tool grants were currently empty and pending follow-on assignment. The LLM trusted the prompt and refused to call its tools. That language is removed by this slice.
- **Existing guards in `agentic-loop.ts` (don't reinvent):** `detectFabrication()` at line 117, `shouldNudge()` at 189, repetition detector at 564, fabrication-recovery nudge at 141, frustration guardrail at 861. Add the three new guards as peers, not replacements.
- **Test runner:** use pinned workspace commands: `pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts` for loop tests, `pnpm --filter @dpf/db exec prisma migrate dev --name <name>` for migrations, and `pnpm --filter web build` for the production build gate before PR.

---

## Branch and worktree setup

This plan executes on a fresh feature branch. Do not reuse the branch where the spec was committed.

```powershell
# From D:\DPF, create a worktree + branch from main
git worktree add D:\DPF-bs-operator-slice-1 -b feat/bs-operator-contract-slice-1 main
Set-Location D:\DPF-bs-operator-slice-1
git branch --show-current
```

Expected branch: `feat/bs-operator-contract-slice-1`. If it prints `main`, stop.

All file paths in this plan are repo-relative. All `git commit` commands use `-s` (DCO sign-off, mandatory).

---

## Task 1: Schema migration — add `featureBuildId` to `PlatformIssueReport`

**Why:** Slice 1 guards write `PlatformIssueReport` rows when the contract is violated. Slice 2's UI surface (planned next) needs to filter by build. The column is additive, nullable, low-risk.

**Files:**
- Modify: `packages/db/prisma/schema.prisma:2945-2967` (PlatformIssueReport model — add field + relation)
- Modify: `packages/db/prisma/schema.prisma` (FeatureBuild model — add inverse relation)
- Create: `packages/db/prisma/migrations/<timestamp>_add_feature_build_id_to_platform_issue_report/migration.sql` (Prisma generates)

**Steps:**

- [ ] **Step 1: Read current PlatformIssueReport model**
  ```powershell
  rg -n -A 25 "^model PlatformIssueReport" packages/db/prisma/schema.prisma
  ```
  Expected: model spans lines 2945-2967; fields include `agentId`, `routeContext`, `digitalProductId`, `portfolioId`. No `featureBuildId`.

- [ ] **Step 2: Read FeatureBuild model location**
  ```powershell
  rg -n "^model FeatureBuild" packages/db/prisma/schema.prisma
  ```
  Note the line number. The inverse relation goes there.

- [ ] **Step 3: Add `featureBuildId` field + relation to PlatformIssueReport**
  Edit `packages/db/prisma/schema.prisma`. Inside the `PlatformIssueReport` model, after the `agentId` line:
  ```prisma
    featureBuildId      String?
    featureBuild        FeatureBuild? @relation(fields: [featureBuildId], references: [id], onDelete: SetNull)
  ```
  Add an index beside the relation:
  ```prisma
    @@index([featureBuildId])
  ```
  Place the index alongside any existing `@@index` declarations on the model.

- [ ] **Step 4: Add inverse relation on FeatureBuild**
  In the FeatureBuild model, add:
  ```prisma
    issueReports        PlatformIssueReport[]
  ```

- [ ] **Step 5: Validate the schema**
  ```powershell
  pnpm --filter @dpf/db exec prisma format
  pnpm --filter @dpf/db exec prisma validate
  ```
  Expected: no errors.

- [ ] **Step 6: Generate the migration**
  ```powershell
  pnpm --filter @dpf/db exec prisma migrate dev --name add_feature_build_id_to_platform_issue_report
  ```
  Expected: migration file created, applied to local DB, Prisma client regenerated.

- [ ] **Step 7: Verify migration is reversible-safe**
  ```powershell
  Get-Content packages/db/prisma/migrations/*add_feature_build_id_to_platform_issue_report*/migration.sql
  ```
  Expected SQL: `ALTER TABLE "PlatformIssueReport" ADD COLUMN "featureBuildId" TEXT;` plus FK + index. No `NOT NULL`, no destructive ops.

- [ ] **Step 8: Run typecheck on the db package and web app**
  ```powershell
  pnpm --filter @dpf/db typecheck && pnpm --filter web typecheck
  ```
  Expected: zero errors. The new field becomes available in the Prisma client types.

- [ ] **Step 9: Commit**
  ```powershell
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
  git commit -s -m "feat(db): add featureBuildId FK to PlatformIssueReport"
  ```

---

## Task 2: Deliver `report_quality_issue` to the `/build` route

**Why:** Clause 2.6 of the contract gives the agent a way to log genuine, non-platform-detected issues. Today `report_quality_issue` exists in `apps/web/lib/mcp-tools.ts:496-510` but is NOT in the `/build` route's `domainTools` array, so the build-specialist never sees it.

**Files:**
- Modify: `apps/web/lib/tak/route-context-map.ts:460-540` (the `/build` entry — add the tool to `domainTools`)
- Create: `apps/web/lib/tak/route-context-map.test.ts` (assertion test if file does not exist; otherwise add test case)

**Steps:**

- [ ] **Step 1: Confirm the existing tool definition**
  ```powershell
  rg -n -A 15 'name: "report_quality_issue"' apps/web/lib/mcp-tools.ts
  ```
  Expected: tool exists at line ~496 with type enum `[runtime_error, user_report, feedback]` and required fields `[type, title]`.

- [ ] **Step 2: Confirm the /build domainTools array shape**
  ```powershell
  Select-String -Path apps/web/lib/tak/route-context-map.ts -Pattern '"/build": \{' -Context 0,60
  ```
  Expected: `domainTools` array starting around line 477.

- [ ] **Step 3: Write a failing test that asserts `report_quality_issue` is in /build's tool list**
  Create or extend `apps/web/lib/tak/route-context-map.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { ROUTE_CONTEXT_MAP } from "./route-context-map";

  describe("ROUTE_CONTEXT_MAP /build domainTools", () => {
    it("delivers report_quality_issue so the build-specialist can log genuine process issues per the operator contract clause 2.6", () => {
      const buildRoute = ROUTE_CONTEXT_MAP["/build"];
      expect(buildRoute).toBeDefined();
      expect(buildRoute!.domainTools).toContain("report_quality_issue");
    });
  });
  ```

- [ ] **Step 4: Run the test to verify it fails**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/route-context-map.test.ts
  ```
  Expected: test fails with "expected array to contain 'report_quality_issue'".

- [ ] **Step 5: Add the tool to /build domainTools**
  In `apps/web/lib/tak/route-context-map.ts`, locate the `/build` entry's `domainTools` array (around line 477-540). Add `"report_quality_issue"` to the array. Place it near other governance/reporting tools (search for `register_tech_debt` or similar; group with that). Do not reorder existing entries.

- [ ] **Step 6: Run the test to verify it passes**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/route-context-map.test.ts
  ```
  Expected: test passes.

- [ ] **Step 7: Run full vitest on the tak directory**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/
  ```
  Expected: no regressions.

- [ ] **Step 8: Commit**
  ```powershell
  git add apps/web/lib/tak/route-context-map.ts apps/web/lib/tak/route-context-map.test.ts
  git commit -s -m "feat(coworkers): deliver report_quality_issue to build-specialist (contract clause 2.6)"
  ```

---

## Task 3: Rewrite `build-specialist.prompt.md` with the Operator Contract

**Why:** The old `# Tools Available` and `# Operating Rules` sections cause the LLM to refuse callable tools (today's failure mode). The new `# Operator Contract` (spec §2 clauses 2.1-2.9) tells the LLM what it owes the platform per turn.

**Files:**
- Modify: `prompts/route-persona/build-specialist.prompt.md` (replace two sections, preserve the rest, bump version)
- Create: `apps/web/lib/tak/build-specialist-prompt.test.ts` (snapshot/structural tests)

**Steps:**

- [ ] **Step 1: Read the current prompt end-to-end**
  ```powershell
  Get-Content prompts/route-persona/build-specialist.prompt.md
  ```
  Confirm: frontmatter `version: 3`; `# Role` / `# Accountable For` / `# Interfaces With` / `# Out Of Scope` / `# Tools Available` / `# Operating Rules` sections present. Slice 1 keeps the first four; replaces the last two.

- [ ] **Step 2: Write a failing test for prompt structure**
  Create `apps/web/lib/tak/build-specialist-prompt.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { readFileSync } from "fs";
  import { join } from "path";

  const PROMPT_PATH = join(process.cwd(), "../../prompts/route-persona/build-specialist.prompt.md");
  const prompt = readFileSync(PROMPT_PATH, "utf-8");

  describe("build-specialist.prompt.md", () => {
    it("has frontmatter version 4 (operator contract update)", () => {
      expect(prompt).toMatch(/^version:\s*4$/m);
    });

    it("preserves the role-defining sections", () => {
      expect(prompt).toMatch(/^# Role$/m);
      expect(prompt).toMatch(/^# Accountable For$/m);
      expect(prompt).toMatch(/^# Interfaces With$/m);
      expect(prompt).toMatch(/^# Out Of Scope$/m);
    });

    it("removes the stale 'currently []' tool-grant language that caused tool refusal", () => {
      expect(prompt).not.toMatch(/currently `\[\]`/);
      expect(prompt).not.toMatch(/pending follow-on assignment/);
      expect(prompt).not.toMatch(/once the per-agent grant/);
    });

    it("contains the # Operator Contract section", () => {
      expect(prompt).toMatch(/^# Operator Contract$/m);
    });

    it("references the nine contract clauses by intent", () => {
      // Clause 2.2: phase advance illegal without saved evidence
      expect(prompt).toMatch(/saveBuildEvidence/);
      // Clause 2.3: short confirmations advance
      expect(prompt).toMatch(/\bok\b|\bproceed\b|\bcontinue\b/);
      // Clause 2.6: tool failure / refusal honesty
      expect(prompt).toMatch(/report_quality_issue|never claim a tool is unavailable/i);
      // Clause 2.8: clear next step
      expect(prompt).toMatch(/clear next step|never finish a turn/i);
    });
  });
  ```

- [ ] **Step 3: Run the test to verify it fails**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/build-specialist-prompt.test.ts
  ```
  Expected: multiple failures.

- [ ] **Step 4: Edit the prompt — bump frontmatter version**
  In `prompts/route-persona/build-specialist.prompt.md` line 6, change `version: 3` to `version: 4`.

- [ ] **Step 5: Replace `# Tools Available` and `# Operating Rules` with `# Operator Contract`**

  Delete the entire block from `# Tools Available` (line 62) through end of `# Operating Rules` (line 80). Replace with the following content (matches spec §2 clauses 2.1-2.9):

  ```markdown
  # Operator Contract

  The platform delivers your callable tool list each turn. Trust it. If a tool name appears in the list, you can call it — never refuse based on prompt-time beliefs about what you should or should not have.

  ## 1. Domain perspective

  Features as code, schemas, components, and tests across the five build phases: Ideate > Plan > Build > Review > Ship. The current build's `phase` and saved evidence are page state — reference them, do not re-derive.

  ## 2. Concrete work product — phase advance is illegal without it

  | Phase | Required field on `FeatureBuild` | Saved by |
  | ----- | -------------------------------- | -------- |
  | Ideate → Plan | `designDoc` | `saveBuildEvidence({ field: "designDoc", value })` |
  | Plan → Build | `buildPlan` | `saveBuildEvidence({ field: "buildPlan", value })` |
  | Build → Review | `taskResults` | sub-agent dispatch via orchestrator |
  | Review → Ship | `verificationOut`, `acceptanceMet` | `saveBuildEvidence` for each |
  | Ship → Complete | release-gate decision | AGT-ORCH-300 (out of scope for this coworker) |

  A turn that the user sees as "done with this phase" without the corresponding field saved is a contract violation, not a polite stopping point.

  ## 3. Short confirmations advance

  `ok`, `yes`, `proceed`, `next`, `continue`, `go` advance the active phase using the most recent saved evidence. They do not restart research. If `designDoc` was saved last turn and the user says `ok`, the next turn calls `reviewDesignDoc` — not `start_ideate_research` again.

  ## 4. Save before final response

  If the turn produces a designDoc, plan, task-result interpretation, verification reading, or acceptance call, `saveBuildEvidence` for the corresponding field is invoked before the closing chat message. The chat message references what was saved; it does not narrate the work as ephemeral.

  ## 5. Approval gate — narrow

  This clause does **not** override the existing build-phase auto-execution sequencing. It is narrow on purpose.

  **Gated actions — require explicit user approval:**

  - opening a PR (sandbox → portal repo)
  - merging a PR
  - promoting a build to release-gate decision (handoff to AGT-ORCH-300)
  - mutating production portal state

  **Auto-proceeds — DO NOT pause for these:**

  - sandbox file edits, schema migrations, test runs, git diffs inside the sandbox
  - `saveBuildEvidence` writes to `FeatureBuild`
  - `save_phase_handoff` calls
  - `start_ideate_research`, `reviewDesignDoc`, `reviewBuildPlan`, and other internal review tools
  - any read-only tool

  Approval today is UI-driven — surface the gated action in chat, the user clicks the existing button on `FeatureBuild`. The existing build-phase rule "Do not pause for routine go-ahead requests during planned build work" remains correct and unaltered. This clause only triggers when you are specifically attempting one of the four gated actions, which in practice means at Ship phase or when handing off to AGT-ORCH-300.

  ## 6. Tool failure honesty

  Never claim a tool is unavailable when it appears in your delivered tool list. Never fabricate success. Never silently skip a phase-required action. For genuine, agent-detected issues, call `report_quality_issue` with `type=runtime_error` and a `[coworker-process]`-prefixed title. Platform-side guards detect zero-tool-call iterations and tool-refused-despite-availability claims and write `PlatformIssueReport` rows automatically — your obligation is honesty, not self-reporting your own hallucinations.

  ## 7. No-repeat-diagnosis

  If the prior turn's saved evidence already covers the user's current message, advance rather than re-running the same diagnostic. "We already saved the design doc; advancing to plan" beats "let me look at the page again."

  ## 8. Always end with a clear next step

  Every turn ends with the user knowing exactly what comes next: the phase to move to, the action you are about to take, or the input you need from the user. Never finish a turn with the user uncertain.

  ## 9. One clarification round maximum

  If a clarifying question is needed, ask once, then act on whatever the user answered. If the user has already answered, do not re-ask. Repeated clarification feels like stalling.
  ```

- [ ] **Step 6: Run the test to verify it passes**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/build-specialist-prompt.test.ts
  ```
  Expected: all five test cases pass.

- [ ] **Step 7: Verify the prompt loads via the existing prompt assembly path**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/prompt-assembler.test.ts
  ```
  Expected: no regressions. This repo has `prompt-assembler.test.ts`; there is no `prompt-loader.test.ts` in the current worktree.

- [ ] **Step 8: Commit**
  ```powershell
  git add prompts/route-persona/build-specialist.prompt.md apps/web/lib/tak/build-specialist-prompt.test.ts
  git commit -s -m "feat(coworkers): rewrite build-specialist with operator contract (clauses 2.1-2.9)"
  ```

---

## Task 4: Platform-side guard — tool-refused-despite-availability detection

**Why:** Clause 2.6 platform path. When the LLM's text response asserts a tool is unavailable AND that tool name appears in the iteration's delivered tool list, write a `PlatformIssueReport` row.

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts` (add detector function + invocation site)
- Modify: `apps/web/lib/tak/agentic-loop.test.ts` (add test case)

**Pre-task — verify `PlatformIssueReport` model required fields:** Open `packages/db/prisma/schema.prisma` and find `model PlatformIssueReport`. List which fields are required (no `?` and no default). Today (verified 2026-04-30) they are: `reportId`, `type`, `title`. Everything else is nullable or has a default. The `create()` call in this task MUST provide at least those three plus the new `featureBuildId` from Task 1 — confirm against the live schema before writing the call. If the schema has changed, update the field list accordingly.

**Refactoring rule for the guard tasks:** Spend the small refactoring budget here. Add one helper in `agentic-loop.ts`, e.g. `writeCoworkerProcessIssue(...)`, that owns `reportId`, `type`, `severity`, `status`, `routeContext`, `agentId`, `source`, `featureBuildId`, and defensive `.catch()` behavior. Tasks 4-6 call the helper; do not paste three raw `prisma.platformIssueReport.create()` blocks.

**Steps:**

- [ ] **Step 1: Read the existing `FRUSTRATION_PATTERN` regex at line 83**
  ```powershell
  rg -n "FRUSTRATION_PATTERN" apps/web/lib/tak/agentic-loop.ts
  ```
  This pattern already detects "I cannot / am unable / don't have access / don't have a tool" — extend the same shape for tool-refused-despite-availability.

- [ ] **Step 2: Write a failing test**
  In `apps/web/lib/tak/agentic-loop.test.ts`, add:
  ```ts
  import { detectToolRefusedDespiteAvailability } from "./agentic-loop";

  describe("detectToolRefusedDespiteAvailability (contract clause 2.6 platform path)", () => {
    const tools = [{ name: "start_ideate_research", description: "x" }, { name: "saveBuildEvidence", description: "x" }];

    it("returns the tool name when response asserts unavailability of a delivered tool", () => {
      const response = "Blocker: start_ideate_research is not available in the current runtime.";
      expect(detectToolRefusedDespiteAvailability(response, tools)).toBe("start_ideate_research");
    });

    it("returns null when response does not assert unavailability", () => {
      const response = "I'll call start_ideate_research now.";
      expect(detectToolRefusedDespiteAvailability(response, tools)).toBeNull();
    });

    it("returns null when the named tool is genuinely not in the delivered list", () => {
      const response = "I cannot call do_something_else because it's not available.";
      expect(detectToolRefusedDespiteAvailability(response, tools)).toBeNull();
    });

    it("matches alternate phrasings: not enabled, missing, currently empty", () => {
      expect(detectToolRefusedDespiteAvailability(
        "saveBuildEvidence isn't enabled yet — pending grants.", tools,
      )).toBe("saveBuildEvidence");
      expect(detectToolRefusedDespiteAvailability(
        "The tool grants are currently `[]` for this persona.", tools,
      )).not.toBeNull(); // matches via "currently []" phrase
    });
  });
  ```

- [ ] **Step 3: Run the test to verify it fails**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts -t "detectToolRefusedDespiteAvailability"
  ```
  Expected: function does not exist; tests fail with "is not a function" or import error.

- [ ] **Step 4: Implement the detector**
  In `apps/web/lib/tak/agentic-loop.ts`, add (place it near `detectFabrication` around line 117):
  ```ts
  /**
   * Contract clause 2.6 platform path: detect when the agent's text asserts a tool
   * is unavailable AND that tool name appears in its delivered tool list. Returns
   * the offending tool name, or null. Caller is responsible for writing the
   * PlatformIssueReport.
   */
  export function detectToolRefusedDespiteAvailability(
    responseText: string,
    deliveredTools: Array<{ name: string }>,
  ): string | null {
    if (!responseText) return null;
    const refusalPattern = /(?:not (?:available|enabled|granted|callable|in (?:my )?tool list|exposed)|isn['']t (?:available|enabled|granted|callable|in (?:my )?tool list|exposed)|missing|currently `?\[\]`?|pending (?:follow-on |grant)|don['']t have (?:access|the ability)) (?:in|for|to|yet|now)?/i;
    if (!refusalPattern.test(responseText)) return null;
    // Find which delivered tool the agent named. Simple substring match against
    // each tool name (LLMs use the literal name in refusals).
    for (const tool of deliveredTools) {
      if (responseText.includes(tool.name)) return tool.name;
    }
    // No specific tool named, but a generic "currently []" / "pending grants" claim
    // is still a contract violation — return a sentinel so the caller logs it.
    if (/currently `?\[\]`?|pending (?:follow-on |grant)/i.test(responseText)) {
      return "(unspecified — generic refusal)";
    }
    return null;
  }
  ```

- [ ] **Step 5: Run the test to verify it passes**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts -t "detectToolRefusedDespiteAvailability"
  ```
  Expected: all four cases pass.

- [ ] **Step 6: Add the shared issue writer and wire the detector into the loop**
  Near the no-tool-calls branch, call the shared helper with the optional build attribution passed by Task 5. Shape:
  ```ts
  // Contract clause 2.6 platform path: tool-refused-despite-availability
  const refusedToolName = detectToolRefusedDespiteAvailability(trimmed, tools);
  if (refusedToolName) {
    await writeCoworkerProcessIssue({
      threadId,
      routeContext,
      agentId,
      featureBuildId: params.featureBuildId ?? null,
      severity: "high",
      title: `[coworker-process] tool-refused-despite-availability: ${refusedToolName}`,
      description: `Agent ${agentId} on route ${routeContext} asserted that ${refusedToolName} is unavailable in iteration ${iteration}, but the tool was in the delivered tool list. Response excerpt: ${trimmed.slice(0, 500)}`,
    });
  }
  ```

- [ ] **Step 7: Add an integration test that asserts the row was written**
  In `apps/web/lib/tak/agentic-loop.test.ts`, add a test that mocks `routeAndCall` to return a refusal-and-zero-toolcalls response and asserts a `PlatformIssueReport` row was created with the expected `title` (matching `[coworker-process] tool-refused-despite-availability:`). The existing test file already mocks `@dpf/db` but only includes `agentModelConfig` and `toolExecution`; extend that mock with `platformIssueReport: { create: vi.fn() }`. Do not settle for `console.warn` spying.

- [ ] **Step 8: Run the loop tests**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts
  ```
  Expected: all pass, no regressions.

- [ ] **Step 9: Commit**
  ```powershell
  git add apps/web/lib/tak/agentic-loop.ts apps/web/lib/tak/agentic-loop.test.ts
  git commit -s -m "feat(tak): detect tool-refused-despite-availability and write PlatformIssueReport (contract clause 2.6)"
  ```

---

## Task 5: Platform-side guard — zero-tool-call detection on phase-required turns

**Why:** Clause 2.6 platform path. When `toolCalls=0` AND the active build phase plus response shape indicate the agent attempted phase work, write a `PlatformIssueReport` row. This catches the silent-stall case without flagging normal status answers or the one allowed clarification round.

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts` (add detector + invocation)
- Modify: `apps/web/lib/tak/agentic-loop.test.ts` (test cases)

**Note on phase detection:** the current loop receives `routeContext` (e.g. `/build`) but not the active build phase. `routeContext` plus the build's current phase (read from `FeatureBuild.phase` via `threadId` or via a passed parameter) is needed. Two options:

- **Option A (preferred for Slice 1):** Add optional `buildPhase` and `featureBuildId` parameters to `runAgenticLoop` params; the caller (`apps/web/lib/actions/agent-coworker.ts` — search for `runAgenticLoop` call sites) reads `FeatureBuild.phase` and `id` and passes them. Falls back to `null` for non-build routes; the guards only fire when build context is set.
- **Option B (deferred):** the guard queries the DB for the active build by threadId. Requires more orchestration; skip for Slice 1.

Use Option A.

**Steps:**

- [ ] **Step 1: Read existing call sites of `runAgenticLoop`**
  ```powershell
  rg -n "runAgenticLoop\(" apps/web/lib apps/web/app
  ```
  Expected: ~3-5 call sites. Identify the one in `apps/web/lib/actions/agent-coworker.ts` that handles the /build route.

- [ ] **Step 2: Write failing tests**
  Add to `apps/web/lib/tak/agentic-loop.test.ts`:
  ```ts
  import { isPhaseWorkAttemptWithoutTools } from "./agentic-loop";

  describe("isPhaseWorkAttemptWithoutTools (contract clause 2.6)", () => {
    it("flags phase-work claims in active build phases", () => {
      expect(isPhaseWorkAttemptWithoutTools("ideate", "I drafted the design doc and we can advance.")).toBe(true);
      expect(isPhaseWorkAttemptWithoutTools("plan", "The build plan is ready.")).toBe(true);
    });

    it("does not flag ordinary status answers or the first clarification", () => {
      expect(isPhaseWorkAttemptWithoutTools("ideate", "This build is currently in Ideate.")).toBe(false);
      expect(isPhaseWorkAttemptWithoutTools("ideate", "Who is the primary user?")).toBe(false);
      expect(isPhaseWorkAttemptWithoutTools(null, "The design doc is ready.")).toBe(false);
    });
  });
  ```

- [ ] **Step 3: Verify failure**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts -t "isPhaseWorkAttemptWithoutTools"
  ```

- [ ] **Step 4: Implement**
  In `agentic-loop.ts`, add near the other detector functions:
  ```ts
  /**
   * Contract clause 2.6 platform path: zero-tool-call guard. Conservative:
   * only fires when the active build phase plus final text indicates attempted
   * phase work, not ordinary status answers or the first clarification question.
   */
  export function isPhaseWorkAttemptWithoutTools(
    phase: string | null | undefined,
    responseText: string,
  ): boolean {
    if (!phase) return false;
    if (!["ideate", "plan", "build", "review"].includes(phase)) return false;
    const text = responseText.trim();
    if (text.length < 250 && /\?$/.test(text)) return false;
    return /\b(design\s+doc|build\s+plan|verification|acceptance|advance|ready|saved|completed|done|blocked|not available|can't|cannot)\b/i.test(text);
  }
  ```

- [ ] **Step 5: Add build attribution params to `runAgenticLoop`**
  In `agentic-loop.ts:387-403`, add to the params type:
  ```ts
    /**
     * Optional active build phase ('ideate' | 'plan' | 'build' | 'review' | 'ship'
     * | 'complete'). Set by /build route callers from FeatureBuild.phase. When
     * set and equal to a phase that requires a tool call, a turn that produces
     * zero tool calls writes a PlatformIssueReport (contract clause 2.6 platform path).
     */
    buildPhase?: string | null;
    featureBuildId?: string | null;
  ```
  Destructure it alongside the other params at line 388.

- [ ] **Step 6: Wire the guard at the no-tool-calls branch**
  In the same block where Task 4's guard fires (after the `[agentic-loop] iter=...` console.log), add:
  ```ts
  // Contract clause 2.6 platform path: zero-tool-call on attempted phase work
  if (executedTools.length === 0 && isPhaseWorkAttemptWithoutTools(params.buildPhase, trimmed)) {
    console.warn(`[agentic-loop] contract-violation zero-tool-call phase=${params.buildPhase}`);
    await writeCoworkerProcessIssue({
      threadId,
      routeContext,
      agentId,
      featureBuildId: params.featureBuildId ?? null,
      severity: "high",
      title: `[coworker-process] zero-tool-call on phase=${params.buildPhase}`,
      description: `Agent ${agentId} on route ${routeContext} closed iteration ${iteration} of build phase '${params.buildPhase}' with zero tool calls while attempting phase work. Response excerpt: ${trimmed.slice(0, 500)}`,
    });
  }
  ```

- [ ] **Step 7: Update the /build call site to pass `buildPhase`**
  Locate the call site:
  ```powershell
  rg -n "runAgenticLoop\(" apps/web/lib/actions/agent-coworker.ts
  ```
  Open `agent-coworker.ts` at the matching line. Read the surrounding ~50 lines to confirm:
  - The function name calling `runAgenticLoop` (likely `executeAgentTurn` or similar — note the actual name).
  - That `threadId` is in scope (it should be — it's already passed to `runAgenticLoop` in the existing call).
  - That `prisma` is imported at the top of the file.
  - Whether the call site is conditional on route (e.g. `if (routeContext.startsWith("/build"))`). If so, the FeatureBuild lookup goes inside that branch.

  Add the lookup just before the existing `runAgenticLoop` call (inside the build-route branch if one exists):
  ```ts
  // Operator contract clause 2.6 platform path: pass active phase so the loop
  // can detect zero-tool-call violations on phase-required turns.
  const activeBuild = await prisma.featureBuild.findFirst({
    where: { threadId },
    select: { id: true, phase: true },
  });
  ```

  Add `buildPhase: activeBuild?.phase ?? null` and `featureBuildId: activeBuild?.id ?? null` to the existing `runAgenticLoop({ ... })` params object. Do not duplicate any other params; only add these lines.

  If the call site is shared across routes (e.g. there's only one `runAgenticLoop` call for both /build and other routes), the FeatureBuild lookup is safe — `findFirst` returns null on non-build threads and the guard no-ops.

- [ ] **Step 8: Run tests**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts apps/web/lib/actions/agent-coworker-external.test.ts
  ```

- [ ] **Step 9: Commit**
  ```powershell
  git add apps/web/lib/tak/agentic-loop.ts apps/web/lib/tak/agentic-loop.test.ts apps/web/lib/actions/agent-coworker.ts
  git commit -s -m "feat(tak): detect zero-tool-call on phase-required turn and write PlatformIssueReport (contract clause 2.6)"
  ```

---

## Task 6: Save-before-final-response enforcement (clause 2.4 detector)

**Why:** Clause 2.4: if a turn produces a designDoc/buildPlan/etc. in the response text but didn't call `saveBuildEvidence` with that field, write a `PlatformIssueReport`. This is the lighter sibling of `detectFabrication` — fabrication catches "claimed completion without any tool"; this catches "produced specific evidence content but didn't persist it."

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts` (add detector + invocation)
- Modify: `apps/web/lib/tak/agentic-loop.test.ts` (test cases)

**Steps:**

- [ ] **Step 1: Write failing tests**
  ```ts
  import { detectUnsavedEvidence } from "./agentic-loop";

  describe("detectUnsavedEvidence (contract clause 2.4)", () => {
    it("flags response that contains a design-doc structure but no saveBuildEvidence call", () => {
      const response = "Here's the design doc:\n\n## Approach\nReplace gray classes with var(--dpf-*) tokens.\n\n## Files\n- apps/web/...";
      const executedTools: Array<{ name: string; args?: Record<string, unknown> }> = [];
      expect(detectUnsavedEvidence(response, executedTools, "ideate")).toBe("designDoc");
    });

    it("returns null when saveBuildEvidence(designDoc) was called", () => {
      const response = "Saved the design doc.";
      const executedTools = [{ name: "saveBuildEvidence", args: { field: "designDoc", value: {} } }];
      expect(detectUnsavedEvidence(response, executedTools, "ideate")).toBeNull();
    });

    it("returns null when phase is not ideate/plan/review", () => {
      expect(detectUnsavedEvidence("design doc", [], "build")).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Verify failure**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts -t "detectUnsavedEvidence"
  ```

- [ ] **Step 3: Implement**
  ```ts
  /**
   * Contract clause 2.4: if a turn produces specific phase-evidence content in
   * the response text but does not call saveBuildEvidence with the matching
   * field, the evidence is ephemeral. Returns the field name that should have
   * been saved, or null. Conservative — only fires on clear evidence-content
   * signals to avoid false positives on conversational replies.
   */
  export function detectUnsavedEvidence(
    responseText: string,
    executedTools: Array<{ name: string; args?: Record<string, unknown> }>,
    phase: string | null | undefined,
  ): string | null {
    if (!phase) return null;
    const phaseFieldMap: Record<string, { field: string; signal: RegExp }> = {
      ideate: { field: "designDoc", signal: /\b(?:design\s+doc|design\s+document|approach[:\s]|here['']s\s+the\s+design)\b/i },
      plan: { field: "buildPlan", signal: /\b(?:build\s+plan|implementation\s+plan|tasks?[:\s]|file\s+structure)\b/i },
      review: { field: "verificationOut", signal: /\b(?:typecheck\s+(?:passed|failed)|tests?\s+(?:passed|failed)|verification\s+(?:complete|done))\b/i },
    };
    const entry = phaseFieldMap[phase];
    if (!entry) return null;
    if (!entry.signal.test(responseText)) return null;
    const wasSaved = executedTools.some(
      (t) => t.name === "saveBuildEvidence" &&
        (t.args as Record<string, unknown> | undefined)?.field === entry.field,
    );
    return wasSaved ? null : entry.field;
  }
  ```

- [ ] **Step 4: Wire it in the final-text branch**
  Wire this detector wherever the loop is about to accept a final text response, regardless of whether earlier read/search tools ran. Do not limit this to `executedTools.length === 0`; the contract violation is "evidence described but not saved," and that can happen after read-only tools too.
  ```ts
  const unsavedField = detectUnsavedEvidence(trimmed, executedTools, params.buildPhase);
  if (unsavedField) {
    console.warn(`[agentic-loop] contract-violation unsaved-evidence: ${unsavedField} described but not saved`);
    await writeCoworkerProcessIssue({
      threadId,
      routeContext,
      agentId,
      featureBuildId: params.featureBuildId ?? null,
      severity: "medium",
      title: `[coworker-process] unsaved-evidence: ${unsavedField}`,
      description: `Agent ${agentId} on route ${routeContext} produced ${unsavedField} content in iteration ${iteration} but did not call saveBuildEvidence({ field: "${unsavedField}", ... }). Response excerpt: ${trimmed.slice(0, 500)}`,
    });
  }
  ```

- [ ] **Step 5: Run tests**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts
  ```

- [ ] **Step 6: Commit**
  ```powershell
  git add apps/web/lib/tak/agentic-loop.ts apps/web/lib/tak/agentic-loop.test.ts
  git commit -s -m "feat(tak): detect unsaved evidence and write PlatformIssueReport (contract clause 2.4)"
  ```

---

## Task 7: Guard-writer integration check

**Why:** Tasks 4-6 should now share the same `writeCoworkerProcessIssue(...)` helper and should all populate `featureBuildId` from the `runAgenticLoop` params. This task prevents drift before the build gate.

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts` if any guard bypassed the helper

**Steps:**

- [ ] **Step 1: Search for raw issue-report writes in `agentic-loop.ts`**
  ```powershell
  Select-String -Path apps/web/lib/tak/agentic-loop.ts -Pattern 'platformIssueReport.create|writeCoworkerProcessIssue'
  ```

- [ ] **Step 2: Confirm only the helper calls Prisma directly**
  Expected: one `prisma.platformIssueReport.create` inside `writeCoworkerProcessIssue(...)`; detector sites call the helper and pass `featureBuildId: params.featureBuildId ?? null`.

- [ ] **Step 3: Run vitest**
  ```powershell
  pnpm --filter web exec vitest run apps/web/lib/tak/
  ```

- [ ] **Step 4: Commit if the integration check required edits**
  ```powershell
  git add apps/web/lib/tak/agentic-loop.ts apps/web/lib/tak/agentic-loop.test.ts
  git commit -s -m "refactor(tak): centralize coworker process issue reporting"
  ```

---

## Task 8: Production build gate

**Why:** Per AGENTS.md §5, work is not complete until `next build` passes with zero errors. TypeScript errors only surface here.

**Steps:**

- [ ] **Step 1: Run the production build**
  ```powershell
  pnpm --filter web build
  ```
  Expected: build succeeds, zero errors.

- [ ] **Step 2: If errors surface, fix them in the relevant task above** (not a new commit). Re-run the build until clean.

- [ ] **Step 3: No commit needed if build is already clean.** If you fixed errors, amend the relevant task's commit or add a small `fix:` commit per branch policy.

---

## Task 9: Acceptance demo — re-run BI-E9CD1B92 Ideate path

**Why:** The Slice 1 acceptance criterion (spec §8 Slice 1) is contract behavior: the build-specialist must stop refusing callable tools and must save Ideate evidence (`designDoc`) or write a build-linked `PlatformIssueReport`. A full Ideate -> Ship replay is useful only when the branch also contains the underlying product fix.

**Steps:**

- [ ] **Step 0: Verify the build-specialist's tool grants are seeded**
  Per project memory ("Agent grant seeding gap" — 2026-04-18 silent-failure root cause), confirm `AGT-WS-BUILD` has non-zero grants in the DB before relying on the demo to test contract behavior:
  ```powershell
  docker exec dpf-postgres-1 psql -U dpf -d dpf -t -c \
    "SELECT a.\"agentId\", a.name, COUNT(g.\"grantKey\") AS grant_count FROM \"Agent\" a LEFT JOIN \"AgentToolGrant\" g ON g.\"agentId\" = a.id WHERE a.\"agentId\" = 'AGT-WS-BUILD' GROUP BY a.\"agentId\", a.name;"
  ```
  Expected: grant_count >= 7 (verified 2026-04-30: backlog_read, backlog_write, file_read, iac_execute, registry_read, release_gate_create, sandbox_execute). If grant_count is 0 or low, surface to user — the demo will produce false negatives until grants are reseeded.

- [ ] **Step 1: Verify infra is up**
  ```powershell
  docker ps --format "table {{.Names}}\t{{.Status}}" | Select-String -Pattern "portal|sandbox|postgres"
  ```
  Expected: portal, sandbox, postgres all `Up` and healthy where health checks exist. If not: surface the missing service before running `docker compose up -d`.

- [ ] **Step 2: Rebuild the portal with the new code**

  For a shared install, announce the rebuild before running it so the user is not surprised by a portal restart:

  > Proposed: `docker compose build --no-cache portal portal-init && docker compose up -d`. This rebuilds the portal image with the new code. Estimated 3–5 min. OK to proceed?

  Then run the command and check logs:
  ```powershell
  docker compose build --no-cache portal portal-init
  docker compose up -d portal portal-init
  docker logs dpf-portal-1 --tail 100
  ```
  Expected: portal restarts cleanly, no startup errors.

- [ ] **Step 3: Verify BI-E9CD1B92 still exists in the backlog**
  ```powershell
  docker exec dpf-postgres-1 psql -U dpf -d dpf -t -c \
    "SELECT \"itemId\", title, status FROM \"BacklogItem\" WHERE \"itemId\" = 'BI-E9CD1B92';"
  ```
  Expected: one row, status=open.

- [ ] **Step 4: Verify FB-2A2C2AC5 still exists and reset it for the demo replay**

  This direct SQL is **acceptance-demo-replay tooling only** — not a precedent for general state mutation. Per project memory ("DB fix = seed + migration"), real fixes go through migrations and seed scripts. This is OK here because the build is a single demo artifact and the reset is non-destructive (clears nullable JSON columns + resets a phase enum). Document this caveat in the PR description.
  ```powershell
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c \
    "UPDATE \"FeatureBuild\" SET phase = 'ideate', \"designDoc\" = NULL, \"buildPlan\" = NULL, \"taskResults\" = NULL, \"verificationOut\" = NULL, \"acceptanceMet\" = NULL, \"updatedAt\" = NOW() WHERE \"buildId\" = 'FB-2A2C2AC5';"
  ```
  Expected: `UPDATE 1`. If you need to replay the demo more than once, consider extracting this into a small test fixture script under `scripts/` rather than re-pasting the SQL.

- [ ] **Step 5: Login at http://192.168.0.200:3000/login as `admin@dpf.local`** (password from repo-root `.env`).

- [ ] **Step 6: Navigate to Build Studio (`/build`) and select FB-2A2C2AC5.**

- [ ] **Step 7: Send the build-specialist a single message: "Drive the Ideate phase per the operator contract."**

- [ ] **Step 8: Observe the agent loop:**
  - The agent calls `start_ideate_research` (or equivalent), `saveBuildEvidence({field:"designDoc"})`, `reviewDesignDoc`, `save_phase_handoff` in a phase-appropriate order.
  - No unexpected `PlatformIssueReport` row written for this turn (verify: `docker exec dpf-postgres-1 psql -U dpf -d dpf -c "SELECT \"reportId\", title FROM \"PlatformIssueReport\" WHERE \"featureBuildId\" = (SELECT id FROM \"FeatureBuild\" WHERE \"buildId\" = 'FB-2A2C2AC5') ORDER BY \"createdAt\" DESC LIMIT 5;"`). If a row exists, it must explain a real contract miss.
  - `FeatureBuild.designDoc` is non-null after the turn.

- [ ] **Step 9: Approve the phase transition in the UI.**

- [ ] **Step 10: Optional extended replay**

  Continue through Plan -> Build -> Review -> Ship only if the branch also contains the underlying BI-E9CD1B92 product fix. If this branch only implements the operator contract, stop after Ideate evidence is saved and record later-phase replay as follow-up. Do not turn this acceptance demo into a hidden design-token implementation task.

- [ ] **Step 11: Document the demo result.** If successful: capture the executed-tools sequence and the sequence of PlatformIssueReport rows in the PR description for this branch. If failed: file a bug, surface to user, do not declare Slice 1 complete.

---

## Final: PR

- [ ] **Step 1: Verify clean working tree**
  ```powershell
  git status
  ```
  Expected: only the changes from tasks 1-9 are staged/committed; no stragglers.

- [ ] **Step 2: Push the branch**
  ```powershell
  git push -u origin feat/bs-operator-contract-slice-1
  ```

- [ ] **Step 3: Open PR against main**
  ```powershell
  @'
  ## Summary

  Implements [Slice 1](docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md#slice-1--contract-enforcement) of the Build Specialist Operator Contract (wave 2 of the AI Coworker Operator Pattern; wave 1 was Marketing Strategist).

- Rewrites `prompts/route-persona/build-specialist.prompt.md` with the unified Operator Contract (clauses 2.1-2.9), removing the stale "currently empty / pending follow-on assignment" language that caused the LLM to refuse callable tools.
  - Delivers `report_quality_issue` to the `/build` route's tool list.
  - Adds three platform-side enforcement guards in the agentic loop: tool-refused-despite-availability, zero-tool-call on phase-required turn, save-before-final-response. Each writes a `PlatformIssueReport` row tagged with the active `FeatureBuild`.
  - Migration: adds nullable `featureBuildId` FK + index on `PlatformIssueReport`.

  ## Test plan

  - [ ] Focused Vitest tests pass (`pnpm --filter web exec vitest run apps/web/lib/tak/agentic-loop.test.ts apps/web/lib/tak/route-context-map.test.ts apps/web/lib/tak/build-specialist-prompt.test.ts`)
  - [ ] Production build clean (`pnpm --filter web build`)
  - [ ] Migration applies on a fresh DB (`pnpm --filter @dpf/db exec prisma migrate dev`)
  - [ ] BI-E9CD1B92 / FB-2A2C2AC5 Ideate replay is driven by the build-specialist coworker and saves `designDoc`
  - [ ] Any `PlatformIssueReport` rows from the demo run are explicit, build-linked, and explained here

  Generated with Codex
'@ | Set-Content -Path .\pr-body.md -Encoding utf8
  gh pr create --title "feat(coworkers): build-specialist operator contract - Slice 1 enforcement" --body-file .\pr-body.md
  ```

- [ ] **Step 4: Return the PR URL** so the user can review.

---

## Out of scope for this plan

- Slice 2 (Build Studio UI visibility): process-issues badge/panel, saved-vs-unsaved evidence state, no-work-saved warning.
- Slice 3 (build skill playbooks): five `.skill.md` files in `skills/build/`.
- Sub-agent personas (`AGT-BUILD-DA/SE/FE/QA`) operator contracts — wave 3.
- Other coworkers' operator contracts — wave 4.
- Reviewer-pass on refusal (deliberation framework integration).
- Lint check for prompt state-leakage (separate small PR).

These are explicitly deferred per the spec's §7. Do not implement them in Slice 1.
