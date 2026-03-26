# EP-GOVERN-002: Tool & Dependency Evaluation Pipeline

**Status:** Draft (2026-03-25)
**Predecessor:** EP-CODEGEN-001 (Robust Sandbox Coding & MCP Security), EP-PROCESS-001 (Process Observer), Governance Orchestrator (AGT-ORCH-800)

## Problem Statement

The platform integrates external tools (MCP servers, npm packages, AI providers, APIs) but has no formalized process for evaluating, vetting, and approving them. Today this happens ad-hoc: a developer finds a tool, manually checks for obvious issues, and installs it. This approach:

1. **Misses security risks** — 53% of MCP servers use hard-coded credentials (Astrix Security, 2025). The Smithery registry itself had a path traversal vulnerability in early 2026 exposing Docker credentials across tenants. Without a structured checklist, these signals get missed.

2. **Has no institutional memory** — When a tool is rejected, the reasoning is lost. The next person evaluates the same tool from scratch. When a tool is approved, the conditions of approval (version pinned, sandbox-only, etc.) aren't tracked.

3. **Lacks diverse expert perspectives** — Security, architecture, compliance, and integration concerns are evaluated by the same person (or skipped). The Diversity of Thought framework demonstrates that a team with different perspectives catches more issues than any single expert.

4. **Has no ongoing monitoring** — A tool approved today may change behavior tomorrow (rug-pull attacks, dependency hijacking). No mechanism re-evaluates approved tools on a schedule.

### What Already Exists

- **Agent Registry** (`packages/db/data/agent_registry.json`) — 44 agents across 8 value streams with orchestrator/specialist hierarchy, HITL tiers, and tool grants
- **Governance Orchestrator** (AGT-ORCH-800) — Enterprise Architecture enforcement, constraint validation, promotion workflows
- **Evaluate Orchestrator** (AGT-ORCH-100) — Portfolio investment decisions, gap analysis, rationalization
- **Process Observer** (EP-PROCESS-001) — Friction/failure detection with auto-triage to backlogs
- **MCP Security Sandbox** (EP-CODEGEN-001) — Isolated execution, stdio blocking, fabrication detection
- **Agent Sensitivity Levels** (`apps/web/lib/agent-sensitivity.ts`) — public/internal/confidential/restricted classification
- **Diversity of Thought Framework** (`docs/Reference/diversity-of-thought-framework.md`) — Perspective/heuristic/interpretive model for genuine cognitive diversity

---

## Design

### Section 1: Tool Evaluation Registry (Data Model)

A new `ToolEvaluation` entity tracks every tool that has been proposed, evaluated, approved, or rejected.

```typescript
type ToolEvaluation = {
  id: string;                          // UUID
  toolName: string;                    // e.g. "smithery-mcp", "prisma", "@anthropic-ai/sdk"
  toolType: "mcp_server" | "npm_package" | "api_integration" | "ai_provider" | "docker_image";
  version: string;                     // Evaluated version (pinned)
  sourceUrl: string;                   // Registry URL, GitHub repo, or vendor page
  proposedBy: string;                  // User or agent who initiated evaluation
  proposedAt: string;                  // ISO 8601

  status: "proposed" | "in_review" | "approved" | "conditional" | "rejected" | "deprecated" | "re_evaluation";
  verdict: ToolVerdict | null;         // Final decision with rationale
  conditions: string[];                // e.g. ["sandbox-only", "version-pinned to 2.3.1", "no production credentials"]

  findings: EvaluationFinding[];       // All findings from all reviewers
  reviewers: ReviewerRecord[];         // Which agents/humans reviewed and when
  approvedBy: string | null;           // Human approver (HITL gate)
  approvedAt: string | null;

  reEvaluateAfter: string | null;      // ISO 8601 — scheduled re-evaluation date
  supersedes: string | null;           // ID of previous evaluation for same tool
  createdAt: string;
  updatedAt: string;
};

type ToolVerdict = {
  decision: "approve" | "conditional" | "reject";
  rationale: string;                   // 2-3 sentence summary
  riskLevel: "low" | "medium" | "high" | "critical";
  threatCategories: CoSAIThreatCategory[];  // Which CoSAI categories flagged
  confidenceScore: number;             // 0-1, based on evidence completeness
};

type EvaluationFinding = {
  reviewerAgentId: string;
  category: "security" | "architecture" | "compliance" | "integration" | "supply_chain";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  evidence: string;                    // URL, file path, or test output
  recommendation: string;
  mitigatable: boolean;                // Can this be addressed with conditions?
  mitigation: string | null;           // How to mitigate if mitigatable
};

type ReviewerRecord = {
  agentId: string;
  role: string;
  reviewedAt: string;
  findingCount: number;
  perspective: string;                 // From Diversity of Thought framework
};
```

