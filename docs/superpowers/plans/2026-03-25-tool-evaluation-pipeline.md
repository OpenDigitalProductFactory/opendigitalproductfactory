# Tool & Dependency Evaluation Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a multi-agent pipeline that evaluates external tools (MCP servers, npm packages, APIs) for security, architecture fit, compliance, and integration before adoption — with HITL approval via the existing proposal system and ongoing monitoring via Process Observer.

**Architecture:** Prisma schema extensions (`ToolEvaluation` model, FK on `AgentActionProposal`, field on `TaskEvaluation`) feed a pipeline orchestrated by AGT-ORCH-100 across 6 agents. Approval uses the existing `AgentActionProposal` pattern. Process Observer extended for re-evaluation triggers. Approved Tool Registry enforced in `getAvailableTools()`.

**Tech Stack:** Next.js 16 (App Router, Server Components), Prisma 7.x, TypeScript strict, React 18.

**Spec:** `docs/superpowers/specs/2026-03-25-tool-evaluation-pipeline-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/tool-evaluation.ts` | Types (`ToolEvaluation`, `EvaluationFinding`, `ToolVerdict`, `CoSAIThreatCategory`, `ApprovedTool`), pipeline orchestration functions |
| `apps/web/lib/tool-evaluation-data.ts` | Prisma queries: create/read/update evaluations, lookup approved tools |
| `packages/db/data/approved_tools_registry.json` | Machine-readable registry of approved tools (seed data) |
| `packages/db/prisma/migrations/YYYYMMDDHHMMSS_add_tool_evaluation/migration.sql` | Migration for new model + FK + field |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `ToolEvaluation` model; add `toolEvaluationId` FK to `AgentActionProposal`; add `toolName` to `TaskEvaluation` |
| `apps/web/lib/permissions.ts` | Add `manage_tool_evaluations` and `approve_tool_evaluations` capability keys |
| `apps/web/lib/agent-sensitivity.ts` | Register AGT-190 at `confidential` sensitivity |
| `apps/web/lib/mcp-tools.ts` | Add approved-registry check in `getAvailableTools()`; register `evaluate_tool` platform tool |
| `apps/web/lib/process-observer-hook.ts` | Extend `triageAndFile()` for approved-tool failure → re-evaluation |
| `apps/web/lib/orchestrator-evaluator.ts` | Tag `TaskEvaluation` with `toolName` |
| `apps/web/lib/agent-routing.ts` | Add route entry for `/platform/tools` |
| `packages/db/data/agent_registry.json` | Already done: AGT-190 added, 5 agents extended |
| `.claude/commands/tool-evaluation.md` | Already done: Claude Code skill installed |

---

## Task 1: Prisma Schema — ToolEvaluation Model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Read the current schema to find insertion point**

  Read `packages/db/prisma/schema.prisma` and locate `AgentActionProposal` model (around line 1768) and `TaskEvaluation` model (around line 1099).

- [ ] **Step 2: Add ToolEvaluation model after AgentActionProposal**

```prisma
model ToolEvaluation {
  id              String    @id @default(cuid())
  toolName        String
  toolType        String                          // mcp_server | npm_package | api_integration | ai_provider | docker_image
  version         String
  sourceUrl       String
  proposedBy      String
  proposedAt      DateTime  @default(now())

  status          String    @default("proposed")   // proposed | in_review | approved | conditional | rejected | deprecated | re_evaluation
  verdict         Json?                            // ToolVerdict as JSON
  conditions      Json      @default("[]")         // String array as JSON

  findings        Json      @default("[]")         // EvaluationFinding[] as JSON
  reviewers       Json      @default("[]")         // ReviewerRecord[] as JSON
  approvedBy      String?
  approvedAt      DateTime?

  reEvaluateAfter DateTime?
  supersedes      String?                          // ID of previous evaluation for same tool

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  proposals       AgentActionProposal[]

  @@index([toolName, status])
  @@index([status])
  @@index([reEvaluateAfter])
}
```

- [ ] **Step 3: Add toolEvaluationId FK to AgentActionProposal**

  Add to the existing `AgentActionProposal` model:

