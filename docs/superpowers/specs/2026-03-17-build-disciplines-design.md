# EP-SELFDEV-003: Build Disciplines — Quality Gates for Platform Self-Development

**Status:** Draft
**Date:** 2026-03-17
**Epic:** Build Disciplines
**Scope:** Enforce Superpowers-equivalent development quality gates in Build Studio for non-developer users working through AI agents
**Reference baseline:** Superpowers v5.0.2 (14 skills, 4 iron laws, 3 review loops)
**Related specs:**
- `2026-03-14-self-dev-sandbox-design.md` (sandbox execution)
- `2026-03-17-development-lifecycle-architecture-design.md` (git integration + promotion pipeline)

**Dependencies:**
- EP-SELFDEV-001 must be implemented first (sandbox execution must work for Build phase)
- EP-SELFDEV-002 Ship phase features (ChangePromotion, git tags) gracefully degrade if not yet implemented — Ship creates the DigitalProduct but skips promotion workflow

---

## Problem Statement

The Build Studio lets non-developers create features through AI conversation, but has **zero quality enforcement**. A developer using the Superpowers framework (Claude Code) gets: spec documents, implementation plans, TDD, code review, systematic debugging, verification evidence, and git workflow control. A non-developer using Build Studio gets: a conversation, a preview, and a "ship" button.

**Current Build Studio gaps:**
- 0 pre-implementation gates (Superpowers has 2: design approval + plan approval)
- 0 quality gates enforced (Superpowers has 4 iron laws)
- 0 review subagents (Superpowers has 3: spec reviewer, plan reviewer, code reviewer)
- No TDD discipline — `run_sandbox_tests` tool exists but is never called
- No code review — code ships without any review
- No verification evidence — "ready to ship?" is the only check
- No systematic debugging — failures are patched, not investigated
- No work ownership tracking — parallel activities lose track of who's doing what

For regulated industries, every shipped feature needs an evidence trail: who designed it, who planned it, who reviewed the code, what tests were written, what passed, and who approved promotion to production.

## Goals

1. Build Studio enforces the same quality disciplines as the Superpowers framework, adapted for non-developer users working through AI agent conversation
2. Hard gates prevent bypassing quality steps
3. Work ownership and accountability are tracked throughout
4. Development favors reuse, standards, open-source, and integration over building from scratch
5. Full evidence trail for regulated industry compliance

## Non-Goals

- Replacing the Superpowers framework for developer use (it continues to work as-is in Claude Code)
- Building a code editor in the platform (all code work happens through AI agents)
- Multi-environment promotion (covered by EP-SELFDEV-002)

---

## Design

### 1. Build Disciplines Overview

Seven disciplines map 1:1 to Superpowers skills, adapted for the platform context:

| # | Build Discipline | Superpowers Equivalent | Enforced At | Hard Gate? |
|---|-----------------|----------------------|-------------|------------|
| 1 | **Design Approval** | Brainstorming | Ideate → Plan | YES — no Plan without approved Design Doc |
| 2 | **Implementation Planning** | Writing-Plans | Plan → Build | YES — no Build without approved Plan |
| 3 | **Test-First Building** | TDD | During Build | YES — no production code without failing test |
| 4 | **Automated Code Review** | Requesting-Code-Review | After each Build task | YES — no Review without all reviews resolved |
| 5 | **Verification Gate** | Verification-Before-Completion | Build → Review | Enforced — full test suite + typecheck must pass |
| 6 | **Systematic Investigation** | Systematic-Debugging | On test failure during Build | Enforced — root cause before fixes |
| 7 | **Promotion Readiness** | Finishing-a-Development-Branch | Review → Ship | Enforced — all evidence collected before ship option |

### 2. Iron Laws (Non-Bypassable)

Adapted from Superpowers' 4 iron laws:

1. **No Plan without Design** — The Ideate phase must produce a design document. A spec-reviewer agent validates it. The user must approve it. Only then does Plan phase unlock.
2. **No Build without Plan** — The Plan phase must produce a task breakdown with test-first steps. A plan-reviewer agent validates it. The user must approve it. Only then does Build phase unlock.
3. **No Code without Test** — During Build, each task follows a two-step sequence enforced by the system (not just prompt guidance): (a) agent calls `generate_code` with test-only instruction, then the system automatically calls `run_sandbox_tests` and verifies at least one NEW test failure exists; (b) only after RED confirmation does the system allow a second `generate_code` call for implementation code, followed by automatic `run_sandbox_tests` that must show the new test passing. This is system-enforced via the Build phase task runner, not solely prompt-enforced.
4. **No Ship without Evidence** — Review phase requires: all tests passing (with output), all code reviews resolved (no Critical/Important issues open), verification evidence displayed to user. Only then does Ship unlock.