---

### Section 2: CoSAI Threat Checklist (Security Evaluation Standard)

Based on the Coalition for Secure AI (CoSAI) 12-category threat model, adapted for this platform:

```typescript
type CoSAIThreatCategory =
  | "improper_authentication"       // 1. No auth, weak auth, hardcoded credentials
  | "missing_access_control"        // 2. No RBAC, excessive permissions, no least-privilege
  | "input_validation_failure"      // 3. Injection, malformed input, no sanitization
  | "data_control_boundary"         // 4. Prompt injection, tool poisoning, confused deputy
  | "inadequate_data_protection"    // 5. PII exposure, no encryption, logging secrets
  | "missing_integrity_controls"    // 6. No signatures, no checksums, mutable dependencies
  | "session_transport_security"    // 7. No TLS, session fixation, token leakage
  | "network_isolation_failure"     // 8. No sandboxing, lateral movement, port exposure
  | "trust_boundary_failure"        // 9. Over-reliance on LLM judgment, no human gate
  | "resource_management_gap"       // 10. No rate limiting, no timeouts, memory leaks
  | "operational_security_gap"      // 11. No audit logging, no monitoring, no alerting
  | "supply_chain_risk";            // 12. Unvetted dependencies, no lock files, npm typosquatting
```

Each tool evaluation MUST produce a finding (even if "no issue found") for every category. This ensures nothing is skipped.

---

### Section 3: Evaluation Agent Roles

The evaluation pipeline leverages **5 extended existing agents + 1 new agent**, coordinated by the Evaluate Orchestrator (AGT-ORCH-100). This lean approach reuses agents whose existing perspectives naturally extend to tool evaluation, adding only a Security Auditor where no existing perspective covers threat analysis of external dependencies.

Each agent has a distinct **perspective**, **heuristics**, and **interpretive model** per the Diversity of Thought framework.

| Agent ID | Role | Status | Perspective | Heuristics | Interprets "Good" As |
|----------|------|--------|-------------|------------|---------------------|
| AGT-112 | Discovery Scout | EXTENDED (Gap Analysis) | "What's missing, and what fills the gap?" | Registry search, GitHub stars/activity, community adoption, maintenance cadence | Actively maintained, well-documented, fits the need without over-engineering |
| AGT-190 | Security Auditor | **NEW** | "What can go wrong?" | CoSAI 12-category checklist, dependency scan (CVEs), credential detection, SAST, supply chain verification | Zero critical findings, all high findings mitigatable, no hardcoded secrets |
| AGT-181 | Architecture Reviewer | EXTENDED (Architecture Guardrail) | "Does this conform to our architecture?" | Data flow analysis, trust boundary mapping, coupling assessment, API surface review | Clean integration, minimal coupling, respects existing boundaries, no architectural debt |
| AGT-902 | Compliance Assessor | EXTENDED (Data Governance) | "Is data handled correctly and are we compliant?" | License compatibility (SPDX), data residency, EU AI Act classification, ISO 42001 alignment, IP/copyright | OSS-compatible license, no data exfiltration, compliant with regulatory requirements |
| AGT-131 | Integration Tester | EXTENDED (SBOM Management) | "What's in our dependency tree and does it work?" | Sandboxed install, smoke tests, dependency conflict check, performance baseline, rollback verification | Installs cleanly, passes smoke tests, no dependency conflicts, acceptable performance |
| AGT-111 | Risk Adjudicator | EXTENDED (Investment Analysis) | "Is this worth the investment?" | Weighted scoring across all findings, precedent lookup (previous evaluations), HITL escalation rules | Findings weighted by severity, all critical/high addressed, net risk acceptable |