```prisma
  toolEvaluationId  String?
  toolEvaluation    ToolEvaluation?  @relation(fields: [toolEvaluationId], references: [id])
```

- [ ] **Step 4: Add toolName field to TaskEvaluation**

  Add to the existing `TaskEvaluation` model:

```prisma
  toolName        String?                          // Approved tool used in this task (for performance tracking)
```

- [ ] **Step 5: Run migration**

```bash
cd packages/db && pnpm exec prisma migrate dev --name add_tool_evaluation
```

  Expected: migration creates `ToolEvaluation` table, adds `toolEvaluationId` column to `AgentActionProposal`, adds `toolName` column to `TaskEvaluation`.

- [ ] **Step 6: Verify migration applied**

```bash
cd packages/db && pnpm exec prisma migrate status
```

  Expected: all migrations applied, no pending.

- [ ] **Step 7: Commit**

---

## Task 2: TypeScript Types & Data Layer

**Files:**
- Create: `apps/web/lib/tool-evaluation.ts`
- Create: `apps/web/lib/tool-evaluation-data.ts`

- [ ] **Step 1: Create tool-evaluation.ts with types**

```typescript
// apps/web/lib/tool-evaluation.ts

export type CoSAIThreatCategory =
  | "improper_authentication"
  | "missing_access_control"
  | "input_validation_failure"
  | "data_control_boundary"
  | "inadequate_data_protection"
  | "missing_integrity_controls"
  | "session_transport_security"
  | "network_isolation_failure"
  | "trust_boundary_failure"
  | "resource_management_gap"
  | "operational_security_gap"
  | "supply_chain_risk";

export const COSAI_CATEGORIES: CoSAIThreatCategory[] = [
  "improper_authentication",
  "missing_access_control",
  "input_validation_failure",
  "data_control_boundary",
  "inadequate_data_protection",
  "missing_integrity_controls",
  "session_transport_security",
  "network_isolation_failure",
  "trust_boundary_failure",
  "resource_management_gap",
  "operational_security_gap",
  "supply_chain_risk",
];

export type ToolType = "mcp_server" | "npm_package" | "api_integration" | "ai_provider" | "docker_image";

export type EvaluationStatus =
  | "proposed"
  | "in_review"
  | "approved"
  | "conditional"
  | "rejected"
  | "deprecated"
  | "re_evaluation";

export type ToolVerdict = {
  decision: "approve" | "conditional" | "reject";
  rationale: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  threatCategories: CoSAIThreatCategory[];
  confidenceScore: number;
};

export type EvaluationFinding = {
  reviewerAgentId: string;
  category: "security" | "architecture" | "compliance" | "integration" | "supply_chain";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
  mitigatable: boolean;
  mitigation: string | null;
};

export type ReviewerRecord = {
  agentId: string;
  role: string;
  reviewedAt: string;
  findingCount: number;
  perspective: string;
};

export type ApprovedTool = {
  toolName: string;
  toolType: ToolType;
  approvedVersion: string;
  allowedVersionRange: string | null;
  conditions: string[];
  environments: ("development" | "sandbox" | "staging" | "production")[];
  evaluationId: string;
  approvedAt: string;
  reEvaluateAt: string;
  status: "active" | "deprecated" | "suspended";
};

/** Default re-evaluation intervals in days, by tool type */
export const RE_EVAL_DEFAULTS: Record<ToolType, number> = {
  mcp_server: 30,
  npm_package: 90,
  api_integration: 60,
  ai_provider: 60,
  docker_image: 30,
};
```

- [ ] **Step 2: Create tool-evaluation-data.ts with Prisma queries**