### 3. Reviewer Agent Architecture

Three reviewer agents enforce quality gates. Each is a separate LLM call using the existing `callWithFailover` infrastructure, dispatched by the Build Studio server action during phase transitions.

**Invocation:** When a phase transition is requested (e.g., Ideate → Plan), the server action calls the appropriate reviewer before allowing the transition. The reviewer runs as an immediate LLM call (not a conversation thread), receives structured input, and returns structured output.

**Provider selection:** Reviewers use the `analysis` task priority list from `getProviderPriority("analysis")`. They do NOT use the same provider as the conversation — this ensures independent review.

**Input/output contract:**

```ts
type ReviewRequest = {
  reviewType: "design" | "plan" | "code";
  content: string;        // the document or code to review
  context: string;        // project context, acceptance criteria, etc.
  buildId: string;
};

type ReviewResult = {
  decision: "pass" | "fail";
  issues: Array<{
    severity: "critical" | "important" | "minor";
    description: string;
    location?: string;     // file:line or section reference
    suggestion?: string;
  }>;
  summary: string;
};
```

**Storage:** Review results stored as JSON in the evidence fields on `FeatureBuild` (`designReview`, `planReview`, `taskResults`).

**Failure handling:** If the reviewer LLM call fails (timeout, provider error), the phase transition is blocked with an error message. The user can retry. The review is NOT auto-passed on failure.

**Reviewer prompts (injected as system prompt for each call):**

- **Spec reviewer:** "You are reviewing a design document for a feature. Check: problem clearly stated, existing functionality audited, alternatives considered, approach justified, acceptance criteria testable. Return structured ReviewResult."
- **Plan reviewer:** "You are reviewing an implementation plan. Check: tasks are bite-sized, each task has test-first structure, file paths are specific, no ambiguous steps. Return structured ReviewResult."
- **Code reviewer:** "You are reviewing code changes for a single task. Check: test exists and covers the change, no duplication with existing code, follows project patterns, no security issues. Return structured ReviewResult."

### 4. Evidence Field Schemas

TypeScript types for the JSON evidence fields stored on `FeatureBuild`:

```ts
type BuildDesignDoc = {
  problemStatement: string;
  existingFunctionalityAudit: string;
  alternativesConsidered: string;
  reusePlan: string;
  newCodeJustification: string;
  proposedApproach: string;
  acceptanceCriteria: string[];
};

type BuildPlanDoc = {
  fileStructure: Array<{ path: string; action: "create" | "modify"; purpose: string }>;
  tasks: Array<{
    title: string;
    testFirst: string;   // what test to write
    implement: string;   // what code to write
    verify: string;      // how to verify
  }>;
};

type TaskResult = {
  taskIndex: number;
  title: string;
  testResult: { passed: boolean; output: string };
  codeReview: ReviewResult;
  commitSha?: string;
};

type VerificationOutput = {
  testsPassed: number;
  testsFailed: number;
  typecheckPassed: boolean;
  fullOutput: string;
  timestamp: string;
};

type AcceptanceCriteria = Array<{
  criterion: string;
  met: boolean;
  evidence: string;
}>;
```

### 5. Phase-by-Phase Discipline Enforcement

#### Ideate Phase (→ Design Approval gate)

**Current behavior:** Agent asks questions, silently saves notes.

**New behavior:**
1. Agent explores existing codebase for reuse opportunities (mandatory)
2. Agent searches for open-source alternatives (mandatory)
3. Agent asks clarifying questions one at a time
4. Agent writes a **Design Document** stored as a `designDoc` JSON field on `FeatureBuild`:
   - Problem statement
   - Existing Functionality Audit — what already exists in the codebase
   - Alternatives Considered — open-source, MCP services, existing tools evaluated
   - Reuse Plan — what existing code/patterns will be leveraged
   - New Code Justification — why new code is needed where reuse wasn't possible
   - Proposed approach
   - Acceptance criteria
5. Spec-reviewer agent validates the design document
6. Design document shown to user for review
7. **Hard gate:** User must approve design before Plan phase unlocks

#### Plan Phase (→ Implementation Planning gate)

**Current behavior:** Agent summarizes 2-3 bullets, asks "Does this capture it?"