**Why only 1 new agent:** Five of the six evaluation perspectives already exist in the agent workforce. Extending them avoids workforce bloat while maintaining the Diversity of Thought principle — each agent still frames the problem differently because their *existing* perspective naturally applies to a new input (external tools). The Security Auditor is genuinely new because no existing agent evaluates external attack vectors.

**Diversity validation:** These agents MUST produce genuinely different recommendations when evaluating the same tool. If the Gap Analysis agent and Architecture Guardrail agent always agree, their perspectives aren't diverse enough — trigger adaptation per the Diversity of Thought framework Phase 3.

---

### Section 4: Evaluation Pipeline Flow

```text
                                  +-----------------+
                                  |  Need Identified |
                                  |  (human or agent) |
                                  +--------+--------+
                                           |
                                           v
                              +------------+------------+
                              | AGT-112: Gap Analysis    |
                              | (Discovery Scout role)   |
                              | Find 2-5 candidates      |
                              +------------+------------+
                                           |
                                  [per candidate]
                                           |
                          +----------------+----------------+
                          |                                 |
                          v                                 v
              +-----------+-----------+       +-------------+-----------+
              | AGT-190: Security     |       | AGT-902: Data Governance|
              | Auditor (NEW)         |       | (Compliance role)       |
              | (CoSAI 12-category)   |       | (License, data, regs)   |
              +-----------+-----------+       +-------------+-----------+
                          |                                 |
                          +----------------+----------------+
                                           |
                                           v
                              +------------+------------+
                              | AGT-181: Arch Guardrail  |
                              | (Architecture review)    |
                              | (Fit, coupling, trust)   |
                              +------------+------------+
                                           |
                                  [if no critical blockers]
                                           |
                                           v
                              +------------+------------+
                              | AGT-131: SBOM Mgmt      |
                              | (Integration test role)  |
                              | (Sandboxed trial)        |
                              +------------+------------+
                                           |
                                           v
                              +------------+------------+
                              | AGT-111: Investment      |
                              | Analysis                 |
                              | (Risk Adjudicator role)  |
                              | APPROVE / CONDITIONAL /  |
                              | REJECT                   |
                              +------------+------------+
                                           |
                                  [HITL Gate: HR-300      ]
                                  [Enterprise Architect   ]
                                           |
                                           v
                              +------------+------------+
                              | Approved Tool Registry   |
                              | (version-pinned, with    |
                              |  conditions & re-eval    |
                              |  schedule)               |
                              +--------------------------+
```

**Parallel execution:** AGT-190 (Security Auditor) and AGT-902 (Compliance Assessor) run in parallel (no dependency). AGT-181 (Architecture Reviewer) runs after both complete (needs their findings as input). AGT-131 (Integration Tester) only runs if no critical blockers from prior stages (avoids wasting sandbox resources on tools that will be rejected).

**Early termination:** If AGT-190 finds a critical, unmitigatable finding (e.g., hardcoded credentials with no configuration alternative), the pipeline short-circuits to REJECT without running remaining stages.

---

### Section 5: HITL Gates via AgentActionProposal

Tool evaluation approval reuses the platform's existing `AgentActionProposal` pattern (`apps/web/lib/actions/agent-coworker.ts`, lines 528-553) rather than introducing a standalone approval mechanism. This ensures evaluation approvals appear in the same proposal queue, use the same UI, and benefit from the same audit trail.

