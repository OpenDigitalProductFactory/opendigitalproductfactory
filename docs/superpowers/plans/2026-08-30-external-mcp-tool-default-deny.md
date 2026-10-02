---
status: draft
---

# External MCP tool default-deny implementation plan

**Backlog:** BI-8B7B2FE9

**Epic:** EP-413F2602

**Design:** `docs/superpowers/specs/2026-08-30-security-authentication-hardening-successors-design.md` §11

**Decision records:** DI-56FB126CCFAA (epic), DI-F6D4C0132024 (policy shape)

**Workroom:** WC-B883D1D9 (branch `feat/mcp-tool-default-deny`)

**Absorbed scope:** BI-49969E39 (description/schema pinning) folds into this plan as the `approvedContentDigest` part of Phase 2 and AC-MCP-AUTH-007.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Current evidence and delivery boundary

`getAvailableTools` grant-filters namespaced external tools only when `TOOL_TO_GRANTS` already contains their name; otherwise the tool is admitted. `getMcpServerTools` marks every discovered tool as side-effecting but provides no DPF-owned approval state. `executeMcpServerTool` checks server/tool availability and health, not the acting human/coworker policy that produced the listing.

The chosen **hybrid explicit-policy** approach keeps bundled mappings in `TOOL_TO_GRANTS`, projects dynamic approval onto the existing `McpServerTool` row, and sends both through the same evaluator. The MCP specification's tool annotations remain untrusted hints; transport authorization remains separate from DPF application authorization.

**Second defect, same boundary (absorbed from BI-49969E39).** `discoverMcpServerTools` overwrites `description` and `inputSchema` verbatim on every rediscovery (activate, refresh, health check), and `getMcpServerTools` hands that text to the model. A server can change what the model reads after a tool was reviewed — the MCP tool-poisoning / "rug pull" pattern (Invariant Labs, 2025). Approval therefore binds to a digest of the exact model-visible text, not to the tool name.

### Reproduction on main (research evidence)

Named ref: `origin/main` `9b28dbf635bf76b2405e632304d2bbda2b8bd99d`.

- `apps/web/lib/mcp-tools.ts:326` — `grantMap[tool.name] ? isToolAllowedByGrants(tool.name, agentGrants) : true`: an unmapped discovered tool is appended to the coworker surface whenever External Access is on.
- `apps/web/lib/tak/mcp-server-tools.ts:77` — the rediscovery `update` rewrites `description` / `inputSchema`; nothing records what was approved.
- `apps/web/lib/mcp-tools.ts:583` — `executeTool`'s default branch calls `executeMcpServerTool` for any namespaced name with no acting-context or policy check.
- Ruled out by running: `governedExecuteTool` already refuses namespaced names as `unknown_tool` (its `findTool` searches `PLATFORM_TOOLS` only), so the coworker loop could not *call* a listed discovered tool — but the tool's text still reached the model, and direct `executeTool` callers still reached the remote call. The existing EP-BROWSER-DRIVE test passes on main while asserting the unmapped tool *is* listed: the gap is the deliberate legacy fallback, not a regression.
- Red proof before implementation: `apps/web/lib/mcp-tools-discovered-policy.test.ts` 13/17 fail; the content-pinning block in `apps/web/lib/tak/mcp-server-tools.test.ts` 4/6 fail.

This plan is **atomic**. Schema/backfill, shared resolution, listing, invocation recheck, inventory, and operator explanation constitute one fail-closed boundary. Shipping only listing filtration leaves stale-call execution open; shipping only the execution check strands tools without a classifiable policy lifecycle.

## Phase 1 — red policy and bypass tests

**Deliverable:** failing tests cover unknown tool, no grant, quarantined tool, approved read tool, approved side-effecting tool, advise mode, disabled External Access, stale model-visible list, revocation, remote annotation lies, server/tool rename, and **description or inputSchema change after approval** (rediscovery quarantines; the model never sees the changed text; hidden Unicode is stripped from what the model reads).

