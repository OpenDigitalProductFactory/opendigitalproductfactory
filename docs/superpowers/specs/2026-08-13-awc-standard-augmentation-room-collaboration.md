# AWC Standard Candidate — Room-Collaboration Augmentation

**Status:** DRAFT (normative input for the AWC standard candidate) · **Date:** 2026-08-13 · **Scope:** platform (WWMD)
**Augments:** BI-AADFFCAF (Agentic Work Case standard candidate, EP-E1F1DB58) · **Source epic:** EP-WORKROOM-COMMS
**Design of record:** `docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md`

This is BI-A988A3C5: as the Work Room multi-agent collaboration substrate shipped (agents join/post/read, Coordinator role, outcome-scoped membership, on-demand invite, 360 engagement), fold what it proved into the **Agentic Work Case (AWC)** standard candidate as normative content, so the standard is grounded in a running reference implementation rather than a paper. Kept as a feeder to BI-AADFFCAF; the standard is externalized there.

## Normative additions for AWC (composition over A2A + MCP Tasks + CMMN + RACI)

### 1. Participant model — human + AI as symmetric principals
A work case's room admits **person | agent | system | external** principals under one identity, with a closed role set:
`accountable · coordinator · contributor · reviewer · observer` (RACI/DACI-derived; **coordinator ↔ DACI Driver**). Roles are additive per principal; one principal may hold several (e.g. accountable + coordinator). This is the layer A2A (one task/one agent/two roles) and MCP Tasks do not carry.

### 2. Coordinator — a first-class role
Exactly one active Coordinator per room keeps it on-task to its outcome (admit/curate members within the clearance ceiling, sequence turns, drive to verdict/close/escalate). Distinct from Accountable (owns the outcome). Maps to DACI **Driver**; realizes the orchestrator half of the orchestrator-worker pattern. Shipped: `room-coordinator.ts` (single-active-coordinator invariant).

### 3. Outcome-scoped membership — the focus mechanism
Admission is decided **per room**, scoped to that room's outcome and sensitivity ceiling; admission to one room grants nothing in another. Access is a lattice: `none < discover < content < action`, gated by admission + clearance ≥ ceiling; **presence never grants authority**. On-demand invite (`invite_room_participant`) is the governed membership writer; a Coordinator/action-holder calls a coworker or person in. Shipped: `room-agent-access.ts`, `room-policy.ts`.

### 4. Room id ⇄ A2A `contextId` — the interop hook
The room is the shared semantic space that groups a case's messages and tasks; propose **room caseKey (`sourceType:sourceId`) ⇄ A2A `contextId`** so cross-install rooms are addressable over A2A transport. A2A stays the sovereign wire (coordinate-by-proposal, apply-by-proposal); the room is the semantic layer. Consistent with the ratified `author-awc-composition` decision (DI-149854BD4A55).

### 5. Presence & engagement — observability, not authority
`principalType:"agent"` presence + a per-coworker 360 rollup (`get_coworker_room_engagement`: which active rooms, what role). Presence is an observability signal only — never an authority grant (§3).

## Boundary to the standard
AWC **composes, never reinvents**: A2A for task transport + AgentCard (adopt verbatim), MCP Tasks for async execution (loose — spec in flux), CMMN for case/stage/milestone/role semantics, RACI/DACI for the accountability vocabulary. The **new normative layer** AWC contributes is exactly §1–§5 above: the human+AI collaboration room with roles, outcome-scoped membership, and a governance/outcome envelope — the piece no surveyed standard owns. Externalization + upstream contribution (Linux Foundation agentic cluster) proceed under BI-AADFFCAF, sequenced after the conformance gate proves the internal contract.