**New behavior:**
1. Agent produces an **Implementation Plan** stored as a `buildPlan` JSON field on `FeatureBuild`:
   - File structure map — which files will be created/modified
   - Task breakdown — bite-sized steps, each with test-first structure
   - For each task: write failing test → implement → verify → commit
   - Estimated task count
2. Plan-reviewer agent validates the plan
3. Plan shown to user — visible task list, not hidden internals
4. **Hard gate:** User must approve plan before Build phase unlocks

#### Build Phase (→ Test-First Building + Code Review + Verification)

**Current behavior:** "Automated building coming soon"

**New behavior:**
1. Agent works through plan tasks sequentially
2. Each task:
   a. Write failing test → `run_sandbox_tests` → show RED result to user
   b. Write minimal implementation → `run_sandbox_tests` → show GREEN result to user
   c. Code-reviewer agent checks the task (spec compliance + quality)
   d. If issues found → agent fixes → reviewer re-reviews
   e. Auto-commit with structured message
3. If tests fail unexpectedly → **Systematic Investigation** discipline activates:
   - Agent investigates root cause (read errors, trace data flow)
   - Shows investigation findings to user
   - Only then attempts fix
   - If 3+ fix attempts fail → escalate to user
4. Progress visible to user: task list with checkboxes, test results per task, review status per task
5. **Verification gate:** After all tasks complete, run full test suite + typecheck. Output shown to user. Must pass to unlock Review phase.

#### Review Phase (→ Promotion Readiness)

**Current behavior:** "Confirm acceptance criteria met, ready to ship?"

**New behavior:**
1. Display evidence summary:
   - Design document (link)
   - Implementation plan (link)
   - Test results: X passed, 0 failed
   - Code review results: all resolved, no open Critical/Important
   - Diff summary: files changed, lines added/removed
   - Acceptance criteria checklist with pass/fail per criterion
2. User can:
   - Approve → unlock Ship phase
   - Request changes → back to Build phase with specific feedback (requires adding `review → build` to `ALLOWED_TRANSITIONS` in `feature-build-types.ts`)
   - Reject → archive the build (set phase to `"failed"`)

**Phase transition update:** The existing `ALLOWED_TRANSITIONS` map must be extended to support backward transitions for the Review → Build return path. Add `"review": ["ship", "failed", "build"]`.

#### Ship Phase (→ Deployment)

**Current behavior:** "Register as product, create epic, don't ask permission"

**New behavior:**
1. Create/update DigitalProduct with version
2. Git tag created (`v{version}`)
3. Create `ChangePromotion` record (status: "pending") — ties into EP-SELFDEV-002
4. Create Epic + backlog items for tracking
5. All evidence documents linked to the ChangePromotion record
6. User presented with options: promote to production (when EP-SELFDEV-002 is ready) or keep in dev

### 4. Work Ownership & Accountability

Three roles tracked per work item:

| Role | Field | Purpose |
|------|-------|---------|
| **Accountable** | `accountableEmployeeId` | Employee responsible for the area — owns outcomes. FK to `EmployeeProfile` (the HR/workforce identity, not the auth `User`). Auto-assigned from portfolio area via department/position, can be overridden. |
| **Submitter** | `submittedById` | Human who requested/authorized the work (existing field from EP-OPS-TRACE-001) |
| **Worker** | `claimedById` + `claimedByAgentId` | Agent + authorizing user actively building |

**Claim model** (new fields on `BacklogItem`, `Epic`, `FeatureBuild`):

```
accountableEmployeeId  String?   // FK to User — area owner
claimedById            String?   // FK to User — human authorizing the work
claimedByAgentId       String?   // agent actively working
claimedAt              DateTime? // when work started
claimStatus            String?   // "active" | "paused" | "released"
```

**Note on FeatureBuild:** `claimedById` on FeatureBuild is distinct from `createdById` — a different user can claim an existing build (ownership transfer). If they're the same person, that's the common case but not enforced.

**Rules:**
- An agent can only hold one active claim per user session
- Claims visible on backlog page: "COO Agent working on behalf of Mark" badge
- Stale claims auto-release after 30 minutes of inactivity. "Inactivity" = no agent message sent on the build's thread. Detected by a check in `sendMessage()` — if the last message on a claimed build's thread is older than 30 minutes, release the claim before proceeding. No cron job needed.
- When a claim is released, the build remains in its current phase. Another agent/user can claim it and continue.
- User can manually release a claim
- Build Studio auto-claims when Build phase starts
- Workspace dashboard: "Active Work" section showing all claimed items

