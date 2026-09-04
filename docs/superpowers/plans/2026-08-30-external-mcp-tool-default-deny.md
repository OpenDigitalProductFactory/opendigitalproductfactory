---
status: draft
---

# External MCP tool default-deny implementation plan

**Backlog:** BI-8B7B2FE9

**Epic:** EP-413F2602

**Design:** `docs/superpowers/specs/2026-08-30-security-authentication-hardening-successors-design.md` §11

**Decision records:** DI-56FB126CCFAA (epic), DI-F6D4C0132024 (policy shape)

**Workroom:** to be claimed by the implementation session

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Current evidence and delivery boundary

`getAvailableTools` grant-filters namespaced external tools only when `TOOL_TO_GRANTS` already contains their name; otherwise the tool is admitted. `getMcpServerTools` marks every discovered tool as side-effecting but provides no DPF-owned approval state. `executeMcpServerTool` checks server/tool availability and health, not the acting human/coworker policy that produced the listing.

The chosen **hybrid explicit-policy** approach keeps bundled mappings in `TOOL_TO_GRANTS`, projects dynamic approval onto the existing `McpServerTool` row, and sends both through the same evaluator. The MCP specification's tool annotations remain untrusted hints; transport authorization remains separate from DPF application authorization.

This plan is **atomic**. Schema/backfill, shared resolution, listing, invocation recheck, inventory, and operator explanation constitute one fail-closed boundary. Shipping only listing filtration leaves stale-call execution open; shipping only the execution check strands tools without a classifiable policy lifecycle.

## Phase 1 — red policy and bypass tests

**Deliverable:** failing tests cover unknown tool, no grant, quarantined tool, approved read tool, approved side-effecting tool, advise mode, disabled External Access, stale model-visible list, revocation, remote annotation lies, and server/tool rename.

**Files:** `apps/web/lib/mcp-tools-mcp-server.test.ts`, `apps/web/lib/tak/mcp-server-tools.test.ts`, `apps/web/lib/tak/agent-grants.test.ts`, execution-route tests.

**Requirements:** OBJ-MCP-AUTH-001 through OBJ-MCP-AUTH-003.

**Verification:** AC-MCP-AUTH-001 through AC-MCP-AUTH-006 demonstrate the current fail-open and missing invocation recheck before implementation.

## Phase 2 — explicit policy projection on the existing discovery record

**Deliverable:** extend `McpServerTool` with typed policy state and provenance: closed status (`quarantined`, `approved`, `denied`), closed effect posture and execution modes, grant key, policy version, `approvedByPrincipalId`, approval timestamp, and separately stored untrusted discovery hints.

**Files:** `packages/db/prisma/schema/integrations.prisma`, generated enum/type surface, forward-only migration, discovery code, focused tests.

**Dependencies:** Phase 1.

**Migration:** mapped bundled tools become approved only by deterministic lookup of the canonical namespaced mapping; all other existing and newly discovered tools become quarantined. `isEnabled` and server health never imply approval. Migration applies cleanly to populated registries and preserves disabled tools.

**Verification:** migration smoke across mapped, unmapped, disabled, renamed, and annotation-bearing tools; unknown enum/state is refused.

## Phase 3 — one effective discovered-tool policy resolver

**Deliverable:** a shared resolver accepts a discovered tool plus acting context and produces allowed/denied with stable reason codes. Bundled and persisted mappings both resolve through the existing grant implication/evaluation machinery.

**Files:** `apps/web/lib/tak/mcp-server-tools.ts`, `agent-grants.ts`, a narrow shared authority module if needed, focused tests.

**Dependencies:** Phase 2.

**Constraints:** no second grant vocabulary; persisted `grantKey` must resolve in the closed catalog; remote annotations never lower effect posture or widen modes.

**Verification:** same inputs produce the same verdict at listing and execution; policy-version and identity mismatch deny.

## Phase 4 — listing and invocation enforcement

**Deliverable:** `getAvailableTools` excludes every denied/quarantined/incomplete tool. The namespaced execution branch re-resolves current policy immediately before `executeMcpServerTool`, records allow/deny in `AuthorizationDecisionLog`, and never performs the remote call after denial.

**Files:** `apps/web/lib/mcp-tools.ts`, namespaced execution bridge, authorization logging helper, tests.

**Dependencies:** Phase 3.

**Verification:** stale-list and revoked-after-list tests prove listing cannot be replayed as authority; advise mode exposes no side effects; human capability and agent grant remain intersected.

## Phase 5 — inventory, operator diagnostics, and compatibility

**Deliverable:** inventory reports bundled-approved, explicitly approved, denied, and quarantined tools; operator copy explains that discovery/connectivity is not authority. A bounded alias policy preserves legitimate server/tool renames only when equivalent authorization is explicit.

**Files:** existing MCP service actions and capability inventory, existing admin/authority surface using shared primitives, documentation, tests.

**Dependencies:** Phases 2–4.

**UX:** compose from current platform identity/authority and report-kit primitives; no raw grant-map editor or bespoke browser permission page.

**Verification:** newly discovered tools appear quarantined, approval is auditable, denial/revocation takes effect without restart, and rename does not silently widen access.

## Phase 6 — governed completion

Run focused tests, enum/schema generation checks, migration smoke against populated data, typecheck, production build, `pnpm run pregate:preflight`, exact-tree `pnpm run pregate`, independent semantic review, and canonical-runtime functional verification. Prove one unmapped tool is absent/refused before any remote call and one explicitly mapped tool succeeds with a decision record. Update external-agent and operator documentation before closing BI-8B7B2FE9.

## Backlog coverage

- **Decision:** atomic.
- **Parent / implementation BI:** BI-8B7B2FE9.
- **Deliverable mapping:** `external-mcp-tool-default-deny` → BI-8B7B2FE9.
- **Dependencies:** existing `McpServerTool`, `TOOL_TO_GRANTS`, `AgentToolGrant`, `getAvailableTools`, and namespaced execution bridge.
- **Rationale:** policy state, listing, invocation, and inventory are one authorization boundary; splitting them creates either a bypass or an unusable quarantine.
- **Governed receipt:** pending independent spec approval and immutable plan commit; record through `record_plan_backlog_coverage` before implementation.

## Risks and rollback

| Risk | Control | Rollback |
|---|---|---|
| Existing coworkers lose an implicitly available external tool. | Pre-migration inventory; deterministically approve only known canonical mappings; surface every quarantine. | Explicitly classify the required tool under review; never restore blanket permissive fallback. |
| Remote server lies about read-only/destructive behavior. | Treat annotations as untrusted evidence; DPF effect policy is authoritative. | Quarantine/deny the server tool and revoke its policy. |
| Listing and execution policies drift. | One resolver and stable reason codes used at both boundaries. | Disable external tool execution until resolver parity is restored. |
| Rename strands a legitimate integration or bypasses old policy. | Namespaced identity plus bounded alias carrying identical explicit policy. | Deny both names, repair policy, then re-enable deliberately. |
| Migration authorizes an unknown tool. | Only exact canonical mapping can backfill approved; everything else quarantines. | Roll back migration transaction and correct classification logic before retry. |

## Success evidence

Success means every active discovered tool has an explicit policy state, no omission grants authority, listing and execution return the same effective decision, remote annotations cannot widen authority, and canonical-runtime evidence proves both refusal and deliberately authorized success.
