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

### P2c — siem grants + MCP tools (DONE)
- Grants in `agent-grants.ts`: `siem_read` + `GRANT_IMPLICATIONS` for `siem_investigate`/`siem_tune`/`incident_respond` → `siem_read` (one-way), and `TOOL_TO_GRANTS` entries for all 7 tools.
- `apps/web/lib/mcp-tools-siem.ts` (self-contained module, mirrors `mcp-tools-deliberation.ts`): `SIEM_TOOLS` + handlers, spread into `PLATFORM_TOOLS` + dispatched in `executeTool`. Tools: `query_security_events`, `query_detections`, `get_security_case` (reads); `open_security_case`, `update_security_case` (case management); `propose_detection_tuning`, `propose_response` (**propose-only** — recorded for human review, never executed; the response rail is P3). Writes are `coworkerArtifact`. Tool descriptions are provenance-free (hygiene guard green); results auto-clamped by `agentic-loop`.
- Tests: `siem-grants.test.ts` (grant coverage + implications), `mcp-tools-siem.test.ts` (handlers, mocked Prisma). Verified: web typecheck clean; 121 tests green across SIEM + hygiene + agent-grants guards.

**P2 complete** — the AI SOC coworkers exist (P2d) and can now act on security data (P2c) over cases (P2a), governed by the registered kernel dimensions (P2b). Response *execution* + the security principles/gate are P3.

### P2d — AGT-SOC-* roster (DONE)
- Seeded `AGT-SOC-TRIAGE` / `-INVESTIGATOR` / `-HUNTER` / `-IR-LEAD` in `packages/db/data/agent_registry.json` (`value_stream=operate`, `human_supervisor_id=HR-500`, the delegate/escalate graph below, `hitl_tier_default`, the siem grants). Per §7.2: triage drafts/closes-low-risk cases (hitl 2, review-before-close-critical); investigator drafts evidence/proposals only; hunter propose-only; IR-lead drafts RemediationProposals + owns the case, never executes on a customer estate (hitl 2). Authority graph: triage→investigator→IR-lead; hunter→IR-lead; IR-lead escalates to AGT-ORCH-000. Registry parses (67 agents), refs consistent, agent seed guards 7/7.
- The `siem_*` grants the roster references resolve to no tools until **P2c** defines them (harmless — the coworkers exist but can't act on security data until the tool surface lands).

## Governance contract (§6, §7.3)
The verdict (`SecurityCase.verdict`) is an evidence conclusion from investigation. The kernel governs the ACTION decisions (close vs escalate, propose vs keep investigating, auto-approve-reversible vs require-human, may-an-MSP-action-cross-a-federation-boundary) over the registered dimensions — never the analytical verdict. This is what keeps `principle_decide` non-degenerate.
