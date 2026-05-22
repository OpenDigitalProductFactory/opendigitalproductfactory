# TAK / GAID Protocol Profiles and Supervisor Control Surface

| Field | Value |
|-------|-------|
| **Status** | Approved for slice 1 execution |
| **Created** | 2026-05-21 |
| **Backlog Epic** | `EP-TAK-3F9A21` - TAK/GAID Refresh: Auth, Agent Identity, and Governed Memory Alignment |
| **Primary Backlog Items** | `BI-GAID-8D72B4`, `BI-OBS-4B63F2` |
| **Related Epic** | `EP-A2A` |
| **Related Active Work** | `EP-BUILD-9DB5B0` - Capability data must be calibrated before it can route tool work |
| **Related Standards** | [`TAK`](../../architecture/trusted-ai-kernel.md), [`GAID`](../../architecture/GAID.md), [`A2A`](2026-04-23-a2a-aligned-coworker-runtime-design.md) |

## Purpose

The transcript review identified a useful operating model for agent platforms:

1. What tools and data can the agent use?
2. Which other agents or specialists can it work with?
3. How does the human stay in control while the agent is working?

DPF already has strong foundations for all three questions, but they are still distributed across MCP tool definitions, local grants, AIDoc projection, TaskRun records, proposal records, and audit logs. This spec turns those pieces into a coherent TAK/GAID execution profile: protocols carry work, while TAK governs runtime authority and GAID preserves identity and receipts.

This is not a new protocol program. It is an integration pass that makes DPF's existing standards story more operational, more visible, and easier to prove.

## Current-State Anchors

The following runtime pieces already exist on `main` and should be reused:

- External MCP JSON-RPC endpoint at `apps/web/app/api/mcp/v1/route.ts`.
- Scoped MCP token model in `apps/web/lib/auth/mcp-api-token.ts` and `McpApiToken`.
- Default-deny tool-grant map in `apps/web/lib/tak/agent-grants.ts`.
- Governed tool execution and selected receipt minting in `apps/web/lib/mcp-governed-execute.ts`.
- Private GAID aliasing in `apps/web/lib/identity/principal-linking.ts`.
- Internal AIDoc projection in `apps/web/lib/identity/aidoc-resolver.ts`.
- Agent identity snapshots in `apps/web/lib/identity/agent-identity-snapshot.ts`.
- A2A-shaped `TaskRun`, `TaskMessage`, and `TaskArtifact` models in `packages/db/prisma/schema.prisma`.

The open gap is the connective tissue: a single projection that says what a coworker is, what it exposes, what authority posture applies, what GAID/AIDoc data identifies it, and what a supervisor can inspect while work is active.

## Protocol Profile Decision

DPF should treat public protocols as carrier profiles, not sources of authority.

| Layer | DPF Use | TAK Role | GAID Role |
|-------|---------|----------|-----------|
| MCP | Tool and data access | Enforce tool exposure, grants, scope, execution mode, approval, and audit | Preserve acting GAID, AIDoc reference, trace context, and tool receipt |
| A2A | Agent discovery, delegation, task/artifact exchange | Enforce delegation narrowing, task state, approval interruption, and supervisor visibility | Bind Agent Card, task events, artifacts, and delegate receipts to canonical GAID |
| AG-UI-style profile | Human control for long-running work | Surface live state, approvals, edits, pauses, retries, cancel, escalation, and evidence | Show acting GAID, assurance summary, and proposed/final receipt references |
| A2UI | Declarative generated UI from agents | Restrict to approved component catalogs and theme-aware rendering | Preserve who generated the UI and what evidence/receipt backs it |
| AP2 | Bounded payment mandate pattern | Treat spend authorization as a high-risk approval and budget gate | Bind mandate, user authority, agent identity, and payment receipt |
| x402 | Programmatic resource payment | Defer until budget gates, mandates, and receipts are mature | Treat every resource payment as receipt-backed delegated commerce |

The first implementation slice covers MCP/A2A/AG-UI-style foundations by creating the internal Agent Card projection and a runtime authority snapshot. A2UI/AP2/x402 remain standards-profile documentation only for now.

## Target Architecture

### Internal Agent Card

DPF will add an internal `AgentCard` projection service. It is an internal canonical card, not a public A2A endpoint and not an enforcement source.

The card projects from:

- `Agent`
- `AgentExecutionConfig`
- `AgentGovernanceProfile`
- `AgentToolGrant`
- `AgentSkillAssignment`
- `PrincipalAlias`
- internal `AIDoc`

The card must include:

- agent identity and lifecycle state
- supported internal interfaces
- skills and capabilities
- tool grants and derived exposed tools
- security schemes and requirements
- TAK runtime posture
- GAID/AIDoc references
- runtime authority snapshot for supervisor UI consumers

### Runtime Authority Snapshot

The first slice introduces a read-model, not a new policy engine. The snapshot should assemble facts that already exist:

- principal kind and GAID if supplied
- agent GAID and AIDoc validation state
- route context
- tool grants
- exposed tool count
- portable authorization classes
- HITL tier and policy
- sensitivity
- operating profile fingerprint
- current limitations and approval posture

Later slices can make this snapshot the input/output contract for real execution decisions. Slice 1 only makes the state coherent and testable.

### Supervisor Control Surface

The supervisor UI should eventually answer:

- Who is acting?
- Under whose authority?
- What can this agent see and do on this route?
- What work is running now?
- What is waiting for approval, edit, or escalation?
- What receipts and evidence already exist?
- Which memories or facts are current, stale, withheld, or pending revalidation?

The correct home is the existing authority/audit workspace, not a new top-level product area.

## Scope

In scope for this spec:

- Protocol profile matrix in TAK/GAID terms.
- Internal Agent Card projection.
- Runtime authority snapshot read model.
- Supervisor-facing data contract for future UI.
- Conformance-doc updates after slice 1.

Out of scope for this first execution:

- Public A2A endpoint publication.
- Public GAID verifier endpoints.
- Cryptographic receipt signing.
- Agentic payments or x402 resource spending.
- Full AG-UI protocol implementation.
- Build Studio capability-calibration work already owned by `EP-BUILD-9DB5B0`.

## Slice 1 Acceptance Criteria

1. `apps/web/lib/tak/agent-card-types.ts` defines an internal card shape with TAK and GAID extensions.
2. `apps/web/lib/tak/agent-card-service.ts` can project one agent card from DB-backed agent and alias state.
3. The card includes a supervisor-ready authority snapshot.
4. The service consumes existing AIDoc projection instead of duplicating GAID mapping logic.
5. Tests prove:
   - the card includes identity, skills, interfaces, security requirements, TAK posture, and GAID metadata;
   - missing GAID/AIDoc data degrades explicitly rather than fabricating identity;
   - the authority snapshot exposes grant, tool-surface, authorization-class, HITL, route, and sensitivity facts.
6. `apps/web/lib/tak/index.ts` exports the new card service and types.
7. The conformance doc is updated to mark internal Agent Card projection as implemented or partially implemented with evidence paths.

## Follow-On Slices

1. Supervisor UI panel in the authority workspace.
2. Agent Card projection into private A2A-compatible JSON for internal consumers.
3. Receipt-chain expansion across proposals, TaskRuns, and delegation.
4. Memory-health and freshness widgets for the supervisor view.
5. TAK/GAID conformance harness and evidence capture.
