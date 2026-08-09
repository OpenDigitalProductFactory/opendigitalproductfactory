# MCP `2025-11-25` and A2A Feature Adoption — Assessment & Phased Plan

> **Standards correction (2026-08-08):** This assessment is retained as the historical basis for the 2025-11-25 adoption bundle. Its claim that DPF was current is no longer applicable: the [final MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/) is stateless and moves long-running work to the official Tasks extension. The current design is [MCP 2026-07-28 stateless core and Tasks convergence](2026-08-06-mcp-standard-tasks-lifecycle-convergence-design.md), governed by umbrella `BI-AF9F9729` and decision `DI-1C305D329ECE`.

| Field | Value |
|-------|-------|
| **Epic** | Platform Infrastructure / EP-A2A / EP-COWORKER-INTERACTIVITY |
| **Status** | Historical assessment — superseded for current MCP conformance |
| **Date** | 2026-08-06 |
| **Author** | Claude Code for Mark Bodman |
| **Scope (read)** | `apps/web/app/api/mcp/v1/route.ts`, `apps/web/lib/mcp-tools.ts`, `apps/web/lib/mcp-task-submit.ts`, `services/adp/src/server.ts`, `docs/Reference/mcp/spec/` (snapshot `2025-11-25`) |
| **Grounds in (do not duplicate)** | [platform MCP tool server](2026-04-11-platform-mcp-tool-server-design.md) · [governed MCP backlog surface](2026-04-25-governed-mcp-backlog-surface-design.md) · [TAK/GAID auth identity refresh](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md) · [A2A collaboration contract inventory](2026-08-04-a2a-coworker-collaboration-contract-inventory.md) · [A1 specialist-plane A2A convergence](../plans/2026-08-01-a1-specialist-plane-a2a-convergence.md) · [A2A collaboration health scan](../plans/2026-08-04-a2a-collaboration-health-scan.md) |
| **Blast radius** | HIGH — the MCP transport is the coordination plane (AGENTS.md §12). Per the A1 precedent this is a plan, not a same-session patch. |

---

## 0. Framing — correct the premise before we act

The request was "MCP 2 is out; upgrade our use of it and any other standard like A2A, and take advantage of new features." Verification of the live substrate changes the shape of that work:

- **Historical finding at the time:** the implementation already selected the then-targeted `2025-11-25` version. `apps/web/app/api/mcp/v1/route.ts:47` declares `SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-03-26", "2024-11-05"]` and negotiates down per client (`:392-393`), with a test asserting `2025-11-25` round-trips (`route.test.ts:548-556`). This must not be read as current conformance after the final 2026-07-28 release.
- **Several `2025-11-25`-aligned features are already implemented:** `structuredContent` on tool results (`route.ts:507,552-554`), tool annotation hints — `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` (`:353-367`), and HTTP **403** on invalid `Origin` (`:567-568`), which is exactly minor-change #3 of the revision.
- **So the real work is feature *adoption*, not a version bump** — which of the `2025-11-25` capabilities DPF has not yet taken advantage of, plus the one A2A gap the existing inventory already flagged (signed agent-card export). This document is that gap analysis and a prioritized, one-concern-per-PR plan.

The MCP transport is hand-rolled JSON-RPC (no MCP SDK is imported at runtime; `@modelcontextprotocol/sdk` is a declared dep in `services/adp` but unused in source). Every adoption below is therefore a deliberate, bounded edit to our own transport — not an SDK upgrade.

---

## 1. Research & Benchmarking (AGENTS.md §7)

### 1.1 The `2025-11-25` delta (from `docs/Reference/mcp/spec/changelog.mdx`)

Major: OIDC auth-server discovery; **icons** metadata for tools/resources/prompts (SEP-973); incremental scope consent via `WWW-Authenticate` (SEP-835); tool-naming guidance (SEP-986); richer elicitation — titled/untitled, single/multi-select enums (SEP-1330) and URL-mode elicitation (SEP-1036); tool-calling in **sampling** (SEP-1577); OAuth Client-ID Metadata Documents (SEP-991); experimental **Tasks** — durable requests with polling/deferred retrieval (SEP-1686).

Minor of note: `description` on `Implementation` (serverInfo); **403** on invalid Origin (done); input-validation errors returned as **Tool Execution Errors** for model self-correction (SEP-1303); SSE polling/resumption (SEP-1699); RFC 9728 PRM auth discovery; **JSON Schema 2020-12** as the default dialect (SEP-1613).

### 1.2 Benchmark against leaders

