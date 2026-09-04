---
status: active
---

# Informed-Risk Clearance Override — Implementation Plan

**Design:** [docs/superpowers/specs/2026-09-01-informed-risk-clearance-override-design.md](../specs/2026-09-01-informed-risk-clearance-override-design.md)
**Umbrella backlog item:** BI-4512E7D2

## Backlog coverage

Decision: **decomposed** into two independently-shippable increments.

| Key | Deliverable | Backlog item | Depends on |
|-----|-------------|--------------|------------|
| spine | `ProviderClearanceOverride` record + migration; active-override query; `EndpointManifest.riskAcceptedClearances` populated by the loader; `endpointClearsSensitivity` honors it as a distinct path (never widens `sensitivityClearance`); ranking prefers genuinely-cleared; operator-only grant/revoke actions + audit; unit tests. | BI-BD88A142 | — |
| ui | Operator-only break-glass panel on `platform/ai/providers/[providerId]` with point-of-decision education, typed justification, acknowledgment, required expiry; active-override list + revoke; theme-aware, distinct from attestation; UX verified. | BI-FA412D44 | spine |

## Phasing

1. **Spine (BI-BD88A142)** — backend only, no UI. Ships behind no operator surface yet (grant/revoke actions exist but are not wired to a page), so it is inert on every install until an override is created. Proves the fence honors an active override and ignores expired/revoked, with the clearance array kept honest.
2. **UI (BI-FA412D44)** — the operator surface that creates/lists/revokes overrides, with the education. Depends on the spine's actions.

## Non-goals (v1)

- Multi-party approval workflow (single operator authority on a self-hosted install; `approverRef` reserved for later).
- Per-coworker (as opposed to per-provider × per-sensitivity, org-scoped) overrides.
- Operator-editable coworker `Agent.sensitivity` — a separate observed gap (seed-only today, no editor); filed independently if pursued.
