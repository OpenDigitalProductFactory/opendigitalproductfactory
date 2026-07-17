# Coworker Authority Model Completion — Design (TAK/GAID realization)

**Status:** Draft for founder review — sequencing decision open
**Epic:** EP-31815F97
**Folds in:** BI-56E9CEC2 (grant-source reconciliation)
**Kernel:** `principle_decide` DI-F2CE9FF30BB7 (slice sequencing — near-tie, human review)
**Date:** 2026-07-17
**Realizes:** `docs/architecture/trusted-ai-kernel.md` (TAK), `docs/architecture/GAID.md`
**Prior work extended:** EP-GOVERN-003 (`2026-03-26-agent-rbac-action-audit-design.md`), `2026-04-24-coworker-authority-binding-admin-design.md`, `2026-06-28-regulatory-autonomy-ceiling-policy-design.md`, `2026-05-11-autonomous-coworker-runtime-design.md`, EP-7B169558 (decision-altitude control plane)

---

## 1. The problem, in the founder's frame

Grants are specific to a coworker's job. The human↔AI interaction, with the **call-chain as the key authority-traceability**, is what RBAC and evidence recording depend on — modeled like network-packet routing: every action carries the chain of who authorized it, back to a human. What grants a coworker receives is predicated on its role and objectives, set by the platform + humans governing it. That needs a **conservative baseline**, exposed and adjustable with **minimal cognitive load** — because as tool density grows, so does settings granularity, and **humans get lazy and reach for YOLO / all-access**, which defers every decision to the AI regardless of impact and is **against regulations that require human attribution in decisions**.

The balance: **WWMD/WWWD/WSID** mitigate bad decisions; **RBAC** is the protective layer; **chained auth** provides traceability + origin authority per transaction; the **autonomy ceiling** caps how far the AI acts alone.

## 2. What already exists (verified — do not rebuild)

DPF has built most of the mechanism; the gap is connective tissue.

| Plane | Substrate that exists | Wiring status |
|---|---|---|
| **RBAC (authority)** | `AgentToolGrant` + `TOOL_TO_GRANTS` (closed ~70-key vocab) + `GRANT_IMPLICATIONS` (one-way narrowing) + default-deny; `COWORKER_READ_BASELINE_GRANTS` read floor; effective = agent-grant ∩ human `can()` (TAK §7.2) | **Live** in `governedExecuteTool` |
| **Chain-of-custody** | `DelegationChain` (`chainId`, `depth`, `fromAgentId→toAgentId`, `authorityScope`, `originUserId`, `originAuthority`, `parentLinkId`; `MAX_DELEGATION_DEPTH=4`, loop detection, per-hop **authority narrowing** — TAK §11) + `delegation-authority.ts`; dual-principal `ToolExecution` (`delegatingUserId`, Pseudo-User Contract); `AuthorizationDecisionLog` (`actorType`, `delegationGrantId`, `decision`, `rationale`); `ToolExecutionReceipt` (input/output fingerprints — GAID hash analog) | **Partial** — chain only in the skill-discovery path; **not threaded through `governedExecuteTool`**; subsystems un-joined; `DelegationChainView` orphaned |
| **Autonomy (how far alone)** | Live: Advise/Act mode (advise = drop `sideEffect`) + `hitlTierDefault`. Built-not-live: `trust-graduation` (shadow/propose/supervised/autopilot, "no YOLO, start at L0"), `autonomy-envelope` (risk-class read-only/internal-reversible/internal-irreversible/outbound-or-floor → decision mode), `RegulatoryAutonomyPolicy` (`maxAutonomyLevel`, `humanControlRequired`) | **Act mode unbounded by impact** — the risk-class→approval coupling is recommendation-only, not on the live gate |
| **Decision quality** | WWMD/WWWD/WSID via `principle_decide`; `DecisionShadowLedger` (cross-links `toolExecutionId`/`taskRunId`/`envelopeId`/`regulatoryPolicyId`) | Live; **not joined to `DelegationChain`** |

## 3. The gaps (each a governed slice under EP-31815F97)

