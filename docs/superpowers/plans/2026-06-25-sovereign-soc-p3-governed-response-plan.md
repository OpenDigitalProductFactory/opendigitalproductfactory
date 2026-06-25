# Sovereign SOC — P3 governed response + security principles: plan

- **Date:** 2026-06-25
- **Spec:** [2026-06-24-sovereign-soc-siem-design.md](../specs/2026-06-24-sovereign-soc-siem-design.md) §4.5, §6, §7.3
- **Epic:** EP-SOVEREIGN-SOC — **BI-74FE2B20**
- **Builds on:** P0–P2 (merged in #2358) + the merged EP-MSP-FEDERATION remediation rail.

## Goal

Governed security response — propose-only, never autonomous on a sovereign estate — with the kernel governing the *action* decision over the registered security dimensions.

## Composes (not rebuilds) the merged federation rail
- `lib/service-desk/remediation-authority.ts`: `RemediationRiskClass`, `evaluateRemediationAuthority` (the BAND gate — read-only auto-approves, mutating needs human, destructive refused), `buildRemediationProposal`, `authorityBandFromBinding`.
- The decision shape (`auto-approve | needs-human-approval | refuse`) and the conservative default band are reused verbatim.

## This pass (DONE)
- `apps/web/lib/security/response-authority.ts`:
  - `SECURITY_RESPONSE_CATALOG` — action types → riskClass + reversible + blastRadius defaults.
  - `securityResponseToDraft` — maps a security response to a federation `RemediationActionDraft`.
  - `securityResponseFeatures` — `principle_decide` feature vectors over the registered dims (`reversibility`/`blast_radius`/`evidence_confidence`/`customer_consent_state`/`business_disruption`).
  - `decideSecurityResponse` — the combined gate: the band sets the floor; the kernel (`principle_decide`, modeled on `lib/decision/ui-surface-features.ts`) can only ratchet it **more conservative**. **Fails safe**: a degenerate/low-confidence kernel result keeps human approval.
- **Security principle pages** (founder doctrine): `never-auto-execute-irreversible-or-estate-wide-response` (commandment) + `prefer-reversible-containment` (core), in `docs/founder-kernel/wiki/principles/`. Dimension vectors weight the cost axes (`blast_radius`, `business_disruption`) negatively per the sign-convention guard. Verified: seed-wiki-kernel + wiki-taxonomy 86/86.
- Wired `propose_response` (the IR-Lead's tool) to compute and record the authority decision on the `SecurityCase`.
- Tests: `response-authority.test.ts` (band gate, kernel ratchet, fail-safe) + the updated `mcp-tools-siem.test.ts`.

## Cross-org (composes P5)
For a customer-scoped case with a `FederationLink`, the proposal additionally rides `routeRemediationProposal` (auto-execute-on-customer / customer-attention-surface / refused) → a `FederatedRemediationProposal` lands on the customer's Attention Surface and the customer's runner executes. The in-org default records the decision on the case for operator approval. Full federation send/receive is P5.