**How it works:**

When AGT-111 (Risk Adjudicator) produces a verdict, it creates an `AgentActionProposal`:

```typescript
{
  proposalId: "AP-tool-eval-{cuid}",
  agentId: "AGT-111",
  actionType: "approve_tool_evaluation",        // New action type
  parameters: {
    toolEvaluationId: "...",                     // Links to ToolEvaluation record
    toolName: "...",
    verdict: "approve" | "conditional" | "reject",
    conditions: [...],
    riskLevel: "low" | "medium" | "high" | "critical",
    findingSummary: { critical: 0, high: 1, medium: 2, low: 3 }
  },
  status: "proposed"                             // Awaits human decision
}
```

The human reviewer sees this in the existing proposals UI (`/api/v1/agent/proposals`), reviews the full findings, and approves or rejects.

**Two HITL gates:**

| Gate | Who | When | SLA |
|------|-----|------|-----|
| **Approval Gate** | HR-300 (Enterprise Architect) | After Risk Adjudicator creates proposal | 24 hours |
| **Override Gate** | HR-000 (CDIO) | When Risk Adjudicator recommends REJECT but human wants to override | 48 hours |

**Escalation rules:**

- `critical` security finding → automatic REJECT, no override without HR-000
- `high` security finding → CONDITIONAL allowed if mitigation documented
- Tool type `mcp_server` → always requires HITL approval (never auto-approved)
- Tool type `npm_package` with 0 critical/high findings and OSS license → can be auto-approved at HITL tier 2

**Schema extension** — add to `AgentActionProposal` model in `packages/db/prisma/schema.prisma`:

```prisma
model AgentActionProposal {
  // ... existing fields ...
  toolEvaluationId  String?              // Links to ToolEvaluation when actionType = "approve_tool_evaluation"
  toolEvaluation    ToolEvaluation?      @relation(fields: [toolEvaluationId], references: [id])
}
```

---

### Section 6: Approved Tool Registry

Approved tools are stored in a machine-readable registry:

```typescript
type ApprovedTool = {
  toolName: string;
  toolType: ToolEvaluation["toolType"];
  approvedVersion: string;            // Exact version (pinned)
  allowedVersionRange: string | null;  // e.g. "^2.3.0" for patch updates only
  conditions: string[];                // Constraints on usage
  environments: ("development" | "sandbox" | "staging" | "production")[];
  evaluationId: string;               // Link to ToolEvaluation record
  approvedAt: string;
  reEvaluateAt: string;               // Mandatory re-evaluation date
  status: "active" | "deprecated" | "suspended";
};
```

**Registry location:** `packages/db/data/approved_tools_registry.json`

**Enforcement:** Platform code that installs tools, configures MCP servers, or adds dependencies MUST check this registry. Unapproved tools are blocked with a message directing to the evaluation pipeline.

---

### Section 7: Ongoing Monitoring & Re-evaluation

Approved tools are not approved forever. Three triggers cause re-evaluation, integrated with the existing Process Observer (`apps/web/lib/process-observer.ts`) and its hook (`apps/web/lib/process-observer-hook.ts`).

| Trigger | Detection | Action |
|---------|-----------|--------|
| **Scheduled** | `reEvaluateAt` date reached | Auto-create `re_evaluation` ToolEvaluation, run full pipeline |
| **CVE Published** | Process Observer detects CVE advisory for approved tool | Escalate to AGT-190 (Security Auditor), fast-track re-evaluation |
| **Behavioral Change** | Process Observer detects tool failures, unexpected outputs, or permission changes | Flag to AGT-111 (Risk Adjudicator) for triage |
| **Performance Degradation** | `TaskEvaluation` quality scores trend downward for tool-assisted tasks | Flag for review |

**Process Observer extension** — add to `triageAndFile()` in `process-observer-hook.ts`:

When a `tool_failure` finding is detected, check if the failing tool is in the Approved Tool Registry. If so, instead of filing a generic backlog item, create a `ToolEvaluation` with status `re_evaluation` and route to AGT-190:

```typescript
// In triageAndFile(), after detecting tool_failure:
const approvedTool = await lookupApprovedTool(finding.toolName);
if (approvedTool) {
  // Don't file generic backlog item — trigger re-evaluation
  await createToolReEvaluation(approvedTool, finding);
  return;
}
```

**Post-approval performance tracking** — extend `observeConversation()` (Branch B):

When `routingMeta` includes a tool from the Approved Tool Registry, tag the `TaskEvaluation` record with `toolName`. This builds a performance profile per tool over time, enabling trend analysis:

```typescript
// In evaluateAndUpdateProfile():
const taskEval = await prisma.taskEvaluation.create({
  data: {
    // ... existing fields ...
    toolName: routingMeta.approvedToolName ?? null,  // NEW: track which tool was used
  }
});
```

**Re-evaluation schedule defaults:**

- MCP servers: every 30 days
- npm packages (direct dependencies): every 90 days
- API integrations: every 60 days
- AI providers: every 60 days
- Docker images: every 30 days

---

### Section 8: Integration with Existing Platform

| Existing Component | File(s) | Integration Point |
|-------------------|---------|-------------------|
| **AgentActionProposal** | `packages/db/prisma/schema.prisma:1768-1791`, `apps/web/app/api/v1/agent/proposals/route.ts` | HITL approval gate reuses proposal pattern — add `toolEvaluationId` FK (Section 5) |
| **Process Observer** | `apps/web/lib/process-observer.ts`, `process-observer-hook.ts` | Extend `triageAndFile()` to detect approved-tool failures and trigger re-evaluation instead of generic backlog items (Section 7) |
| **Orchestrator Evaluator** | `apps/web/lib/orchestrator-evaluator.ts` | Extend `evaluateAndUpdateProfile()` to tag `TaskEvaluation` records with `toolName` for post-approval performance tracking (Section 7) |
| **Tool Registry** | `apps/web/lib/mcp-tools.ts` (lines 923-946) | Add registry check in `getAvailableTools()` — block unapproved tools with message directing to evaluation pipeline |
| **Permissions** | `apps/web/lib/permissions.ts` | Register new `CapabilityKey` entries for tool evaluation actions (e.g., `manage_tool_evaluations`, `approve_tool_evaluations`) |
| **Agent Routing** | `apps/web/lib/agent-routing.ts` (lines 380-444) | Add route entry for tool evaluation UI — recommended: `/platform/tools` under existing AI Ops Engineer agent, or `/ea/tools` under Enterprise Architect |
| **Agent Sensitivity** | `apps/web/lib/agent-sensitivity.ts` | Register AGT-190 at `confidential` level (handles security findings that may reveal vulnerabilities) |
| **MCP Security Sandbox** | EP-CODEGEN-001 | AGT-131 (Integration Tester) uses existing sandbox for isolated trial runs |
| **Evaluate Orchestrator** | `packages/db/data/agent_registry.json` (AGT-ORCH-100) | Coordinates evaluation agents, manages pipeline state; AGT-190 added to delegates_to |
| **Governance Orchestrator** | `packages/db/data/agent_registry.json` (AGT-ORCH-800) | Enforces that only approved tools are used in production paths via `constraint_validate` |
| **Diversity of Thought** | `docs/Reference/diversity-of-thought-framework.md` | Validates that evaluation agents maintain genuine perspective diversity |
| **Coworker sendMessage** | `apps/web/lib/actions/agent-coworker.ts` (lines 240-553) | Users initiate evaluations via coworker: "I need a tool that does X" — routed to AGT-112 (Discovery Scout role) |

---

### Section 9: Evaluation Skill (Claude Code Integration)

A new superpowers skill `tool-evaluation` enables Claude Code sessions to invoke the pipeline:

```
/project:tool-evaluation <tool-name-or-url>
```

The skill:
1. Creates a `ToolEvaluation` record with status `proposed`
2. Dispatches Discovery Scout if only a need is stated (no specific tool)
3. Runs Security Auditor + Compliance Assessor in parallel
4. Runs Architecture Reviewer
5. Runs Integration Tester (if no critical blockers)
6. Produces Risk Adjudicator verdict
7. Presents findings to human for HITL approval
8. Updates Approved Tool Registry on approval

---

### Section 10: Research & Benchmarking

Per AGENTS.md design research requirements, this spec benchmarks against:

**Open-source:**
- **SlowMist MCP Security Checklist** (GitHub) — Priority-based server/client/supply-chain checklist. Adopted: category structure, server security checks. Not adopted: client-side browser-specific concerns (not applicable).
- **CoSAI Practical Guide to MCP Security** — 12 threat categories with attack vector taxonomy. Adopted: full 12-category model as evaluation standard. Extended: added platform-specific enforcement via agent pipeline.
- **OWASP Dependency-Check** — SCA tool for known CVEs. Adopted: as tool for Integration Tester to run during sandboxed trial.

**Commercial:**
- **Factory.ai DroidShield** — Real-time SAST catching vulnerabilities pre-commit. Adopted concept: continuous scanning, not just point-in-time evaluation. Differentiator: DroidShield is code-focused; our pipeline evaluates tools/dependencies holistically.
- **Astrix Security MCP Audit** — Research finding 53% of MCP servers use hardcoded credentials. Adopted: credential detection as mandatory Security Auditor check. Differentiator: we go beyond detection to prescribe mitigations and track conditions.
- **EY.ai PDLC / 8090 Software Factory** — Enterprise AI governance with human oversight mesh. Adopted concept: HITL gates at approval and override. Differentiator: our pipeline is agent-native with Diversity of Thought validation, not just human committee review.

**Key differentiator:** No existing framework combines multi-agent diverse-perspective evaluation, CoSAI threat coverage, sandboxed integration testing, ongoing monitoring, and machine-readable approved-tool enforcement in a single pipeline. This is that pipeline.

---

## New & Modified Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `packages/db/data/approved_tools_registry.json` | Machine-readable registry of approved tools |
| Create | `apps/web/lib/tool-evaluation.ts` | ToolEvaluation types, pipeline orchestration |
| Create | `.claude/commands/tool-evaluation.md` | Claude Code skill for invoking pipeline |
| Modify | `packages/db/prisma/schema.prisma` | Add `ToolEvaluation` model; add `toolEvaluationId` FK to `AgentActionProposal`; add `toolName` to `TaskEvaluation` |
| Modify | `packages/db/data/agent_registry.json` | Add AGT-190 (Security Auditor); extend AGT-111, AGT-112, AGT-131, AGT-181, AGT-902 with tool evaluation capabilities |
| Modify | `packages/db/data/role_registry.json` | Add tool evaluation authority to HR-300 |
| Modify | `apps/web/lib/agent-sensitivity.ts` | Add AGT-190 at `confidential` sensitivity level |
| Modify | `apps/web/lib/mcp-tools.ts` | Add approved-registry check in `getAvailableTools()`; register evaluation tools in `PLATFORM_TOOLS` |
| Modify | `apps/web/lib/permissions.ts` | Add `manage_tool_evaluations` and `approve_tool_evaluations` capability keys |
| Modify | `apps/web/lib/agent-routing.ts` | Add route entry for tool evaluation UI (e.g., `/platform/tools`) |
| Modify | `apps/web/lib/process-observer-hook.ts` | Extend `triageAndFile()` to trigger re-evaluation for approved-tool failures |
| Modify | `apps/web/lib/orchestrator-evaluator.ts` | Tag `TaskEvaluation` with `toolName` for post-approval performance tracking |

---

## Acceptance Criteria