**Files:** `apps/web/lib/mcp-tools-discovered-policy.test.ts`, `apps/web/lib/mcp-tools-mcp-server.test.ts`, `apps/web/lib/tak/mcp-server-tools.test.ts`, `apps/web/lib/tak/mcp-tool-policy.test.ts`, governed-execution tests.

**Requirements:** OBJ-MCP-AUTH-001 through OBJ-MCP-AUTH-003.

**Verification:** AC-MCP-AUTH-001 through AC-MCP-AUTH-007 demonstrate the current fail-open and missing invocation recheck before implementation.

## Phase 2 — explicit policy projection on the existing discovery record

**Deliverable:** extend `McpServerTool` with typed policy state and provenance: closed status (`quarantined`, `approved`, `denied`), closed effect posture and execution modes, grant key, policy version, `approvedByPrincipalId`, approval timestamp, and separately stored untrusted discovery hints.

**Content pinning (`approvedContentDigest`, absorbed from BI-49969E39):** approval also stores the approved identity (`<serverSlug>__<toolName>`), a snapshot of the approved `description` and `inputSchema`, and `approvedContentDigest` — sha256 over the canonical JSON of that text *after* hidden-Unicode sanitizing with `sanitizeUntrustedValue` (`packages/validators/src/untrusted-text.ts`), i.e. exactly what a model would read. Key order is not a change. Discovery records `discoveredContentDigest` for the latest text. A rediscovery whose digest differs from the approved digest returns the tool to `quarantined` and leaves the approved snapshot untouched, so the model sees nothing new until an operator re-approves, and the operator sees the approved and newly reported text side by side. The model-visible text is always the sanitized approved snapshot; the resolver re-hashes both the current row and the snapshot on every listing and call, so a row edited outside discovery also fails closed. Bundled tools (whose text ships with the release) are re-covered by the bundled mapping on rediscovery rather than quarantined; they are code-owned, not operator-approved.

**Files:** `packages/db/prisma/schema/integrations.prisma`, generated enum/type surface, forward-only migration, discovery code, focused tests.

**Dependencies:** Phase 1.

**Migration:** mapped bundled tools become approved only by deterministic lookup of the canonical namespaced mapping; all other existing and newly discovered tools become quarantined. `isEnabled` and server health never imply approval. Migration applies cleanly to populated registries and preserves disabled tools.

**Verification:** migration smoke across mapped, unmapped, disabled, renamed, and annotation-bearing tools; unknown enum/state is refused; rediscovery with changed description or schema quarantines and keeps the approved snapshot; unchanged text (including reordered schema keys) keeps approval.

## Phase 3 — one effective discovered-tool policy resolver

**Deliverable:** a shared resolver accepts a discovered tool plus acting context and produces allowed/denied with stable reason codes. Bundled and persisted mappings both resolve through the existing grant implication/evaluation machinery.

**Files:** `apps/web/lib/tak/mcp-server-tools.ts`, `agent-grants.ts`, a narrow shared authority module if needed, focused tests.

**Dependencies:** Phase 2.

**Constraints:** no second grant vocabulary; persisted `grantKey` must resolve in the closed catalog; remote annotations never lower effect posture or widen modes.

**Verification:** same inputs produce the same verdict at listing and execution; policy-version, identity and content-digest mismatch deny.

## Phase 4 — listing and invocation enforcement

**Deliverable:** `getAvailableTools` excludes every denied/quarantined/incomplete tool. The namespaced execution branch re-resolves current policy immediately before `executeMcpServerTool`, records allow/deny in `AuthorizationDecisionLog`, and never performs the remote call after denial.

**Files:** `apps/web/lib/mcp-tools.ts`, namespaced execution bridge, authorization logging helper, tests.

**Dependencies:** Phase 3.

**Execution path detail:** the governed executor resolves a namespaced discovered tool (coworker `agentic-loop` source only) through the resolver, intersects the policy grant with the coworker's grants, the room's authorized surface and server-resolved External Access, and hands the resolved definition to the existing authority gate, which writes the `AuthorizationDecisionLog` row. The approved content digest travels in the execution context; `executeMcpServerTool` re-resolves the row immediately before `tools/call` and refuses on any mismatch. A namespaced call that did not come through the governed executor is refused. The bundled browser orchestrator (`drive_browser_task`, already grant-gated) reaches only bundled tools.

