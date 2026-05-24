# Agent workspace pattern - unified CLI dispatch across coworker contexts

**Status:** draft, post chief-architect review (2026-05-12). Observations are grounded where marked; open decisions remain explicit. No code changes are proposed in this draft. Companion work: [document-management capability kickoff](2026-05-12-document-management-capability-kickoff.md).

**Promotion gate.** This draft is not implementation-ready until five closures land: (1) Principal-alias attribution stated, (2) sandbox-to-portal transport policy proposed (not just named as a problem), (3) operator-contract Markdown/DB reconciliation with the prompts-in-DB pattern, (4) workspace lifecycle defined for non-code types, (5) per-workspace token issuance specified. See sections 4, 5.4, 5.6, 5.7, 5.8. Plumbing fixes (MCP snippet `type: "http"`, internal transport) belong in a separate cleanup PR per the 2026-04-27 onboarding draft and are blockers for the next probe slice but not part of pattern promotion.

**Working name:** agent workspace pattern

**Authors / origin:** discussion on 2026-05-12 between the maintainer and a Claude Code session investigating a PR-405-era build-coworker regression. The investigation surfaced that build sub-agents already operate with a protected workspace and native CLI tools; the chat-coworker path drifted toward prompt-described tools and has been less reliable. This spec asks whether workspace-using coworkers should converge on the working pattern.

**Scope assumption:** one Organization per install (memory: single-org-per-install). Workspace ownership is intra-org. Cross-install sharing is a hive-mind concern (section 5.9), not a workspace-pattern concern.

---

## 1. What this Spec Covers

A pattern for running AI coworkers that need to do real work, not just have a conversation. Today the platform has three patterns running side by side:

| Pattern | Where it runs today | Tool surface | Audit/state path |
| ------- | ------------------- | ------------ | ---------------- |
| Sub-agent dispatch | `apps/web/lib/integrate/claude-dispatch.ts`, `apps/web/lib/integrate/codex-dispatch.ts` | CLI native tools inside the sandbox | Sandbox git branch, stderr progress, diff captured at session end |
| Chat coworker via CLI adapter | `apps/web/lib/routing/cli-adapter.ts` | Platform tools described in prompt text, native tools restricted | `agentic-loop.ts` -> `executeTool` / `governedExecuteTool` -> `ToolExecution` |
| Chat coworker via chat adapter | `apps/web/lib/routing/chat-adapter.ts` | Provider-native tool array | `agentic-loop.ts` -> tool execution path |

This spec only covers coworkers that need a workspace: code, documents, image/design assets, and research artifacts that must persist beyond the turn.

**Out of scope:** pure conversational coworkers that never need to read/write files or produce durable artifacts. Those can stay on the chat-adapter path with a small platform-tool set.

Decision tree: if the coworker needs to read/edit files or produce artifacts that survive the turn, use the workspace pattern. If not, use the chat pattern.

---

## 2. The Pattern

An AI coworker that needs to do real work gets:

1. A protected workspace: a sandboxed filesystem with appropriate tools.
2. A CLI session with native tool access scoped by the workspace.
3. A platform MCP server mounted through `--mcp-config` so the coworker can read/write the platform state its job requires.
4. An operator-contract Markdown file in the workspace root that describes the coworker's role, lifecycle gates, and which platform MCP calls persist which lifecycle artifacts.

The coworker works inside the workspace. The platform observes and records outcomes at lifecycle gates. Audit focuses on durable outcomes and platform MCP calls, not every native read/edit command.

---

## 3. Workspace Types

Each workspace type is a tuple: tool inventory, operator contract, lifecycle gates, and persistence handoff.

### 3.1 Code Workspace

This already exists in Build Studio.

- **Tools:** CLI native tools plus `mcp__dpf__*` for build/release platform calls.
- **Persistence:** the workspace git branch is the artifact. Phase-advance gates capture commits/diff into `FeatureBuild` rows; ship promotes through the existing contribution path.
- **Outputs:** code diff, test output, design doc, build plan, deploy artifact.

### 3.2 Document Workspace

This is new and depends on the companion document-management capability.

