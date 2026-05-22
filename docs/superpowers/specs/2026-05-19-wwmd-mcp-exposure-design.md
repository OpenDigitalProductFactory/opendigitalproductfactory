# WWMD MCP Exposure Design

| Field | Value |
| --- | --- |
| Date | 2026-05-19 |
| Status | Draft for review |
| Working title | Expose WWMD Decision Perspective as MCP tool |
| Primary v1 surface | MCP tool registry (Claude Code, Codex CLI, any MCP client) |
| Related epics | `EP-PRINCIPLES`, `EP-BUILD-STUDIO`, `EP-TAK-3F9A21`, `EP-COWORKER-RT` |
| Related specs | [`2026-05-17-wwmd-decision-perspective-kernel-design.md`](2026-05-17-wwmd-decision-perspective-kernel-design.md), [`2026-05-18-mcp-governance-flow-token-scope-design.md`](2026-05-18-mcp-governance-flow-token-scope-design.md), [`2026-05-19-persona-voice-layer-wwtd-design.md`](2026-05-19-persona-voice-layer-wwtd-design.md) |
| Related code | [`apps/web/lib/decision-perspective/evaluator.ts`](../../../apps/web/lib/decision-perspective/evaluator.ts), [`apps/web/lib/decision-perspective/build-studio-gate.ts`](../../../apps/web/lib/decision-perspective/build-studio-gate.ts), [`apps/web/lib/decision-perspective/persistence.ts`](../../../apps/web/lib/decision-perspective/persistence.ts), [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts) |

## 1. Purpose

WWMD (`evaluateDecisionPerspective`) is live in-portal and gates the Build Studio plan-advancement flow. Today its only consumer is the in-portal Build Studio path. External agentic sessions (Claude Code in the IDE, Codex CLI, future MCP clients) cannot consult it.

This forces Mark to answer the same recurring micro-decisions by hand, session after session — for example:

> Agent: *"Want me to commit this revised spec to main and feed it to writing-plans for the Sprint 1 plan?"*
> Mark: *"yes."*

The standing rule `feedback_spec_commit_plan_process` (memory) already encodes the answer: **approved spec is immediately committed to main AND fed to writing-plans; never ask between those steps.** WWMD has the principle. The Claude Code / Codex session does not.

Exposing WWMD as an MCP tool closes that gap. The same evaluator that decides whether Build Studio may advance a phase becomes the decision substrate any external agent session can call to answer recurring `plan-readiness` / `architecture-tradeoff` / `risk-assessment` questions consistently with Mark's doctrine.

## 2. Product Thesis

Every recurring "should I do X next?" question from an agent session first needs routing. Low-ambiguity or low-consequence questions should stay in direct chat, deterministic lookup, or normal workflow controls. Ambiguous and consequential questions are one of three things:

1. **Already-decided** — codified as principle/feedback material in WWMD. The agent should *not* ask; it should call WWMD, get `recommend` or `arbitrate`, and proceed.
2. **Coverage gap** — no material applies, or material below confidence threshold. WWMD returns `defer` / `escalate`; the agent surfaces the question to Mark. Mark's answer becomes candidate material for next time.
3. **Principle conflict** — competing approved principles. WWMD returns `escalate`; the human resolution becomes a tier-adjustment material that breaks the tie in future.

For that governed class, the call site is symmetrical: *call WWMD before asking the human*. Over time, the second and third paths collapse into the first as the corpus grows. That is what makes "drops not buckets" actually compound.

## 3. Scope

### 3.1 In scope (v1, Sprint 1)

**New MCP tools** in [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts):

- `wwmd_evaluate` (read-only advisory) - wraps `evaluateDecisionPerspective` and `resolveProfileMaterial` without writing a `DecisionInteraction`. Use when the external agent is exploring, drafting, or helping the operator think. Inputs:
  - `question: string` — the natural-language decision the agent is about to ask
  - `options: string[]` — choices being weighed (at least two; "do X" / "do not do X" if binary)
  - `domainClass: "plan-readiness" | "architecture-tradeoff" | "risk-assessment"` — required
  - `riskTier: "low" | "medium" | "high" | "critical"` — required; agent's best estimate, defaults to `medium`
  - `profileId?: string` — defaults to `MARK_DPF_PLATFORM_PROFILE.profileId`
  - `evidence?: DecisionEvidenceItem[]` — optional grounding the agent already gathered (file paths, log excerpts, prior PR refs)
  - `routeContext?: string` — e.g. `claude-code`, `codex-cli`, `build-studio`
  - `agentId?: string` — caller identity (claude-code session id, codex run id, or a coworker id)

  Output: full `DecisionPerspectiveEvaluationResult` plus `recommendedOption: string | null` (the option the rationale points at, or `null` for `defer`/`escalate`), `operatorMessage: string`, and `interactionId: null`. The caller must not treat advisory output as authority to cross a phase, approval, or tool boundary.