1. `ToolEvaluation` Prisma model captures all fields defined in Section 1, with migration applied cleanly
2. `AgentActionProposal` has `toolEvaluationId` FK — evaluation approvals appear in the existing proposals UI
3. All 12 CoSAI threat categories are checked for every MCP server evaluation
4. One new agent (AGT-190) and five extended agents (AGT-111, AGT-112, AGT-131, AGT-181, AGT-902) are registered with distinct perspectives, heuristics, and interpretive models
5. AGT-190 and AGT-902 execute in parallel; AGT-181 runs after both complete
6. Pipeline short-circuits on critical unmitigatable security findings
7. HITL gate blocks MCP server approvals until HR-300 signs off — uses `AgentActionProposal` with `actionType: "approve_tool_evaluation"`
8. Approved Tool Registry is machine-readable and version-pinned
9. `getAvailableTools()` in `mcp-tools.ts` blocks unapproved tools with evaluation pipeline redirect
10. Re-evaluation triggers fire on schedule, CVE detection, behavioral change, and performance degradation
11. `triageAndFile()` in `process-observer-hook.ts` detects approved-tool failures and creates `re_evaluation` records instead of generic backlog items
12. `TaskEvaluation` records are tagged with `toolName` for post-approval performance trending
13. `/project:tool-evaluation` skill creates evaluation and runs pipeline
14. Diversity of Thought validation confirms agents produce genuinely different recommendations
15. AGT-131 (Integration Tester) runs in sandbox isolation (EP-CODEGEN-001 sandbox)
16. Override gate requires HR-000 for overriding critical security rejections
17. Tool evaluation route is registered in `agent-routing.ts` and accessible via AI Coworker
18. All evaluation findings are persisted with evidence links

---

## End-to-End Flow

```text
Developer: "I need an MCP server for filesystem access"

1. /project:tool-evaluation "filesystem MCP server"

2. AGT-112 (Gap Analysis / Discovery Scout) searches registries:
   → Candidate A: @anthropic/filesystem-mcp (official, 12k stars)
   → Candidate B: community-fs-mcp (community, 200 stars)
   → Candidate C: smithery/fs-server (via Smithery proxy)

3. Per candidate, parallel evaluation:

   AGT-190 (Security Auditor) checks Candidate A:
   → improper_authentication: info — uses OS file permissions, no separate auth
   → missing_access_control: medium — no allowlist for accessible paths
   → supply_chain_risk: low — Anthropic-maintained, signed releases
   → [10 more categories...]

   AGT-902 (Data Governance / Compliance Assessor) checks Candidate A:
   → License: MIT ✓
   → Data residency: local-only, no exfiltration ✓
   → EU AI Act: not applicable (utility tool) ✓

4. AGT-181 (Architecture Guardrail / Architecture Reviewer) reviews Candidate A:
   → Trust boundary: stdio transport spawns child process — must run in sandbox container only
   → Coupling: minimal — standard MCP protocol
   → Recommendation: CONDITIONAL — sandbox-only, path allowlist required

5. AGT-131 (SBOM Management / Integration Tester) trials Candidate A in sandbox:
   → Install: clean, no dependency conflicts
   → Smoke test: read/write/list operations pass
   → Rollback: clean removal confirmed
   → Performance: <50ms per operation

6. AGT-111 (Investment Analysis / Risk Adjudicator) weighs findings:
   → 0 critical, 1 medium (path allowlist), 1 low
   → Medium is mitigatable (configure allowlist)
   → Verdict: CONDITIONAL
   → Conditions: ["sandbox-only", "path-allowlist: /workspace/**", "version-pinned: 1.2.3"]
   → Re-evaluate: 2026-04-25

7. HITL Gate: HR-300 (Enterprise Architect) reviews:
   → Approves with conditions
   → Tool added to approved_tools_registry.json

8. Process Observer monitors:
   → Day 30: scheduled re-evaluation triggers
   → If CVE published: fast-track Security Auditor re-review
```