- **Tools:** CLI native file editing in scratch space plus `mcp__dpf__doc_*` to persist drafts, load prior versions, link references, request reviews, and publish.
- **Persistence:** the workspace filesystem is scratch. Durable documents live in the document-management store. The operator contract should say: scratch lives in `/workspace/scratch/`; when a document is ready to persist, call `mcp__dpf__doc_save`.
- **Outputs:** specs, plans, briefs, reports, and other non-code artifacts that are linked, version-tracked, searchable, and lifecycle-managed.

### 3.3 Image / Design Workspace

Future work.

- **Tools:** CLI native tools, image generation/editing tools, and future `mcp__dpf__asset_*`.
- **Persistence:** asset store with renditions, used-by graph, and version history.
- **Outputs:** brand assets, mockups, diagrams, and visual references used by documents and code.

### 3.4 Research / Brainstorm Workspace

Open. Some workspaces gather and distill rather than produce a single final artifact. The output might be a position, recommendation, or synthesis. This could be a document type, or it might need a distinct lifecycle if the result feeds another workspace instead of publishing.

**Gating rule:** this spec does not ship workspace types whose persistence story is undefined. Either fold research outputs into the document workspace with a `kind: research` discriminator (preferred default), or wait until a distinct lifecycle is designed. Decision Point #9 below.

---

## 4. Operator Contract

Each workspace should have an `AGENTS.md`-style operator contract that the CLI reads at startup. It is persistent context and should not be re-injected into every prompt.

Required sections:

1. **Role and accountability.** Who the coworker is, who it reports to, and what is in scope.
2. **Tool inventory and conventions.** Native tools are workspace-local; platform MCP calls are the audited platform boundary.
3. **Lifecycle.** The phase model and per-phase definition of done.
4. **Boundaries.** What the coworker does not do and what should be handed back to the orchestrator.
5. **Failure modes.** When to stop and surface to the user versus retry or route around.

The build-specialist contract at `docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md` is the closest existing reference. Most of that content belongs in a workspace contract. The DB `PromptTemplate` should shrink toward a per-turn header: current phase, user message, and any ephemeral routing constraints.

### 4.1 Source of truth and the running workspace file

Three artifacts to distinguish:

1. **Canonical contract source** — versioned Markdown in repo under `prompts/operator-contracts/<slug>.contract.md`. Same lifecycle as other prompts: seeded to `PromptTemplate` on deploy, editable via Admin > Prompts (per AGENTS.md §2 prompts-in-DB convention). This preserves the non-engineer editing affordance and stays consistent with how every other long-form coworker text is handled today.
2. **Per-turn runtime header** — small DB-stored template: current phase, user message, ephemeral routing constraints. Injected into every prompt.
3. **Running workspace `AGENTS.md`** — generated at workspace-create time from the canonical contract (rendered with per-workspace context: coworker identity, workspace type, phase, available `mcp__dpf__*` tools). Written to the workspace filesystem root. CLI reads it at startup. Regenerated on phase advance.

Proposed default: contract source lives in `prompts/operator-contracts/`, seeded to DB, edited in Admin > Prompts, **rendered** to the workspace `AGENTS.md` at create time. This keeps a single source of truth, keeps the Admin > Prompts editing path intact, and avoids the workspace becoming a parallel editable surface.

**Rejected alternatives:** (a) Markdown-only canonical (loses Admin > Prompts editing); (b) DB-only canonical with no workspace file (CLI agents need a file to read at startup, and re-injecting the full contract every turn wastes tokens).

---

## 5. Architectural Decisions

### 5.1 Audit Boundary

Two options:

- **Strict boundary.** Every platform-state change goes through `mcp__dpf__*`. Native tools do the work; MCP records what landed. Existing phase gates remain. `ToolExecution` rows are written for platform MCP calls.
- **Loose boundary.** The sandbox git branch is the build state; the platform derives phase and evidence from commits/test runs.

Proposed default: strict. It preserves the existing UI gates and the operator-contract direction while still allowing native tools inside the protected workspace.

### 5.2 Context Narrowness

Context should vary by workspace type.

- **Sandboxed workspaces:** wider context and native tools. The workspace contains the blast radius.
- **Pure-chat coworkers:** narrower tool surface, no native filesystem access, provider-native tools only.

The decision is whether the workspace itself safely contains the blast radius. For code, yes. For documents/images, probably yes once durable versioning and access controls exist. For raw chat coworkers acting on production data, no.