### 5. Development Principles (Agent Prompt Enforcement)

These are injected as mandatory system prompt blocks during each Build Studio phase. The agent must comply and document compliance.

**Reuse-first:** Before proposing new code, agent must search the codebase for existing functionality. Design doc requires "Existing Functionality Audit" section.

**Standards-first:** Implementation plan must reference existing patterns (component naming, file structure, tab-nav pattern, etc.). Plan reviewer checks for pattern violations.

**Refactor over duplicate:** If agent finds similar code during implementation, it must refactor to share rather than copy. Code reviewer flags duplication as Critical.

**Integrate over build:** Agent must check for existing MCP services, open-source libraries, or platform tools before building new capability. Design doc requires "Alternatives Considered" section.

**Open-source first:** For any new capability, agent evaluates established open-source solutions. Design doc documents what was evaluated and why adopted or not.

### 6. Evidence Trail

Every Build produces a complete evidence chain stored in the database:

| Evidence | When Created | Stored As |
|----------|-------------|-----------|
| Design document | Ideate phase | `designDoc` JSON field on `FeatureBuild` (JSON) |
| Spec review result | Ideate gate | Review record with pass/fail + issues |
| Implementation plan | Plan phase | `buildPlan` JSON field on `FeatureBuild` (JSON) |
| Plan review result | Plan gate | Review record with pass/fail + issues |
| Test results per task | Build phase | Array of test run results on FeatureBuild |
| Code review per task | Build phase | Array of review results on FeatureBuild |
| Full verification output | Build → Review gate | Verification record with full output |
| Acceptance criteria status | Review phase | Checklist on FeatureBuild |
| Accountable + submitter + worker | Throughout | Attribution fields |
| Git commits + tag | Ship phase | Git refs, linked via ChangePromotion |

---

## Schema Changes

**New fields on `FeatureBuild`:**
```prisma
  // Build Disciplines evidence
  designDoc       Json?     // structured design document
  designReview    Json?     // spec reviewer result
  buildPlan       Json?     // structured implementation plan
  planReview      Json?     // plan reviewer result
  taskResults     Json?     // array of per-task results (test + review)
  verificationOut Json?     // full test suite + typecheck output
  acceptanceMet   Json?     // acceptance criteria checklist

  // Ownership
  accountableEmployeeId  String?
  accountableEmployee    EmployeeProfile?  @relation("BuildAccountable", fields: [accountableEmployeeId], references: [id])
  claimedByAgentId       String?
  claimedAt              DateTime?
  claimStatus            String?  // "active" | "paused" | "released"
```

**New fields on `Epic` and `BacklogItem`:**
```prisma
  accountableEmployeeId  String?
  accountableEmployee    EmployeeProfile?  @relation(...)
  claimedById            String?
  claimedByAgentId       String?
  claimedAt              DateTime?
  claimStatus            String?
```

**EmployeeProfile model** — add reverse relations for accountability.

## Files Affected

**Build Studio agent prompts:**
- `apps/web/lib/build-agent-prompts.ts` — rewrite all 5 phase prompts with discipline enforcement

**Build Studio actions:**
- `apps/web/lib/actions/build.ts` — add hard gate validation on phase transitions (cannot advance without required evidence)

**Build Studio UI:**
- `apps/web/components/build/BuildStudio.tsx` — show task progress, test results, review status
- `apps/web/components/build/FeatureBriefPanel.tsx` — show design doc and plan instead of just brief

**New components:**
- `apps/web/components/build/TaskProgressList.tsx` — visible task checklist with test/review status
- `apps/web/components/build/EvidenceSummary.tsx` — Review phase evidence display
- `apps/web/components/build/ClaimBadge.tsx` — work ownership indicator

**Schema:**
- `packages/db/prisma/schema.prisma` — add evidence and ownership fields

**Ops UI (ownership visibility):**
- `apps/web/components/ops/EpicCard.tsx` — show accountable + claimed-by
- `apps/web/components/ops/BacklogItemRow.tsx` — show accountable + claimed-by

## Testing Strategy

- Verify hard gates: attempt to advance phase without required evidence → blocked
- Verify design doc created during Ideate and reviewed
- Verify plan created during Plan and reviewed
- Verify TDD cycle: test written before code, test output shown
- Verify code review dispatched after each task
- Verify systematic debugging activates on test failure
- Verify verification gate blocks Review without passing tests
- Verify evidence summary shows complete chain in Review phase
- Verify work claims: claim created, stale release, manual release
- Verify accountability auto-assigned from portfolio area