```typescript
// apps/web/lib/tool-evaluation-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { EvaluationFinding, ReviewerRecord, ToolVerdict, ApprovedTool } from "./tool-evaluation";

export type ToolEvaluationRow = {
  id: string;
  toolName: string;
  toolType: string;
  version: string;
  sourceUrl: string;
  proposedBy: string;
  proposedAt: string;
  status: string;
  verdict: ToolVerdict | null;
  conditions: string[];
  findings: EvaluationFinding[];
  reviewers: ReviewerRecord[];
  approvedBy: string | null;
  approvedAt: string | null;
  reEvaluateAfter: string | null;
  supersedes: string | null;
};

export const getToolEvaluations = cache(async (): Promise<ToolEvaluationRow[]> => {
  const rows = await prisma.toolEvaluation.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    toolName: r.toolName,
    toolType: r.toolType,
    version: r.version,
    sourceUrl: r.sourceUrl,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt.toISOString(),
    status: r.status,
    verdict: r.verdict as ToolVerdict | null,
    conditions: r.conditions as string[],
    findings: r.findings as EvaluationFinding[],
    reviewers: r.reviewers as ReviewerRecord[],
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    reEvaluateAfter: r.reEvaluateAfter?.toISOString() ?? null,
    supersedes: r.supersedes,
  }));
});

export async function createToolEvaluation(input: {
  toolName: string;
  toolType: string;
  version: string;
  sourceUrl: string;
  proposedBy: string;
}): Promise<string> {
  const record = await prisma.toolEvaluation.create({
    data: {
      toolName: input.toolName,
      toolType: input.toolType,
      version: input.version,
      sourceUrl: input.sourceUrl,
      proposedBy: input.proposedBy,
      status: "proposed",
    },
  });
  return record.id;
}

export async function updateEvaluationFindings(
  id: string,
  findings: EvaluationFinding[],
  reviewer: ReviewerRecord,
): Promise<void> {
  const current = await prisma.toolEvaluation.findUniqueOrThrow({ where: { id } });
  const existingFindings = current.findings as EvaluationFinding[];
  const existingReviewers = current.reviewers as ReviewerRecord[];

  await prisma.toolEvaluation.update({
    where: { id },
    data: {
      status: "in_review",
      findings: [...existingFindings, ...findings],
      reviewers: [...existingReviewers, reviewer],
    },
  });
}

export async function setEvaluationVerdict(
  id: string,
  verdict: ToolVerdict,
  conditions: string[],
  reEvaluateAfter: Date,
): Promise<void> {
  await prisma.toolEvaluation.update({
    where: { id },
    data: {
      status: verdict.decision === "reject" ? "rejected" : verdict.decision,
      verdict: verdict as unknown as Record<string, unknown>,
      conditions,
      reEvaluateAfter,
    },
  });
}

export async function approveEvaluation(id: string, approvedBy: string): Promise<void> {
  await prisma.toolEvaluation.update({
    where: { id },
    data: {
      approvedBy,
      approvedAt: new Date(),
    },
  });
}

export async function lookupApprovedTool(toolName: string): Promise<ToolEvaluationRow | null> {
  const row = await prisma.toolEvaluation.findFirst({
    where: {
      toolName,
      status: { in: ["approved", "conditional"] },
    },
    orderBy: { approvedAt: "desc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    toolName: row.toolName,
    toolType: row.toolType,
    version: row.version,
    sourceUrl: row.sourceUrl,
    proposedBy: row.proposedBy,
    proposedAt: row.proposedAt.toISOString(),
    status: row.status,
    verdict: row.verdict as ToolVerdict | null,
    conditions: row.conditions as string[],
    findings: row.findings as EvaluationFinding[],
    reviewers: row.reviewers as ReviewerRecord[],
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    reEvaluateAfter: row.reEvaluateAfter?.toISOString() ?? null,
    supersedes: row.supersedes,
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

---

## Task 3: Permissions & Sensitivity

**Files:**
- Modify: `apps/web/lib/permissions.ts`
- Modify: `apps/web/lib/agent-sensitivity.ts`

- [ ] **Step 1: Read permissions.ts to find CapabilityKey type and role mappings**

- [ ] **Step 2: Add capability keys**

  Add to the `CapabilityKey` type union:

```typescript
  | "manage_tool_evaluations"     // Create/update evaluations
  | "approve_tool_evaluations"    // HITL approval gate
```

  Add to HR-300 (Enterprise Architect) role capabilities:

```typescript
  "manage_tool_evaluations",
  "approve_tool_evaluations",