- **S1 — Role-derived RBAC baseline (folds BI-56E9CEC2).** There is **no role→grant rule**; grants are hand-listed → 19/20 coworker grant sources diverge, and the editor is a flat ~70-key dropdown. Introduce a conservative `Record<roleKind|valueStream, grantKey[]>` baseline (net-new); per-agent grants become **deltas from baseline**; resolve the divergence by *deriving from role*, not picking a side; reconcile the permissive `hitlTierDefault @default(3)`.
- **S2 — Chain-of-custody through the universal seam.** Thread `DelegationChain` through `governedExecuteTool`: every `ToolExecution` + `DecisionShadowLedger` joins a chain rooted at a human; write `AuthorizationDecisionLog` on the seam; finish Slice-2 authority propagation (non-empty `authorityScope`/`originAuthority`); wire the orphan `DelegationChainView`. → *every action traces to a human, universally* (TAK §7.1, GAID §10).
- **S3 — Live impact-gated autonomy (the anti-YOLO fix).** Wire the built risk-class/autonomy-envelope + `RegulatoryAutonomyPolicy.humanControlRequired` to the **live** path so `internal-irreversible`/`outbound-or-floor` actions require human approval (envelope/proposal) **even in Act mode**. → *YOLO becomes structurally unreachable*; regulatory human-decision attribution preserved.
- **S4 — Low-cognitive-load authority-binding admin.** Extend `coworker-authority-binding-admin-design.md` + `AuthorityBinding`: operators adjust **role posture + autonomy ceiling + baseline-diff**, grouped by domain/read-vs-write, never a per-tool all-access checkbox. Surfaces implications (e.g. `siem_tune ⊃ siem_read`).
- **S5 — Govern the MoE delegation (from EP-E431FC8A Phase 4).** The specialist-router's delegation hop uses `DelegationGrant` + `AgentGovernanceProfile.allowDelegation`/`maxDelegationRiskBand` + `extendChain` (narrowing), recorded in the chain — turning recommend-only into governed, traceable delegation.

## 4. The layered model (what "balance" means, concretely)

An action is permitted and attributable only when **all four layers** agree — no single toggle can grant blanket authority:

1. **RBAC floor (S1)** — effective grants = role-baseline ⊕ per-agent delta, ∩ human `can()`. Conservative by default; least-privilege; deny-by-default.
2. **Autonomy ceiling (S3)** — impact/risk-class + `RegulatoryAutonomyPolicy` cap how far alone; irreversible/outbound ⇒ human approval regardless of Act mode or earned trust. *This is the anti-YOLO layer.*
3. **Chain-of-custody (S2)** — every execution carries origin authority + the human→coworker→delegate→tool chain; recorded for RBAC evidence + non-repudiation. *This is the traceability layer.*
4. **Decision quality (existing)** — WWMD/WWWD/WSID score the decision itself; the ledger joins to the chain.

## 5. Invariants

- **INV-A1 (deny-by-default, role-conservative).** A coworker's default authority is its read-baseline + role baseline; anything beyond is an explicit, recorded delta.
- **INV-A2 (no blanket YOLO).** No setting grants all-access or defers all decisions irrespective of impact; the autonomy ceiling + `humanControlRequired` bind even at maximum earned trust and in Act mode.
- **INV-A3 (universal traceability).** Every governed tool execution links to a `DelegationChain` rooted at a human principal; no orphan actions.
- **INV-A4 (narrowing-only delegation).** Delegated authority may only narrow, never widen (TAK §11); enforced per hop; depth-bounded; loop-free.
- **INV-A5 (human attribution on consequential actions).** Internal-irreversible/outbound actions record a human approver (regulatory attribution), never an AI-only decision.

## 6. Open decision (founder — kernel punted, DI-F2CE9FF30BB7)

The kernel scored **S2 chain-first ≈ S3 anti-YOLO-first** as a near-tie (margin 0.04, low confidence, "recommend human review"); S1 baseline scored lower as a lead but is the most self-contained. **Which slice leads?** Architect's note: S2 and S3 both live at the same `governedExecuteTool` seam and are naturally one slice ("make the execute gate the complete authority seam: chain-of-custody + impact-gated approval"), with S1 as a parallel track and S4 the operator surface over both. Sequencing awaits founder direction before implementation of the execute-seam changes (highest blast radius, authority-sensitive).

## 7. Non-negotiables for implementation

- Reuse the existing substrate (DelegationChain, autonomy-envelope, AuthorityBinding, receipts) — connect, don't rebuild.
- Execute-seam changes land behind evidence gates + tests reproducing "an irreversible Act-mode action now requires approval" and "every ToolExecution joins a human-rooted chain."
- No authority escalation without a governed grant; role-baseline changes are additive and reviewed.