- **Official MCP TypeScript SDK (`@modelcontextprotocol/sdk` `1.29.x`, already in the lockfile).** The reference server auto-emits the `MCP-Protocol-Version` handshake, `outputSchema`/`title`/`icons` on `Tool`, and the standard `tasks/*` lifecycle. DPF hand-rolls the transport (a deliberate choice from the [platform MCP spec](2026-04-11-platform-mcp-tool-server-design.md) — one governed pipeline through `governedExecuteTool`), so we adopt the *wire behaviors* selectively rather than swapping in the SDK. **Reject** a wholesale SDK migration now (it would fork the governed-execute pipeline and re-open the frozen tool-name contract); **adopt** the specific wire fields the SDK would emit.
- **A2A (Agent2Agent, AAIF / Linux Foundation), agent-card + tasks/artifacts.** Already benchmarked in the [A2A inventory §1](2026-08-04-a2a-coworker-collaboration-contract-inventory.md): DPF adopts A2A **vocabulary as a profile** over `DelegationChain`/`PhaseHandoff`/`TaskRun`, and **rejects** reimplementing the A2A wire as the internal bus. This document does not reopen that verdict; it targets only the one **external-interop** gap the inventory left open (§5, P3).
- **LangGraph / AutoGen handoff patterns.** Patterns-only adoption per the inventory — not relevant to the transport slices here.

### 1.3 Adopt / reject for this program

| `2025-11-25` capability | DPF today | Verdict | Why |
|---|---|---|---|
| Protocol version `2025-11-25` negotiation | Done (`route.ts:47`) | **Keep** | Already conformant. |
| `structuredContent` on results | Done (`:552-554`) | **Keep** | Already emitted; declare `outputSchema` to complete it (Slice 2). |
| Tool annotation hints | Done (`:353-367`) | **Keep** | Conformant. |
| 403 on invalid Origin | Done (`:567`) | **Keep** | Matches minor #3. |
| **`MCP-Protocol-Version` request header** validation | **Absent** — POST never reads it | **Adopt (Slice 1)** | Spec: clients MUST send it on non-`initialize` HTTP requests; server defaults when absent, 400 on unsupported. Cheap, backward-compatible. |
| `Implementation.description` on serverInfo | Absent (`:399-402`) | **Adopt (Slice 1)** | One-line, improves client init UX; registry-aligned. |
| Top-level `Tool.title` | Only in `annotations.title` | **Adopt (Slice 2)** | `2025-11-25` carries `title` at top level; keep annotations.title for back-compat. |
| Tool/resource **icons** (SEP-973) | Absent | **Adopt (Slice 2)** | Cheap, optional field; better client rendering. Tools only (we expose no resources). |
| Tool **`outputSchema`** (JSON Schema 2020-12) | Absent; we emit structuredContent untyped | **Adopt (Slice 2)** | Lets clients validate structured output; SEP-1613 sets the dialect default. |
| Input-validation → Tool Execution Error (SEP-1303) | Partially (unknown-tool/scope → `isError` content) | **Adopt-as-audit (Slice 3)** | Ensure `governedExecuteTool` schema failures return `isError` content, not JSON-RPC protocol errors, so models self-correct. |
| Tool-naming guidance (SEP-986) | Names are a frozen API contract | **Adopt-as-audit only** | The [platform MCP spec](2026-04-11-platform-mcp-tool-server-design.md) forbids renaming existing `name` values (CLI clients cache them). Apply guidance to *new* tools; lint only. |
| Experimental **Tasks** (SEP-1686) | Bespoke non-standard `tasks/submit` (`route.ts:664`) | **Adopt (Slice 4 — own plan)** | Biggest opportunity: align long-running remote-coworker submission with the standard task lifecycle (`tasks` capability + `tasks/list\|get\|result\|cancel`) so external clients poll durable results. Design-heavy, high blast radius → its own plan, not this PR. |
| **Elicitation** (SEP-1330/1036) | Absent | **Defer (opportunity)** | Enables interactive confirm/select + URL-mode approval flows; needs client support + HITL design. Note for EP-COWORKER-INTERACTIVITY; not scheduled here. |
| Tool-calling in **sampling** (SEP-1577) | N/A | **Reject (scope)** | DPF is an MCP *server*; it does not host sampling. Revisit only if a DPF surface becomes an MCP client host. |
| SSE polling/resumption (SEP-1699) | No SSE (`GET`→405, `:696`) | **Defer** | Single-POST is sufficient for tool calls; streaming is a separate design if long-running tools land. |
| OAuth 2.1 / OIDC / CIMD / incremental consent | PAT pattern, no OAuth (intentional) | **Defer — tracked elsewhere** | Owned by [TAK/GAID auth refresh](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md) §authorization. Do not re-spec here. |

---

## 2. Conformance defects found during verification

1. **No `MCP-Protocol-Version` request-header handling** — `POST` (`route.ts:558`) authenticates and dispatches without ever reading the header the spec requires on post-`initialize` requests. Clients that send an unsupported value get no signal; clients that omit it get no defaulting. → Slice 1.
2. **ADP service has no `initialize` handler.** `services/adp/src/server.ts` dispatches only `tools/list` (`:123`) and `tools/call` (`:129`); unknown methods → `-32601` (`:160`). A conformant MCP client cannot complete the handshake against it. → Slice 5 (scoped, low priority; the ADP server is a narrow integration surface).
3. **`serverInfo` lacks `description`** (`:399-402`) and tools carry no top-level `title`/`icons`/`outputSchema`. → Slices 1–2.

