# Coworker Tool-Provisioning MCP Door — Design

- **Date:** 2026-07-03
- **Epic:** EP-F7E35344 (AI Coworker Capability Inputs)
- **Backlog items:** BI-60E2B1BE (this door), BI-FE37B0A1 (companion: advise-mode strip is invisible / self-misdiagnosis)
- **Instances unblocked:** BI-CAP-953AF920 (grant `backlog_write` → AGT-WS-SCOUT so `run_hive_scout_ingest` can execute), BI-CAP-7F2AE411 + BI-CAP-C2565D94 (trim overloaded coworkers' tool surface)

## Problem

The AI Ops Engineer coworker (`platform-engineer` / `AGT-WS-PLATFORM`) is chartered to *"manage provider/model assignments and routing"*, yet when an operator asks it to fix AI-readiness blockers it can only summarise. Two distinct shortcomings:

1. **No fulfilment door (this spec).** Coworkers can *submit* and *list* capability needs (`submit_coworker_capability_need`, `list_all_capability_needs`) but there is **no coworker-callable MCP tool to fulfil one** — to grant or revoke a tool-authority grant key on a coworker. The write path already exists as the server actions `grantCoworkerTool` / `revokeCoworkerTool` (`apps/web/lib/actions/coworker-grants.ts`), reachable only through the admin agent-record page. Absent from the MCP surface, the coworker stays advisory on its own charter and correctly reports the action is *"outside what I can push from here."*

2. **Advise-mode strip is invisible (companion BI-FE37B0A1, out of scope here).** On non-`/build` routes the coworker defaults to advise mode, which strips every `sideEffect` tool it holds a grant for, and it is not told — so it misreports a mode muzzle as a permission gap. Tracked separately to keep this PR single-concern.

## Design

Add one governed MCP tool: **`manage_coworker_tool_grant`**.

```
manage_coworker_tool_grant({ coworker, grantKey, action })
  coworker  : agentId | slugId | displayName | alias of the target coworker
  grantKey  : a key in the closed vocabulary (knownGrantKeys())
  action    : "grant" | "revoke"
```

### Authorisation (defence in depth)

| Layer | Gate | Rationale |
| ----- | ---- | --------- |
| Agent grant | `TOOL_TO_GRANTS.manage_coworker_tool_grant = ["agent_control_read"]` | Same grant that gates the sibling AI-ops management tools (`add_provider`, `update_provider_category`). `AGT-WS-PLATFORM` holds it. |
| User capability | `requiredCapability: "manage_platform"` | Identical to the capability the existing server action (`grantCoworkerTool`) enforces. A privileged human must be in the loop. |
| Mode | `sideEffect: true` | Advise mode strips it — authority changes only happen when the operator has put the coworker in **Act** mode. |
| Vocabulary | `knownGrantKeys()` validation | A typo can never persist a row that authorises nothing (mirrors the server action). |
| Self-dealing | **self-target guard** | A coworker may not grant/revoke **its own** authority — blocks trivial privilege escalation. Operator or a *different* authorised coworker must act. |
| Audit | `ToolExecution` (automatic) | Every call is recorded and visible at `/platform/ai/authority`. |

### Single source of truth

The grant mutation + closed-vocabulary validation is extracted into a pure module `apps/web/lib/tak/coworker-tool-grant-core.ts` (`resolveCoworkerAgent`, `applyCoworkerToolGrant`, `removeCoworkerToolGrant`, and the `manageCoworkerToolGrant` orchestrator). Both the existing server actions and the new MCP handler delegate to it, so validation and mutation live in exactly one place. The server actions keep their own `requireCapability` + `revalidatePath` (Next request concerns); the MCP handler keeps the dispatch-layer gate + self-target guard.

### What this deliberately does NOT do

- It grants/revokes **one grant key at a time**. Bulk "trim to N tools" / phase-scoping (BI-CAP-7F2AE411) is a larger policy design; this door gives the coworker the primitive it currently lacks.
- It does not add an approval/HITL card. The `sideEffect` + `manage_platform` + self-target gates match the existing sibling tools; a future HITL escalation for authority changes can layer on without changing the tool contract.

## Research & Benchmarking

- **Kubernetes RBAC `escalate`/`bind` verbs.** K8s blocks a subject from granting privileges it does not itself hold, and treats role-binding as a distinct verb. We adopt the *self-dealing block* (a coworker cannot escalate its own authority) and the *closed-vocabulary* stance; we do **not** yet adopt the full "cannot grant what you don't hold" rule (the human `manage_platform` gate already bounds it) — noted as a possible hardening.
- **AWS IAM `iam:PassRole` / permission boundaries.** IAM separates "who may pass/grant a role" from "what the role can do", and audits every grant. Mirrored by our `manage_platform` gate + `ToolExecution` audit trail.
- **Anti-pattern rejected:** a generic `run_sql` / raw registry-edit escape hatch. AGENTS.md §8 forbids bypassing the scoped grant gate; the door is a typed, validated, closed-vocabulary tool, never an arbitrary write.

## Verification

- Unit: `coworker-tool-grant-core.test.ts` — unknown key rejected before any write; known key upserts with `grantedBy`; revoke is no-throw when absent; ref resolution by agentId/slug/alias; self-target guard; unknown coworker.
- Unit: existing `coworker-grants.test.ts` continues to pass (server actions now delegate).
- Wiring: `TOOL_TO_GRANTS` mapping + tool-description hygiene (existing CI guard scans the new description).
- Build gate: typecheck + `pnpm --filter web build` via CI (worktree is source-only).