- `wwmd_decide` (write, governed decision) - wraps the same evaluator but writes or reuses a `DecisionInteraction`. Use only when the question is both ambiguous and consequential, or when the operator explicitly chooses a governed WWMD decision. Inputs include all `wwmd_evaluate` fields plus:
  - `routingReason: string` - why direct ask, deterministic lookup, or normal coworker chat is insufficient
  - `sourceTaskRunId?: string` - when invoked from an A2A/coworker handoff
  - `sourceArtifactId?: string` - the question packet or decision packet that triggered the call

  Output: full `DecisionPerspectiveEvaluationResult` plus `recommendedOption: string | null`, `interactionId: string`, `operatorMessage: string`, and `ledgerAction: "created" | "reused"`.

- `wwmd_record_outcome` (write, governed) — records what the human actually decided when WWMD returned `defer` / `escalate`, or when the agent overrode a `recommend`. Inputs:
  - `interactionId: string` — from a prior `wwmd_decide` call
  - `chosenOption: string`
  - `rationale: string` — human's stated reason, free-text
  - `overrodeRecommendation: boolean`

  Side effect: appends a candidate `PerspectiveMaterial` (sourceType `"interaction-outcome"`, reviewStatus `"draft"`, promotionState `"candidate"`) tied to the originating profile. Existing review UI handles promotion to approved/promoted; nothing auto-promotes in v1.

**Token scope:**

- New OAuth scopes `wwmd:evaluate` (read), `wwmd:decide` (write), and `wwmd:record` (write), following the pattern in [`2026-05-18-mcp-governance-flow-token-scope-design.md`](2026-05-18-mcp-governance-flow-token-scope-design.md).
- Default Claude Code / Codex install grants include `wwmd:evaluate`. `wwmd:decide` and `wwmd:record` are opt-in per agent identity. They are default-on only for the platform `dpf-agent` pseudonym or another explicitly governed platform agent.

**Question fingerprinting:** applies to `wwmd_decide`, not advisory evaluation. `wwmd_decide` computes a stable fingerprint over `(profileId, domainClass, normalize(question), sorted(options))`. If a `DecisionInteraction` with the same fingerprint exists in the last 30 days, return its `interactionId` instead of creating a new one (the underlying evaluator still re-runs against current material — confidence may have moved). This is what lets a recurring "commit spec + plan?" stop being a fresh governed decision every session. `wwmd_evaluate` creates no records and therefore has no dedupe behavior.

**Golden-path test:** a script that boots a fresh portal, seeds the `feedback_spec_commit_plan_process` principle as approved+promoted material, then calls `wwmd_decide` from an authorized CLI MCP client with the literal question Mark used in the brief, asserts the outcome is `recommend` with confidence ≥ 0.7, `recommendedOption === "commit and feed to writing-plans"`, and `outcomePayload.routingReason` is present.

### 3.2 Out of scope (deferred)

