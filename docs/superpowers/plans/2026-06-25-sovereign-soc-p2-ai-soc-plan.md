# Sovereign SOC — P2 AI SOC: implementation plan

- **Date:** 2026-06-25
- **Spec:** [docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md](../specs/2026-06-24-sovereign-soc-siem-design.md) §4.4, §6, §7.2, §7.3
- **Epic:** EP-SOVEREIGN-SOC — **BI-5A9A5E03**
- **Builds on:** P0 (`96006b31e`), P1 (`e7689985d`, `cdfd027f7`)

## Goal

The differentiator: AI Coworkers perform the SOC analyst labor — triage, investigate, hunt, incident-command — over `SecurityCase`s, governed by the kernel (verdict = evidence; action = kernel-gated).

## Sub-phases (verifiable sub-commits)

### P2a — SecurityCase + grouping + retention (DONE, this commit)
- `SecurityCase` model (§6.4) + migration `20260625120000_add_security_case`. Composes `ComplianceIncident` via `complianceIncidentId` for the regulated path (does not duplicate `regulatoryNotifiable`/deadlines). `verdict` is an evidence conclusion, not a kernel vote.
- `apps/web/lib/security/case-grouping.ts` — pure `deriveGroupingKey` (stable scope|entity|family) + `groupDetectionsIntoCases` (max severity, spanning window, deterministic, idempotent caseKey). Tests: `case-grouping.test.ts`.
- Retention: `securityCase` → `RETAINED_DATASETS` (regulated incident record, never auto-purged) — distinct from the `security-audit` purge window for `SecurityEvent`/`Detection`. Retention guard still green.

### P2b — kernel dimensions registered (DONE); principles → P3
- Registered in `packages/db/src/wiki-taxonomy.ts`: `reversibility`, `evidence_confidence`, `customer_consent_state` (benefit) + `business_disruption` (cost — also added to `PRINCIPLE_COST_DIMENSIONS`). `blast_radius` (existing cost dim) reused for estate reach. Verified: db typecheck + the full `seed-wiki-kernel`/`wiki-taxonomy` guard suite (86/86) stay green with the registry growth.
- **Security principle pages + the response-autonomy gate move to P3.** They are consumed by the *response* decision (close vs escalate vs auto-execute vs propose), which is P3's surface — authoring the founder-kernel principle `.md` (doctrine, `authoredBy: mark-bodman`) together with `scoreSecurityResponseAction` (modeled on `decision/ui-surface-features.ts`) keeps the doctrine and the code that uses it in one reviewable change. Registering the dims now means those principles validate the moment they're authored (`extractPrinciplePayload` throws on unregistered keys).

### P2c — siem grants + MCP tools
- Grants `siem_read` / `siem_investigate` / `siem_tune` / `incident_respond` in `agent-grants.ts` (+ `TOOL_TO_GRANTS`).
- Tools (writes are `coworkerArtifact` draft/proposal, never direct estate mutation): `query_security_events`, `query_detections`, `get_security_case`, `open_security_case`, `update_security_case`, `propose_response`. Handlers in `mcp-tools.ts`.

### P2d — AGT-SOC-* roster
- Seed `AGT-SOC-TRIAGE` / `-INVESTIGATOR` / `-HUNTER` / `-IR-LEAD` in `agent_registry.json` (`value_stream=operate`, `sensitivity=confidential`, `delegatesTo`/`escalatesTo` graph, `hitlTierDefault`, the siem grants). Per §7.2: triage drafts cases only; IR-lead proposes response, never executes on a customer estate.

## Governance contract (§6, §7.3)
The verdict (`SecurityCase.verdict`) is an evidence conclusion from investigation. The kernel governs the ACTION decisions (close vs escalate, propose vs keep investigating, auto-approve-reversible vs require-human, may-an-MSP-action-cross-a-federation-boundary) over the registered dimensions — never the analytical verdict. This is what keeps `principle_decide` non-degenerate.
