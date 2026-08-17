# Operator Ratification Queue — Simplify & Strengthen, Objective 2

- **Date:** 2026-08-16
- **Status:** Awaiting operator ratification (nothing below is decided; each brief carries a kernel-consult *recommendation*, prepared per the delivery plan's §6 completion gate)
- **Program:** [delivery plan](2026-08-16-simplify-strengthen-delivery-plan.md) (BI-4C9D700D, EP-413F2602) · [architecture pass](../../architecture/2026-08-16-simplify-and-strengthen-architecture-pass.md)
- **How to ratify:** record the ruling on the cited decision interaction (confirm or override) so the DI ledger carries `humanOutcome`; the follow-on actions listed per brief then unblock.

The four decisions the program cannot make for itself, stated as briefs with the WWMD kernel consult attached. All four consults ran against the live kernel (profile `mark-dpf-platform`) on 2026-08-16; none flagged a commandment conflict.

---

## Brief 1 — W12: MCP protocol version window (BI-EE64547B, EP-E1F1DB58)

**Question.** The MCP transport advertises three protocol revisions (`2025-11-25`, `2025-03-26`, `2024-11-05`) with no stated support policy. What is the ratified version-support contract?

**Recommendation (kernel consult DI-38394A510979, composite 8.05 vs 0.96, margin 7.09, high confidence):** ratify the **current + one-previous (N/N-1) window** as a written contract in the MCP authorization runbook; retire `2024-11-05` under its procedure (announce → window → remove); standardize internal AI-coworker surfaces on **stateless per-call MCP** with no session affinity.

**What ratification unblocks:** the runbook contract lands; `2024-11-05` retirement is scheduled; the stateless internal contract becomes a stated requirement for coworker-loop changes. The working contract is already authored (pending this ruling) at `docs/professions/mcp-integration/wiki/mcp-protocol-version-window.md`.

**If overridden:** name the window (N/N-2? indefinite?) and the corpus page and runbook follow the ruling.

---

## Brief 2 — W18: Multi-tenancy posture (BI-F238FBE4, EP-413F2602)

**Question.** Only 117/588 models carry `organizationId`; the CRM/commerce spine is org-blind; ~150 call sites assume exactly one org; the newest verticals use composite-FK estate scoping — and the invariant is written nowhere. What is the platform's tenancy posture?

**Recommendation (kernel consult DI-2A0379CE01D1, composite 7.92 vs 2.73 (SaaS) vs 0.29 (defer), margin 5.19, high confidence):** ratify **install = tenant** as a written invariant (the sovereignty thesis, D1/D7), and harden the one real intra-install boundary the MSP motion depends on: extend the composite-FK `organizationId` pattern across the CRM/commerce spine and add a lint failing unfiltered `organization.findFirst()`. Do **not** add SaaS tenancy columns platform-wide.

**What ratification unblocks:** `docs/founder-kernel/wiki/principles/install-is-the-tenant.md` (authored at contextual tier, explicitly pending this ruling) is promoted to core tier; the estate-hardening and findFirst-lint work is scheduled; MSP Topology-A work proceeds against a stated invariant. This ratification **precedes** Topology-B enablement (BI-AD9ABD38).

**If overridden toward SaaS tenancy:** the consult's ledger shows the cost concentration (blast radius across every install's forward-only chain; speed near zero); an override should state the customer evidence that outweighs it.

---

## Brief 3 — W13: IA section taxonomy (BI-118EF48B, EP-8DC217EB)

**Question.** The rail's 6 sections are unlinked to the canonical FPAW 4-portfolio spine. Ratify the target section taxonomy?

**Recommendation (kernel consult DI-7C77E1595FD4, composite 7.32 vs 1.77, margin 5.55, high confidence):** ratify the **4 portfolios + 2 honestly-labeled cross-cuts (Workspace, Knowledge)** taxonomy from the [portfolio-shaped IA design](../specs/2026-08-14-portfolio-shaped-information-architecture-design.md), executing the **Workforce slice first** (unify `/employee`, `/platform/ai`, `/coworker-decisions` via `shellNav.sectionKey` only), with the legacy `*-nav.ts`/`*TabNav` burn-down inside the EP-NAV-COHERENCE ratchet.

**What ratification unblocks:** the Workforce slice implementation (W13); the pass's UX-primitive findings ride as its companion workstream.

---

## Brief 4 — W14: Workroom gate enforce-mode (BI-E0BFFF77, EP-1C37C089)

**Question.** The Workroom governance anchor (work-shape action envelope + `principle_decide` autonomy gate on consequential coworker tool calls) ships shadow-first. What must be true before it flips to enforce?

**Recommendation (kernel consult DI-6D5D686464DC, composite 8.19 vs 3.09, margin 5.10, high confidence):** ship the gate as a governance lifecycle hook in **shadow mode** (audit-only verdicts, `DPF_WORKROOM_GATE_MODE` defaulting `shadow`); flip to enforce only when **both** hold: (1) W2 (BI-640B011D) has landed Workroom referential integrity — the gate must not trust `leaseHolderPrincipalId`/participant refs the schema does not enforce; (2) the operator ratifies the gate semantics against shadow-run telemetry (false-positive rate on real coworker actions). Enforce-mode is itself this ratification's subject — flipping the default is a one-line reviewed change, not a redeploy.

**What ratification unblocks:** `DPF_WORKROOM_GATE_MODE=enforce` as the shipped default; widening the consequential-tool cohort beyond the current 9-name allowlist becomes a follow-on decision informed by the same telemetry.

---

## Queue summary

| # | Decision | BI | Kernel consult | Recommendation | Blocking |
|---|---|---|---|---|---|
| 1 | MCP version window | BI-EE64547B | DI-38394A510979 (8.05, +7.09) | N/N-1 + stateless internal | 2024-11-05 retirement; runbook contract |
| 2 | Tenancy posture | BI-F238FBE4 | DI-2A0379CE01D1 (7.92, +5.19) | install=tenant + estate hardening | kernel-page tier promotion; MSP Topology-A hardening; precedes Topology-B |
| 3 | IA section taxonomy | BI-118EF48B | DI-7C77E1595FD4 (7.32, +5.55) | 4 portfolios + 2 cross-cuts, Workforce slice first | W13 execution |
| 4 | Workroom gate enforce-mode | BI-E0BFFF77 | DI-6D5D686464DC (8.19, +5.10) | shadow now; enforce after W2 + telemetry review | enforce default; cohort widening |