- **Auto-promotion** of candidate → promoted material. v1 stays manual; the existing review surface owns promotion. (Reason: WWMD's kernel principle is *confidence is earned in drops*. Auto-promote breaks that.)
- **Persona voice / WWTD prose layer.** Covered by [`2026-05-19-persona-voice-layer-wwtd-design.md`](2026-05-19-persona-voice-layer-wwtd-design.md). `wwmd_evaluate` and `wwmd_decide` return structured outcome + plain rationale; persona prose comes from the WWTD layer, downstream.
- **Multi-profile selection UI.** v1 uses the platform profile by default; explicit `profileId` is supported but no resolver heuristic.
- **Streaming / partial evaluation.** Synchronous call/response; evaluator already returns in milliseconds.
- **Cross-installation hive learning.** Each install's WWMD corpus stays local; hive contribution of approved materials is a follow-on epic.

### 3.3 Non-negotiables

- `wwmd_evaluate` MUST NOT mutate state. Calling it 1,000 times in a debug loop creates no records and returns `interactionId: null`.
- `wwmd_decide` MUST write or reuse a `DecisionInteraction`, MUST require `routingReason`, and MUST store that reason in `DecisionInteraction.outcomePayload.routingReason`.
- `wwmd_record_outcome` MUST tie to an existing `interactionId`. No phantom outcomes.
- Material produced by `wwmd_record_outcome` MUST land in `reviewStatus: "draft"` regardless of caller identity. No agent (not even `dpf-agent`) can promote material into the active corpus without human review.
- The MCP tools MUST reuse the existing evaluator + persistence modules. **No re-implementation of decision logic in the MCP layer.** (Per kernel principle `verify-substrate-before-proposing-new`.)
- Failure modes are explicit. If the profile is missing, the corpus is empty, or DB access fails, the tool returns `{ outcomeType: "defer", gapReason, rationale }` — never a silent success. (Per kernel principle `check-tool-signals-first`.)
- The MCP surface MUST preserve the product boundary from the kernel spec: direct ask helps think; WWMD helps decide. Advisory evaluation is not an action gate. Governed decision is a ledgered decision path.

## 4. Architecture Touchpoints

```
External agent (Claude Code / Codex)
        │  MCP call
        ▼
mcp-tools.ts  ─── wwmd_evaluate ───► evaluator.evaluateDecisionPerspective
                                    │
                                    ▼
                              advisory result only

mcp-tools.ts  ─── wwmd_decide ─────► evaluator.evaluateDecisionPerspective
                                    │
                                    ▼
                              persistence.persistDecisionInteraction
                                    │
                                    ▼
                              DB: DecisionInteraction
                                    ▲
                                    │
mcp-tools.ts  ─── wwmd_record_outcome ──► persistence.recordInteractionOutcome (new)
                                              │
                                              ▼
                                        DB: PerspectiveMaterial (candidate, draft)
```

No new tables. One new column on `DecisionInteraction`: `questionFingerprint VARCHAR(64) NOT NULL` (migration adds with backfill from existing rows; index on `(profileId, questionFingerprint, createdAt DESC)` for dedup lookups).

## 5. Decision Outcome → Agent Behavior Mapping

Advisory `wwmd_evaluate` output helps the agent and operator reason. It does not authorize the agent to proceed through a governed boundary. If the caller wants to act on a high-ambiguity, high-consequence answer, it must call `wwmd_decide` or route through the in-portal gate first.

Governed `wwmd_decide` output maps as follows:

| WWMD outcome | What the agent does next |
| --- | --- |
| `recommend` (confidence ≥ 0.7) | Print `operatorMessage`, proceed with `recommendedOption` without asking. |
| `arbitrate` | Print `operatorMessage`, proceed with `recommendedOption`, log to `[wwmd-trace]`. |
| `escalate` | Surface the question and rationale to the human; pass returned `interactionId` to `wwmd_record_outcome` once human answers. |
| `defer` (coverage gap) | Surface the question with a note that WWMD has no material yet; record outcome → becomes seed material. |
| Error / DB unavailable | Treat as `defer`; never block the agent on a WWMD subsystem outage. |

## 6. Risks & Open Questions

1. **Question normalization drift.** Two semantically identical questions phrased differently won't dedupe. Sprint-1 normalization is `lowercase + collapse whitespace + strip trailing punctuation`. Embedding-based clustering is an obvious follow-on but explicitly out of scope.
2. **Risk-tier sandbagging.** Agents have an incentive to mark every question `low` to clear the autonomy thresholds. Mitigation: log `(routeContext, agentId, riskTier)` distributions; periodic review surfaces agents whose risk-tier mix doesn't match their actual decisions. Not auto-enforced v1.
3. **Mode confusion.** Agents may use advisory output as if it were governed approval. Mitigation: split read-only `wwmd_evaluate` from write-scoped `wwmd_decide`, return `interactionId: null` for advisory calls, and require `routingReason` for governed decisions.
4. **Material poisoning.** If `wwmd_record_outcome` can be called by any external token, a malicious caller could flood the candidate queue. Mitigation: rate-limit per `agentId` (e.g. 20 candidates/day) plus the existing `draft` gate. Sprint-1 ships the rate limit; review-queue UX is existing.
5. **Profile selection ambiguity for non-platform contexts.** v1 hardwires `MARK_DPF_PLATFORM_PROFILE` as default. Customer installs will need a resolver. Listed as deferred.

## 7. Success Criteria

- An authorized Claude Code or Codex session invokes `wwmd_decide` for the literal "commit spec + plan?" question and gets `recommend` without surfacing the question to Mark.
- A second invocation of the same question in the same 30-day window returns the same `interactionId` and current confidence (dedupe works).
- A `defer` outcome → `wwmd_record_outcome` → human-visible candidate material in the review queue, within one session.
- Zero state mutations from `wwmd_evaluate` calls; `wwmd_decide` is the only evaluation path that writes a ledger row.
- `[wwmd-trace]` log lines (per [`feedback_tool_trace_logging`](../../../packages/db/src/seed.ts)) make every evaluation traceable from a session transcript.

## 8. Sprint 1 Boundary

Sprint 1 ships everything in §3.1 plus golden-path test. §3.2 items are explicitly deferred to follow-on sprints with their own specs. The plan document should decompose §3.1 into:

1. `wwmd_evaluate` MCP handler + tool registration + read scope
2. `wwmd_decide` MCP handler + write scope + required `routingReason`
3. Question fingerprinting (column + migration + dedupe lookup) for governed decisions
4. `wwmd_record_outcome` MCP handler + candidate-material write path + rate limit
5. Golden-path integration test
6. Documentation update (operator-facing: how Claude Code / Codex consumes advisory versus governed WWMD)