### 5.3 Sub-agent Autonomy

Inside a workspace, the CLI session can spawn its own sub-agents or skills. Default proposed: encouraged when the task is parallelizable, bounded by the workspace contract and lifecycle gates.

### 5.4 Session Token and TLS Gate

The platform MCP route is `apps/web/app/api/mcp/v1/route.ts`. It implements transport/origin guards, token auth, `tools/list`, and `tools/call`.

Relevant code references:

- Transport guard: `apps/web/app/api/mcp/v1/route.ts:136`
- Token/scope filtering: `apps/web/app/api/mcp/v1/route.ts:173`
- `tools/list`: `apps/web/app/api/mcp/v1/route.ts:218`
- `tools/call`: `apps/web/app/api/mcp/v1/route.ts:230`
- Governed execution/audit: `apps/web/app/api/mcp/v1/route.ts:282`
- JSON-RPC dispatch: `apps/web/app/api/mcp/v1/route.ts:376`
- Containerized host-header tests: `apps/web/app/api/mcp/v1/route.test.ts:103`
- `tools/list` scope test: `apps/web/app/api/mcp/v1/route.test.ts:304`
- `ToolExecution` audit test: `apps/web/app/api/mcp/v1/route.test.ts:445`

The sandbox cannot use `localhost` to reach the portal because `localhost` resolves to the sandbox container. It must use `http://portal:3000/api/mcp/v1` or a dedicated internal URL. Current runtime blocks plain HTTP to non-localhost hosts unless the request presents a trusted forwarded host/proto header.

**Proposed transport policy.** The route already supports an env-driven internal host allowlist at [route.ts:120-124](apps/web/app/api/mcp/v1/route.ts:120): `MCP_ALLOWED_ORIGIN_HOSTS` is a comma-separated list of hostnames that bypass the TLS-required check. The mechanism exists; the gap is that docker-compose does not populate it.

The proposed shape:

- Compose injects `MCP_ALLOWED_ORIGIN_HOSTS=portal,sandbox,build-runner` (or the equivalent internal hostnames) at install time, scoped to the internal docker network only. Production deployments behind a TLS-terminating proxy continue to set `X-Forwarded-Proto: https` and are unaffected.
- The sandbox-side MCP config uses the internal hostname (`http://portal:3000/api/mcp/v1`) and presents its bearer token. No forwarded-host header is required and none should be set.
- The probe's `X-Forwarded-Host: localhost:3000` workaround is **explicitly forbidden as a shipping path**. Any container that reaches the route can claim to be localhost by setting that header; treating user-controlled headers as a transport trust signal is a security smell. The probe used it to characterize the route's existing logic, not to propose a deployment pattern.

**Rejected alternatives:**

- *mTLS between containers.* Higher operational cost (cert lifecycle), no security benefit over the already-trusted internal docker network for this threat model.
- *Separate internal-only port without the TLS guard.* Forks the route surface and risks the internal port leaking through a misconfigured proxy.
- *Trust `X-Forwarded-Host` from the docker network.* The route cannot tell "from the docker network" apart from "via a misconfigured proxy that forwards client headers raw"; the env allowlist is the same idea done correctly.

### 5.5 MCP Config Shape

The token action currently generates Claude/Codex snippets without an explicit HTTP type:

- `apps/web/lib/actions/mcp-tokens.ts:77`

The current sandbox Claude Code build (`2.1.139`) rejects a config shaped as:

```json
{
  "mcpServers": {
    "dpf": {
      "url": "http://portal:3000/api/mcp/v1",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

with:

```text
Invalid MCP server config for "dpf": command: expected string, received undefined
```

Adding `type: "http"` allows Claude Code to accept the HTTP server config shape far enough to proceed to model auth:

```json
{
  "mcpServers": {
    "dpf": {
      "type": "http",
      "url": "http://portal:3000/api/mcp/v1",
      "headers": {
        "Authorization": "Bearer ...",
        "X-Forwarded-Host": "localhost:3000"
      }
    }
  }
}
```

The companion MCP onboarding draft already identified a related missing `type: "http"` problem for VS Code at `docs/superpowers/drafts/2026-04-27-mcp-onboarding-improvements.md:76`.

### 5.6 Identity and Attribution

Per AGENTS.md §11 (2026-05-09 addendum), any identity-bearing entity introduced after that date is a `PrincipalAlias` linked to a single `Principal`. Workspaces follow this rule:

- Every workspace is owned by exactly one `Principal`. For coworker workspaces, that Principal is the coworker itself (alias kind `Agent`). For human-driven workspaces, the owning Principal is the human operator.
- `ToolExecution` rows written through `governedExecuteTool` (route.ts:282) carry `agentId` and `userId` as today. When a workspace is coworker-owned, `agentId` is the coworker's Principal-alias; when human-driven, `userId` is the operator and `agentId` may be null.
- Workspaces do not introduce a new identity table. They are addressed by `workspaceId` and reference the owning Principal — never a free-form `ownerType` string.

This keeps audit attribution flowing through the single Principal model and prevents the spec from quietly creating a parallel identity surface.

### 5.7 Workspace Lifecycle

Code workspaces have a lifecycle today (Build Studio: create on phase start, advance through phases, archive on ship or abort). Document and image workspaces have none defined. This spec must name the lifecycle even if implementation is deferred per workspace type.

Required lifecycle elements per workspace type:

1. **Create.** Who triggers it (orchestrator, coworker, user), what inputs seed it (initial files, contract render context, parent task), what state is allocated (filesystem, git branch, child MCP token).
2. **Suspend / resume.** Behavior on portal restart. Today the build orchestrator has no task-level resume — restart loses in-flight phase state even though `FeatureBuild` rows persist. Any new workspace type must declare whether it survives portal restart and how it reconnects to its CLI session (or accepts that the session is lost and the next session re-attaches by reading workspace files + DB state).
3. **Concurrent workspaces.** Whether one coworker can hold multiple workspaces simultaneously, and whether one workspace can be shared across coworkers (default: no on both — one coworker, one workspace, one task).
4. **Archive / destroy.** When is the workspace torn down, what gets preserved (commits, generated documents, evidence rows), what gets discarded (scratch, cached models).

| Workspace type | Create | Resume | Concurrency | Archive |
| -------------- | ------ | ------ | ----------- | ------- |
| Code           | Build orchestrator on phase start. Sandbox git branch + `FeatureBuild` row. | **Open.** No task-level resume today (memory). Spec for this surface lives separately. | One per `FeatureBuild`. | Branch retained on ship; promoter consumes diff. Abort path keeps branch for forensics, marks build `aborted`. |
| Document       | Open. Probably: coworker requests on first `doc_save` of a new doc; orchestrator creates on plan kickoff. | Open. Scratch is disposable; durable state is in document store. Re-create freely. | Open. |
| Image / design | Future. Defer until asset store exists. | n/a | n/a | n/a |
| Research       | Decision point. If folded into Document type with `kind: research`, inherits document lifecycle. If kept separate, design required. | | | |

This table is a placeholder pending the document-management spec. The pattern does not ship workspace types whose lifecycle is undefined.

### 5.8 Token Issuance per Workspace

Today the workspace inherits the operator's `dpfmcp_...` token via `--mcp-config`. That overscopes: a document coworker can call backlog and build tools because the token's scopes are union of everything the operator could authorize. Strict audit (§5.1) is partly cosmetic if the token allows more than the contract.

Proposed default: **child token per workspace.** On workspace-create, the platform mints a short-lived token whose scopes are the intersection of:

1. The operator's authority (token grants + role capabilities) at create time.
2. The owning coworker's `tool_grants` from `agent_registry.json`.
3. Workspace-type-appropriate grants (a document workspace does not get `build_*` tools by default).
4. Optionally, current phase (see Decision Point #7 / §5.10 below).

The child token is bound to the workspace lifetime, revoked on archive, and never persisted outside the workspace MCP config. `apiTokenId` on `ToolExecution` rows (route.ts:289) becomes the audit trail tying every call back to its workspace.

This requires a small extension to the token issuance action at [mcp-tokens.ts:77](apps/web/lib/actions/mcp-tokens.ts:77) (or a sibling action) to mint scoped child tokens; the route side already enforces scopes correctly per [route.ts:173-184](apps/web/app/api/mcp/v1/route.ts:173).

### 5.9 Hive Contribution Stance

The pattern itself (workspace types, operator contracts, MCP tool inventories) is high-value hive substrate — operator contracts in particular generalize cleanly across DPF installs. Reusability-by-design is a stated DPF principle.

Proposed default for v1: **local-only**. Operator contracts and workspace-type definitions ship as repo artifacts and are versioned through the normal release path. Cross-install contribution of contracts is a hive concern handled by the existing `contribute_to_hive` flow, not a workspace-pattern feature.

Open: whether workspace-type definitions (the tuple of tools + contract + lifecycle + persistence handoff) should themselves be a hive-contributable artifact in a later iteration. Recommend deferring until at least one non-code workspace type has shipped and proved its shape.

### 5.10 Phase-aware Tool Surface

Decision Point #7 asks whether `tools/list` should gain workspace/phase filtering beyond token scopes.

Proposed default: **phase lives in the child token from §5.8, not in the route.** At phase advance, the orchestrator mints a new child token whose scopes reflect the phase's allowed tool set (e.g., a build coworker in `design` phase does not get `contribute_to_hive`). The route at [route.ts:218-227](apps/web/app/api/mcp/v1/route.ts:218) stays clean — it filters by token scopes, as it does today. The orchestrator owns the phase-to-scope mapping.

Rejected alternative: encoding phase into the route's filtering logic. Couples the platform MCP surface to workspace-pattern concepts and bloats a route that's currently doing one thing well.

---

## 6. Document-management Capability

This spec depends on a document-management capability that does not exist today. Filesystem scratch is insufficient for document workspaces because:

- Documents reference one another across workspaces, repos, and contexts.
- References must survive moves, renames, and version bumps.
- Documents have lifecycle states that filesystem cannot represent by itself.
- Search needs full-text, semantic, and metadata modes.
- Version history should be independent of git.
- Owner/access/governance metadata must be queryable.

The companion kickoff prompt is persisted as `docs/superpowers/drafts/2026-05-12-document-management-capability-kickoff.md`.

This spec assumes a future `mcp__dpf__doc_*` toolset with at least:

- `doc_save`
- `doc_load`
- `doc_search`
- `doc_link`
- `doc_version_list`
- `doc_state_change`
- `doc_list_references`

Schema and implementation are intentionally delegated to the companion document-management spec.

---

## 7. Probe Results - 2026-05-12

The original gating probe was:

1. Mint or reuse a `dpfmcp_*` token.
2. Write an MCP config inside the sandbox.
3. Resolve the `portal:3000` transport constraint.
4. Invoke `claude -p --mcp-config ... --strict-mcp-config` and ask it to call `mcp__dpf__query_backlog`.
5. Observe discovery, invocation, and `ToolExecution`.

### Environment

- Worktree branch for this draft: `doc/agent-workspace-pattern-probe`
- The prior untracked draft worktree was gone when this work resumed, so this draft was recreated in a new isolated worktree from `origin/main`.
- Active local Docker runtime was mixed: the visible `portal` and `sandbox` containers had been launched from other DPF worktrees, not from this draft branch. Treat this as live-local runtime evidence, not proof that this branch image contains any change.
- `dpf-sandbox-1` had both `claude` and `codex` CLIs installed.

### Results

| Probe | Result | Evidence |
| ----- | ------ | -------- |
| Host -> `http://localhost:3000/api/mcp/v1` `initialize` | Pass | HTTP 200, server info `dpf-platform`, protocol `2025-11-25` |
| Host -> `tools/list` | Pass | HTTP 200, 34 tools returned, including `query_backlog`, `list_epics`, `list_backlog_items` |
| Sandbox -> `http://portal:3000/api/mcp/v1` without forwarded host | Blocked | HTTP 403, `TLS required (HTTPS only outside localhost)` |
| Sandbox -> same URL with `X-Forwarded-Host: localhost:3000` | Pass | `initialize` and `tools/list` returned HTTP 200 |
| Sandbox direct JSON-RPC `tools/call query_backlog` | Pass | Returned `Backlog: 64 open, 5 in-progress, 35 done. 16 epic(s).` |
| Audit row for direct sandbox `tools/call` | Pass | Latest row: `ToolExecution.id=cmp37hzr70a5v01rumgo4y0ky`, `toolName=query_backlog`, `success=true`, `executionMode=external-jsonrpc`, `apiTokenId=<redacted>`, `createdAt=2026-05-12 22:32:43.843` |
| Claude Code with generated HTTP config lacking `type` | Blocked | Rejected config: `command: expected string, received undefined` |
| Claude Code with `type: "http"` config | Partially validated | Config progressed past shape validation, then CLI stopped at `Not logged in - Please run /login` |
| Codex CLI model-mediated probe | Blocked | Sandbox Codex lacked OpenAI auth; `codex exec` returned 401 from `/v1/responses` |

