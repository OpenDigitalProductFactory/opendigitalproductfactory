---
title: "Platform-outward tools are governed by WWMD, not the org WWWD alignment gate"
status: active
backlog: BI-63B14D4B
epic: EP-1C37C089
date: 2026-09-09
---

# Platform-outward tools are governed by WWMD, not the org WWWD alignment gate

_Status: implemented on branch `fix/alignment-gate-platform-tools-wwmd-scope` (PR #5260) · BI-63B14D4B · EP-1C37C089_

## Defect, reproduced on a named ref

On `main` @ `160fdda5ac8a`, `apps/web/lib/tak/consequential-tool-policy.ts:58` treats every tool declaring `consequence: "outward"` as WWWD-alignment-required. `create_portal_pr` (`build-lifecycle-pack.ts:152`), `contribute_to_hive` (`contribution-hive-pack.ts:51`), `discovery_sweep` and `run_hive_scout_ingest` (`discovery-inventory-pack.ts:80,114`), `escalate_feedback_upstream` (`feedback-pack.ts:48`) and `grok_signin_start` (`grok-signin-pack.ts:23`) all declare it, so `alignment-tool-gate.ts:48` sends them to `evaluateOrgBusinessDecisionGate` for the install's organization. `alignmentStatement` (`alignment-tool-gate.ts:28-35`) builds the question from thirteen guessed parameter fields none of these tools carry, so the question is the bare tool name followed by a colon.

Live evidence on the DEV install (ledger 2026-08-24 to 2026-09-09): ten `DecisionInteraction` rows with `gateKey = org-business`, `question` in {`create portal pr: `, `run hive scout ingest: `, `discovery sweep: `, `grok signin start: `}, all `escalate`, `riskTier = medium`, `routeContext = /tool/<name>`, shown to the owner on `/coworker-decisions/review` as "What should the business do?" with a Proceed / Decline capture that would have recorded a standing business answer about platform development.

The failing-then-passing proof is `apps/web/lib/tak/alignment-tool-gate.test.ts`: on the base ref, `create_portal_pr` classifies `alignmentRequired: true` and `alignmentStatement("create_portal_pr", { readinessTrailers })` ends in a colon; on the fix both assertions pass.

Causes ruled out by running them: the org profile is provisioned (`org-perspective-<org>` exists with 16 material rows, so this is not BI-218EC195); the tools are not on the explicit legacy list `ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES` (only `create_digital_product`, `create_marketing_campaign` and the two banking tools are); the classification is derived from the declared consequence, exactly as TAK section 8.4.1 intends, so the defect is the missing distinction between platform-outward and business-outward, not the derivation.

## Objectives

**OBJ-1:** A platform-development action that leaves the install is governed by the founder kernel (WWMD) and is never scored against the customer organization's business stance.

**OBJ-2:** The WWWD alignment gate never escalates a question it cannot state.

## Ordered deliverables

1. `ToolDefinition.consequenceScope: "business" | "platform"` (default business), declared next to `consequence` in `apps/web/lib/mcp-tools.ts`.
2. `alignmentRequiredFor(toolName, consequence, scope)` in `consequential-tool-policy.ts`: the explicit legacy list stays gated; an outward tool is gated only when its scope is not platform. Classification, receipting and the `outward-review` collaboration shape are unchanged.
3. The nine platform-development outward tools declare `consequenceScope: "platform"`.
4. `alignmentStatement` falls back to the scalar parameters it was given, or says that none describe the request.
5. Docs: decision-perspective user guide, how-governed-work-runs, mcp-tool-packs.

## Acceptance criteria

| AC-ID | Objectives | Statement |
|---|---|---|
| AC-1 | OBJ-1 | `classifyConsequentialTool` on each of the six named live catalog tools returns `consequential: true`, `alignmentRequired: false`, `collaborationShape: "outward-review"`. |
| AC-2 | OBJ-1 | `send_marketing_email`, `publish_to_linkedin`, `place_linkedin_ad` and every explicit-list tool still return `alignmentRequired: true`. |
| AC-3 | OBJ-2 | `alignmentStatement` never returns a string ending in a colon; with no descriptive fields it names the scalar parameters, and with none it says no parameters describe the request. |
| AC-4 | OBJ-1 | After deploy, a `create_portal_pr` call on the canonical install writes no `org-business` ledger row and raises no review card (live acceptance, not proven in this PR). |

## Research and benchmarking

Shape follows the existing declared-consequence axis (TAK section 8.4.1, "derived, not enumerated") rather than a second allowlist. Compared against Open Policy Agent style resource scoping (subject/resource/action tuples) and Kubernetes admission webhooks' namespace scoping: both keep the scope on the declared object, which is the pattern adopted; a caller-side classifier was rejected because the caller (an external agent) is the party with the least authority to say whose stance governs.