```

  Add to HR-000 (CDIO) role capabilities:

```typescript
  "manage_tool_evaluations",
  "approve_tool_evaluations",
```

- [ ] **Step 3: Read agent-sensitivity.ts to find the route/agent sensitivity map**

- [ ] **Step 4: Add AGT-190 sensitivity**

  Register AGT-190 at `confidential` level (handles security findings that may reveal vulnerabilities).

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

---

## Task 4: Approved Tool Registry Enforcement in getAvailableTools()

**Files:**
- Create: `packages/db/data/approved_tools_registry.json`
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Create empty approved_tools_registry.json**

```json
{
  "version": "1.0.0",
  "generated_at": "2026-03-25",
  "tools": []
}
```

- [ ] **Step 2: Read mcp-tools.ts to find getAvailableTools() function (around line 923)**

- [ ] **Step 3: Add registry check**

  At the beginning of `getAvailableTools()`, load the approved tools registry. For any tool that has `toolType: "mcp_server"` and is NOT in the registry, replace its entry with a blocked message:

```typescript
// After existing capability filtering, before returning:
// Check MCP server tools against approved registry
const approvedTools = await loadApprovedToolsRegistry();
filteredTools = filteredTools.map(tool => {
  if (tool.name.startsWith("mcp_") && !isToolApproved(tool.name, approvedTools)) {
    return {
      ...tool,
      description: `[BLOCKED] This tool has not been evaluated. Run /project:tool-evaluation to initiate review.`,
      disabled: true,
    };
  }
  return tool;
});
```

  Note: This is a soft enforcement initially — logs a warning but doesn't hard-block, since the registry starts empty and existing tools need grandfathering.

- [ ] **Step 4: Add evaluate_tool to PLATFORM_TOOLS**

  Register a new platform tool that the coworker can use to initiate an evaluation:

```typescript
{
  name: "evaluate_tool",
  description: "Initiate a tool evaluation pipeline for an external tool, MCP server, or dependency",
  inputSchema: {
    type: "object",
    properties: {
      toolName: { type: "string", description: "Name of the tool to evaluate" },
      toolType: { type: "string", enum: ["mcp_server", "npm_package", "api_integration", "ai_provider", "docker_image"] },
      version: { type: "string", description: "Version to evaluate" },
      sourceUrl: { type: "string", description: "Registry URL or GitHub repo" },
    },
    required: ["toolName", "toolType"],
  },
  requiredCapability: "manage_tool_evaluations",
  executionMode: "proposal",
  sideEffect: true,
}
```

- [ ] **Step 5: Add executeTool handler for evaluate_tool**

  In the `executeTool` switch statement, add a case that creates a `ToolEvaluation` record:

```typescript
case "evaluate_tool": {
  const id = await createToolEvaluation({
    toolName: args.toolName,
    toolType: args.toolType,
    version: args.version ?? "latest",
    sourceUrl: args.sourceUrl ?? "",
    proposedBy: userContext.userId,
  });
  return { success: true, entityId: id, message: `Tool evaluation created: ${id}` };
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

---

## Task 5: Process Observer — Re-evaluation Triggers

**Files:**
- Modify: `apps/web/lib/process-observer-hook.ts`

- [ ] **Step 1: Read process-observer-hook.ts to find triageAndFile() function**

- [ ] **Step 2: Add approved-tool failure detection**

  At the top of `triageAndFile()`, before the generic backlog item creation, check if the finding relates to an approved tool:

```typescript
import { lookupApprovedTool, createToolEvaluation } from "./tool-evaluation-data";

// In triageAndFile(), for tool_failure findings:
if (finding.type === "tool_failure") {
  const toolNameMatch = finding.description.match(/tool\s+(\S+)/i);
  if (toolNameMatch) {
    const approved = await lookupApprovedTool(toolNameMatch[1]);
    if (approved) {
      await createToolEvaluation({
        toolName: approved.toolName,
        toolType: approved.toolType,
        version: approved.version,
        sourceUrl: approved.sourceUrl,
        proposedBy: "process-observer",
      });
      // Skip generic backlog item — re-evaluation created
      return;
    }
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

---

## Task 6: Orchestrator Evaluator — Performance Tracking

**Files:**
- Modify: `apps/web/lib/orchestrator-evaluator.ts`

- [ ] **Step 1: Read orchestrator-evaluator.ts to find where TaskEvaluation records are created**

- [ ] **Step 2: Add toolName to TaskEvaluation creation**

  In the `evaluateAndUpdateProfile()` function, where `prisma.taskEvaluation.create()` is called, add the `toolName` field from `routingMeta`:

```typescript
const taskEval = await prisma.taskEvaluation.create({
  data: {
    // ... existing fields ...
    toolName: input.routingMeta?.approvedToolName ?? null,
  },
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

---

## Task 7: Agent Routing — Tool Evaluation Route

**Files:**
- Modify: `apps/web/lib/agent-routing.ts`

- [ ] **Step 1: Read agent-routing.ts to find ROUTE_AGENT_MAP**

- [ ] **Step 2: Add /platform/tools route entry**

  The tool evaluation UI should live under `/platform/tools`, handled by the AI Ops Engineer agent (already mapped to `/platform`). If the AI Ops Engineer doesn't have tool evaluation skills, add a skill entry:

```typescript
{
  label: "Evaluate tool",
  description: "Run the tool evaluation pipeline on an external tool or dependency",
  capability: "manage_tool_evaluations",
  prompt: "I need to evaluate a tool for adoption. Help me run the evaluation pipeline.",
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

---

## Task 8: Seed Approved Tools Registry

**Files:**
- Modify: `packages/db/data/approved_tools_registry.json`

- [ ] **Step 1: Populate with currently-used tools as grandfathered entries**

  Read the current MCP server configuration and dependency list. Add entries for tools already in use so they aren't blocked by the enforcement check:

```json
{
  "version": "1.0.0",
  "generated_at": "2026-03-25",
  "tools": [
    {
      "toolName": "playwright-mcp",
      "toolType": "mcp_server",
      "approvedVersion": "1.0.0",
      "allowedVersionRange": null,
      "conditions": ["sandbox-only"],
      "environments": ["sandbox"],
      "evaluationId": "grandfathered",
      "approvedAt": "2026-03-25T00:00:00Z",
      "reEvaluateAt": "2026-04-25T00:00:00Z",
      "status": "active"
    }
  ]
}
```

  Note: Examine the existing MCP server seed data to determine which tools need grandfathering. Each gets a 30-day re-evaluation window.

- [ ] **Step 2: Commit**

---

## Task 9: Build Verification & Final Review

**Files:** None new — verification only.

- [ ] **Step 1: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

  Expected: 0 errors.

- [ ] **Step 2: Run production build**

```bash
cd apps/web && npx next build
```

  Expected: all pages compile successfully.

- [ ] **Step 3: Run tests**

```bash
npx vitest run
```

  Expected: no new test failures.

- [ ] **Step 4: Verify migration applies cleanly in Docker**

```bash
docker compose up portal-init
```

  Expected: migration runs, seed completes, container exits 0.

- [ ] **Step 5: Manual verification checklist**

  - [ ] `ToolEvaluation` table exists in database
  - [ ] `AgentActionProposal.toolEvaluationId` column exists
  - [ ] `TaskEvaluation.toolName` column exists
  - [ ] `evaluate_tool` appears in platform tools for HR-300 role
  - [ ] AGT-190 is in agent_registry.json with correct config
  - [ ] `/project:tool-evaluation` command is available in Claude Code

- [ ] **Step 6: Commit final state**

---

## Execution Notes

- **Tasks 1-2** are sequential (schema before types, types before data layer)
- **Tasks 3-7** are independent and can be parallelized via subagent-driven-development
- **Task 8** depends on Task 4 (registry format must exist)
- **Task 9** must run last (final verification)

**Agent registry changes (Task 0) are already complete** — AGT-190 added, AGT-111/112/131/181/902 extended. No additional registry work needed.

**Claude Code skill (Task 0) is already installed** at `.claude/commands/tool-evaluation.md`. No additional skill work needed.