### Interpretation

The MCP route is real and usable from the sandbox when the transport guard is satisfied. `tools/list`, `tools/call`, token-scope filtering, and governed `ToolExecution` audit are working at the JSON-RPC layer.

The unresolved gap is not the DPF MCP route itself. The remaining blockers are:

1. The sandbox-to-portal transport rule needs a first-class internal-host solution, not a user-spoofable forwarded-host header.
2. The generated Claude/Codex MCP snippets need the current client-required HTTP type field.
3. The sandbox CLI image needs an authenticated model provider before a model-mediated `mcp__dpf__query_backlog` call can be verified end to end.

Until item 3 is verified, the full claim "the CLI model sees and calls `mcp__dpf__query_backlog`" remains unproven. The lower-level JSON-RPC and audit parts are proven.

### Recommendation from the Probe

Keep the workspace pattern as a draft, not an authoritative implementation plan, until one more small slice lands:

1. Add a supported internal MCP URL/transport policy for sandbox -> portal.
2. Fix generated MCP snippets to include `type: "http"` where required by current clients.
3. Run the authenticated Claude or Codex CLI probe and record the model-mediated tool call.

---

## 8. Out of Scope

- Migrating in-flight builds.
- Multi-tenant workspace allocation.
- Replacing pure-chat coworkers.
- Designing document-management storage/search/lifecycle in this spec.
- Designing the full semantic ranking model for document search.