**Verification:** stale-list and revoked-after-list tests prove listing cannot be replayed as authority; advise mode exposes no side effects; human capability and agent grant remain intersected.

## Phase 5 — inventory, operator diagnostics, and compatibility

**Deliverable:** inventory reports bundled-approved, explicitly approved, denied, and quarantined tools; operator copy explains that discovery/connectivity is not authority. A bounded alias policy preserves legitimate server/tool renames only when equivalent authorization is explicit.

**Files:** existing MCP service actions and capability inventory, existing admin/authority surface using shared primitives, documentation, tests.

**Dependencies:** Phases 2–4.

**UX:** compose from current platform identity/authority and report-kit primitives; no raw grant-map editor or bespoke browser permission page.

**Verification:** newly discovered tools appear quarantined, approval is auditable, denial/revocation takes effect without restart, and rename does not silently widen access.

## Phase 6 — governed completion

Run focused tests, enum/schema generation checks, migration smoke against populated data, typecheck, production build, `pnpm run pregate:preflight`, exact-tree `pnpm run pregate`, independent semantic review, and canonical-runtime functional verification. Prove one unmapped tool is absent/refused before any remote call and one explicitly mapped tool succeeds with a decision record. Update external-agent and operator documentation before closing BI-8B7B2FE9.

## Acceptance criteria (quoted from BI-8B7B2FE9)

- An unmapped dynamically discovered MCP tool is absent from an AI coworker's available tool surface, including when External Access is enabled.
- A mapped tool is visible only when the acting human capability, agent grant, execution mode, and external-access requirements all pass.
- Execution rechecks the same effective policy so a stale/discovered tool list cannot bypass authorization.
- Side-effect and execution metadata come from a DPF-owned policy overlay; remote annotations are treated only as untrusted hints.
- Inventory reports every active discovered tool as mapped, deliberately denied, or quarantined, without silently authorizing an unknown state.
- **A rediscovery that changes an approved tool's description or inputSchema quarantines it; the model never sees the changed text before re-approval; the operator sees the diff.**
- Tests cover no-grant, unknown-tool, read-only, side-effecting, advise-mode, stale-list, server/tool rename, **and description/schema change after approval** cases.
- Canonical-runtime evidence proves an unmapped tool is refused and a correctly mapped tool succeeds.

## Traceability

- **Requirements:** OBJ-MCP-AUTH-001, OBJ-MCP-AUTH-002, OBJ-MCP-AUTH-003.
- **Contracts:** CONTRACT-MCP-POLICY-PROJECTION (`McpServerTool` policy columns + `approvedContentDigest`), CONTRACT-MCP-POLICY-RESOLVER (`resolveDiscoveredToolPolicy` / `evaluateDiscoveredToolAccess`), CONTRACT-MCP-POLICY-ENFORCEMENT (`getAvailableTools`, `governedExecuteTool`, `executeMcpServerTool`).
- **Flows:** FLOW-MCP-DISCOVER-QUARANTINE-APPROVE (discovery → quarantine → operator approval → listing → governed call → remote call), FLOW-MCP-REDISCOVER-CHANGED (rediscovery with changed text → quarantine → side-by-side review → re-approval).
- **Verification:** AC-MCP-AUTH-001 through AC-MCP-AUTH-007 (spec §11 acceptance contract).

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
| Server rewrites an approved tool's description or schema (rug pull). | Digest of the sanitized model-visible text bound at approval; rediscovery mismatch quarantines; resolver re-hashes at listing and call. | Deny the tool; re-approve only after reviewing the side-by-side text. |
| Migration authorizes an unknown tool. | Only exact canonical mapping can backfill approved; everything else quarantines. | Roll back migration transaction and correct classification logic before retry. |

## Success evidence

Success means every active discovered tool has an explicit policy state, no omission grants authority, no rediscovery changes approved model-visible text, listing and execution return the same effective decision, remote annotations cannot widen authority, and canonical-runtime evidence proves both refusal and deliberately authorized success.
