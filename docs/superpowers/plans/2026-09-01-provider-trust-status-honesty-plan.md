# Provider trust status honesty implementation plan

**Backlog:** BI-231CA01C  
**Design:** `docs/superpowers/specs/2026-09-01-provider-trust-status-honesty-design.md`

1. Add failing component tests for the restricted-work summary, declaration acknowledgement, honest claim-specific next actions, all evidence states, and the unambiguous empty-region control.
2. Refactor `ProviderTrustEvidencePanel` into a truthful presentation over the existing resolved claims; pass the existing declaration review timestamp as acknowledgement context.
3. Remove the in-input region example and add explicit empty-state/help copy to `ProviderAccountPostureForm`.
4. Update provider-trust operator documentation without changing routing or evidence semantics.
5. Run focused tests, typecheck/build gates, UX-fit review, exact-tree evidence, PR/merge queue, canonical self-upgrade, and live provider-page verification.

No migration is required. Documentation impact is user-facing and is handled in the same change.

## UX fit review

- Decision: fits-with-guardrails
- Owning area: Platform
- Route family: `/platform/ai/providers/[providerId]`; no route or navigation change
- Primary persona: platform operator deciding whether a connected provider can handle restricted work without having to infer evidence semantics
- Navigation layer touched: none; copy and empty-state behavior inside the existing detail page
- Reuse/convergence: preserves the existing `ProviderAccountPostureForm` and `ProviderTrustEvidencePanel`; no new card, badge, form, or report primitive
- Source truth: `AiProviderConnection`, `SupplierContract`, `ComplianceEvidence`, and `resolveProviderTrustEvidence`
- Empty/failure behavior: an unsaved declaration is named; missing evidence states the restricted-work consequence and whether this page can resolve it
- AI boundary: no prompt send
- Guardrails: routing remains fail-closed; declarations never become contracts; no unsupported evidence action is presented; all styling remains token-backed
- Evidence before merge: component tests for all claim states, style/theme checks, measured UX-fit manifest, and canonical live verification of the Codex provider detail page at desktop and narrow widths
- Captured in: this plan and `docs/ux-fit/2026-09-01-provider-trust-status-honesty.ux-fit.json`