---

## 9. Decision Points

1. Do we adopt the unified pattern for workspace-using coworkers?
2. Strict or loose audit boundary? (Proposed: strict — §5.1.)
3. Operator-contract source-of-truth and runtime-file model. (Proposed: `prompts/operator-contracts/*.contract.md` → DB → rendered workspace `AGENTS.md` — §4.1.)
4. Are sub-agents encouraged inside workspaces? (Proposed: yes, bounded by contract — §5.3.)
5. Supported sandbox-to-portal MCP transport path. (Proposed: `MCP_ALLOWED_ORIGIN_HOSTS` via compose env; reject `X-Forwarded-Host` spoofing — §5.4.)
6. Do document workspaces wait for the document-management capability? (Proposed: yes — companion spec gates this one.)
7. Workspace/phase filtering of `tools/list`. (Proposed: phase lives in the child token, not in the route — §5.10.)
8. Should MCP token issuance generate client-specific config snippets, including `type: "http"` where required? (Belongs to the onboarding cleanup PR — out of this spec's scope but blocking the probe.)
9. Research/brainstorm workspace shape. (Proposed: fold into document workspace with `kind: research` — §3.4.)
10. Per-workspace child-token issuance. (Proposed: yes — §5.8.)
11. Hive contribution surface for operator contracts. (Proposed: v1 local-only; revisit after first non-code workspace ships — §5.9.)
12. Identity attribution model for workspaces. (Proposed: every workspace owned by a single `Principal`; no parallel identity table — §5.6.)

---

## 10. Next Smallest Slice

Treat the next slice as an MCP connectivity/onboarding repair, not as workspace-pattern implementation:

- Fix the generated MCP config snippets ([mcp-tokens.ts:77](apps/web/lib/actions/mcp-tokens.ts:77)) to include `type: "http"` per current client requirements.
- Land the internal-transport policy: docker-compose sets `MCP_ALLOWED_ORIGIN_HOSTS` for portal-internal services; runtime guard rejects `X-Forwarded-Host` as a trust signal.
- Re-run the authenticated CLI probe end-to-end.
- Only then promote this draft from hypothesis to implementation-ready spec.

After promotion, the first workspace-pattern implementation slice is the **child-token issuance path** (§5.8) and the **operator-contract render pipeline** (§4.1) — both are prerequisites for the first non-code workspace and both are tractable in isolation against existing Build Studio behavior.