None of these break current clients (Claude Code / Codex negotiate fine today); they are conformance and UX-completeness gaps against the revision DPF already claims to speak.

---

## 3. A2A — the one open external-interop gap

The [A2A inventory](2026-08-04-a2a-coworker-collaboration-contract-inventory.md) is authoritative and current: DPF projects coworker coordination onto A2A **edges** on `/platform/ai/operations-map`, and the verdict is *adopt-vocabulary-as-profile, reject-wire-reimplementation*. That stands. The inventory's §5 leaves exactly one interop gap unaddressed (P3):

> **External A2A interop — no signed agent-card export/import aligned to A2A v1.2 for outside peers.**

**Adoption (Slice 6):** a **read-only, governed export** of DPF coworker `Agent` rows as A2A **Agent Cards** at a well-known path (e.g. `/.well-known/agent-card.json` and a per-agent variant), projecting existing identity (name, description, skills via `AgentSkillAssignment`, tool grants as capabilities) into the A2A card schema — signed, no new bus, no inbound task execution. This realizes the inventory's P3 "GAID agent-card projection for optional external A2A peers" as a projection, exactly as the doctrine requires, and does **not** reopen the internal-bus verdict (§7 non-goals of the inventory).

Import / inbound A2A task execution remains **out of scope** — it would fork runtime authority (inventory §1 "reject").

---

## 4. Phased plan — one concern per PR (AGENTS.md §3)

Each slice is independently shippable and independently verifiable. Slices 1–3 touch only the transport's presentation/negotiation layer (not `governedExecuteTool`), so blast radius is contained.

- **Slice 1 — protocol negotiation completeness (transport).** Read/validate the `MCP-Protocol-Version` header on non-`initialize` requests (default when absent per spec, `400` on an unsupported explicit value); add `description` to `serverInfo`. *Verify:* extend `route.test.ts` (present/absent/unsupported header; serverInfo shape).
- **Slice 2 — tool metadata enrichment (`mcp-tools.ts` + `annotateTool`).** Add optional `title`, `icons`, and `outputSchema` to `ToolDefinition` (`mcp-tools.ts:98`) and surface them in `tools/list` via `annotateTool` (`route.ts:353`); backfill `outputSchema` for the highest-traffic tools first. *Verify:* unit test that emitted tools carry the new fields and that JSON Schema is 2020-12; existing grant/tier filtering unchanged.
- **Slice 3 — input-validation error audit (`governedExecuteTool` boundary).** Confirm schema-validation failures return `isError` content (self-correctable), not JSON-RPC protocol errors; add a naming-guidance lint for *new* tools (SEP-986) that exempts the frozen existing names. *Verify:* unit tests over the error path.
- **Slice 4 — standard MCP Tasks alignment (own plan, high blast radius).** Design and land the `tasks` capability + `tasks/list|get|result|cancel` mapped onto the remote-coworker `TaskRun` substrate, converging the bespoke `tasks/submit`. **Requires its own plan and kernel-routed decisions** (durable-result retention, cancellation authority, back-compat for the current `tasks/submit` callers) — do not fold into Slices 1–3.
- **Slice 5 — ADP service `initialize` handler.** Add a conformant handshake to `services/adp/src/server.ts`. Low priority, isolated.
- **Slice 6 — A2A agent-card export (EP-A2A / GAID).** Read-only signed Agent Card projection per §3. Coordinate with the inventory owner; realizes P3.

**Not scheduled (opportunities logged):** elicitation (interactive/URL-mode approval flows), SSE streaming for long-running tools, OAuth/OIDC (owned by the auth refresh spec).

## 5. Verification bar (per slice)

Functional, not structural. Every code slice must pass the AGENTS.md §4 build gate on the canonical runtime — `pnpm --filter web exec vitest run` for the touched files, `pnpm --filter web build` with zero TS errors, and a real `initialize`/`tools/list`/`tools/call` round-trip against the running portal (the `.mcp.json` client at `/api/mcp/v1`). **This document was produced in a web session without the canonical runtime; no code has been changed or gate-run here.** Implementation slices must be executed in a runtime-capable session.

## 6. Non-goals

- Swapping the hand-rolled transport for `@modelcontextprotocol/sdk` (would fork the governed-execute pipeline and the frozen tool-name contract).
- Renaming any existing tool `name` (frozen API contract).
- Reimplementing the A2A wire as the internal coworker bus, or accepting inbound A2A task execution (inventory §7 non-goals).
- OAuth 2.1 / OIDC MCP authorization (owned by the TAK/GAID auth refresh spec).
- Reopening the A2A inventory's edge-model or ops-map UI decisions.

## 7. Documentation impact

On landing Slice 1–2, refresh the MCP surface notes in [governed MCP backlog surface](2026-04-25-governed-mcp-backlog-surface-design.md) §implementation (serverInfo/tool-metadata shape) and the client-setup snippet doc behind `apps/web/lib/auth/mcp-setup-snippets.ts` if the advertised capabilities change. Slice 6 updates `docs/user-guide/platform/ai-operations.md` (agent-card export surface).
