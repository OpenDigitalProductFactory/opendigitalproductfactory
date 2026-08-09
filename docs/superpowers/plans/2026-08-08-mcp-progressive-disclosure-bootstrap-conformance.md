# Plan — MCP progressive-disclosure bootstrap conformance

| Field | Value |
|---|---|
| Status | Implemented and source-verified; governed PR completion in progress |
| Backlog item | `BI-88681BE0` |
| Work capsule | `WC-C53A840E` |
| Branch | `fix/mcp-progressive-disclosure-bootstrap` |
| Kernel decision | `DI-B6500324926D` — `server-contract`, high confidence, no commandment conflict |
| Existing design | `docs/superpowers/specs/2026-06-20-mcp-tool-tier-deferred-loading-design.md` |
| Existing implementation | BI-D8101329 / PR #4112 |

> **For agentic workers:** execute this plan as one independently reviewable backlog item and one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Problem and evidence

DPF's server-side progressive disclosure is implemented, but a clean external-agent client can still conclude that a granted tool is unavailable. The failure sits between two lazy-disclosure layers: the Codex/client host decides which MCP definitions are attached to the model, while DPF independently returns a lean core and expands it per bearer-token session through `load_tools`.

Observed on 2026-08-08:

- The model-visible Codex tool declarations did not initially include DPF tools; the host's deferred catalog did contain `mcp__dpf__load_tools` and the rest of the granted DPF surface.
- Authenticated MCP `initialize` negotiated `2025-11-25` and advertised `tools.listChanged=true`, but its leading instruction only said to use `tools/list`; it never named `load_tools` or explained the recovery path.
- Raw `tools/list` included `load_tools` on the core floor.
- Exact-name loading emitted `notifications/tools/list_changed`; a same-token re-list appended the selected tool and retained every core-floor tool.
- A natural-language query (`claim a backlog item and bind it to my worktree`) returned no match because the implementation matches the whole query as one substring.
- A follow-up Codex task loaded `create_epic` successfully but stopped because the top-level model registry did not refresh. A live host probe showed the same tool was present in `ALL_TOOLS` and callable through `tools.mcp__dpf__create_epic` inside `functions.exec`; the missing contract was the programmatic-catalog fallback, not server authorization.
- Codex's official MCP documentation says Codex consumes the server's initialize `instructions` for cross-tool workflows and recommends putting the essential guidance in the first 512 characters.
- Multiple architecture/conformance documents still call Phase 2 staged even though PR #4112 shipped it.

## Research and benchmarking

- MCP 2025-11-25 defines `tools.listChanged`, `tools/list`, `notifications/tools/list_changed`, structured tool results, and actionable tool errors. Adopt those contracts and retain a re-list fallback because client support is optional in practice.
- Official OpenAI Codex MCP documentation establishes initialize `instructions` as the supported server-wide seam shared by Codex Desktop, CLI, and IDE. Adopt that seam instead of a Codex-only wrapper.
- DPF's native coworker attachment budget already tokenizes task intent and scores tool name/description overlap. Consolidate that behavior into one dependency-light matcher rather than introduce a second search system.
- Reject full-catalog exposure: it restores the context tax and violates the lean-core design. Reject documentation-only and Codex-only fixes: neither repairs the protocol/client seam across all supported clients.

## Design grounding

- Existing specs/plans reviewed: the MCP deferred-loading design, context-engineering tool-efficiency design, MCP 2025-11-25 adoption plan, and current authorization runbook.
- Current code substrate reviewed: the MCP route, tool tier/session store, `load_tools` payload layer, native coworker attachment budget, capability broker, agentic loop, and grant intersection.
- Source of truth: authorization stays in the token/grant intersection; attachment intent is centralized in `apps/web/lib/tak/tool-intent.ts`; server/client recovery lives in the MCP initialize and tool-result contract.
- Decision: extend the shipped append-not-swap substrate with shared bounded intent matching and protocol-level recovery, not a full-catalog or client-specific parallel path (`DI-B6500324926D`).

## Architecture

Keep authority and attachment separate:

1. Authorization remains the existing token-scope plus grant intersection.
2. `tools/list` remains core floor + per-token loaded set + `load_tools`.
3. A shared lexical intent matcher ranks granted tools by query-token overlap; exact names retain precedence and results stay bounded.
4. Initialize instructions and the `load_tools` definition teach the two-layer recovery path without front-loading the catalog.
5. Unknown names return a structured `unknown_tool` recovery hint. Known-but-ungranted tools continue to return `insufficient_token_scope`; disconnected servers remain transport failures.
6. Clients that honor `list_changed` may refresh immediately; protocol clients can deterministically re-fetch `tools/list` after `load_tools` returns. A host whose top-level registry remains stale uses its programmatic deferred catalog when the loaded tool is present there.

No UI or migration is required. The existing `McpToolSession` schema and per-token TTL remain authoritative.

## Implementation outcome (2026-08-08)

- Red-green evidence captured for all diagnosed gaps: natural-language selection, initialize bootstrap guidance, structured unknown-tool recovery, and Codex's stale-top-level/programmatic-catalog fallback.
- The MCP and native-coworker paths now share `apps/web/lib/tak/tool-intent.ts`; the refactor removes more duplicated matcher code than it adds to the two prior homes and preserves the 16-tool bound.
- The credential-safe protocol probe covers Codex Desktop, Codex CLI, Claude Code, and generic MCP profiles without claiming unobserved host refresh behavior.
- Source verification: 124 targeted Vitest tests, 3 Node protocol/client tests, full web TypeScript compile, production web build, module-size ratchet, 35-guard pregate preflight, skill-pack updater tests, docs links/impact/prose checks, and gitleaks all pass. The production build retains pre-existing Edge-runtime warnings and exits successfully.
- UX and migration gates are not applicable: this change adds no UI surface and no migration.

## Implementation phases

### Phase 1 — Red tests and shared matcher refactor

Files:

- `apps/web/lib/tak/tool-intent.ts` (new single-source matcher in the existing tool-arbitration layer)
- `apps/web/lib/actions/coworker-tool-budget.ts`
- `apps/web/lib/actions/coworker-tool-budget.test.ts`
- `apps/web/lib/mcp/tool-tier.ts`
- `apps/web/lib/mcp/tool-tier.test.ts`

Work:

- First add a failing regression test proving the natural-language claim/worktree query selects `claim_backlog_item_for_work`.
- Extract the duplicated load-tool name, batch limit, tokenization, scoring, and selection behavior into a dependency-light shared TAK module; MCP and native coworker paths import the same contract.
- Keep exact-name behavior, grant filtering, stable ordering, and a bounded intent result set.

Verification: targeted Vitest must show the new test red before implementation and green after refactor; existing native coworker and MCP selection tests remain green.

### Phase 2 — Server bootstrap and error-recovery contract

Files:

- `apps/web/app/api/mcp/v1/route.ts`
- `apps/web/app/api/mcp/v1/route.test.ts`
- `apps/web/lib/mcp/load-tools.ts`

Work:

- Put the exact-name/intent `load_tools` workflow and re-list fallback in the first 512 characters of MCP initialize instructions.
- Make the synthetic meta-tool description explicit that a missing attached DPF tool may still be granted and loadable.
- Return structured `unknown_tool` recovery data naming `load_tools`, while preserving the separate structured authorization response.
- Add route tests for instructions, core visibility, exact and intent selection, append-not-swap, SSE notification, JSON/re-list fallback, unknown-vs-unauthorized classification, and same-token state.

Verification: targeted route and tool-tier Vitest suites; inspect emitted JSON and SSE frames.

### Phase 3 — Cross-client conformance harness and documentation

Files:

- `scripts/lib/mcp-client.mjs` and tests, if the protocol harness needs initialize/list/SSE helpers
- `scripts/mcp-progressive-disclosure-conformance.mjs` (credential-safe operator/conformance probe)
- `docs/architecture/context-engineering-standards.md`
- `docs/architecture/agent-client-capability-parity.md`
- `docs/architecture/agent-standards-dpf-conformance.md`
- `docs/architecture/mcp-tool-authorization-runbook.md`
- `docs/superpowers/specs/2026-06-20-mcp-tool-tier-deferred-loading-design.md`
- `docs/superpowers/plans/2026-08-06-mcp-2025-11-25-a2a-adoption.md`
- relevant `packages/dpf-skill-pack/skills/*/SKILL.md` bootstrap guidance and tests

Work:

- Add a non-secret probe that exercises Codex Desktop/CLI, Claude Code, and generic-client profiles at the protocol boundary: initialize instruction, core `load_tools`, exact name, intent query, notification-aware refresh, notification-blind re-list, core retention, same-session invocation, authorization distinction, and connection diagnosis.
- Mark actual host behavior separately from simulated user-agent conformance; do not claim a client honors `list_changed` without a live observation.
- Correct stale “staged” status and add the short operator diagnosis path. Keep the always-on prompt addition at the initialize seam rather than bloating `AGENTS.md`.

Verification: run the conformance probe without printing the bearer token; exercise a clean Codex Desktop task against the governed runtime and preserve the task/tool evidence.

### Phase 4 — Governed completion

- Run affected unit tests and the production web build in the correct worktree/local-CI substrate.
- Migration: not applicable; no schema change.
- UX: not applicable; no user interface surface changes.
- Obtain independent semantic review of the stable committed tree.
- Run exact-tree local merge CI, record Work Capsule evidence, create a DCO-signed commit, push, open a ready (non-draft) PR, and verify merge readiness mechanically.
- Notify currently blocked Codex tasks with the supported discovery path and the PR/evidence link.
- Route the confirmed durable learning to the shared commons.

## Risks and rollback

- Intent matching can over-select generic tools. Mitigation: stopwords, positive token-overlap ranking, stable tie order, and a bounded batch. Rollback: retain exact-name loading while reverting intent ranking.
- Initialize guidance is always-on context. Mitigation: keep the recovery contract self-contained and concise in the first 512 characters; do not duplicate it in `AGENTS.md`.
- Some clients ignore `list_changed`. Mitigation: the tool result always instructs a deterministic `tools/list` re-fetch, and conformance tests both paths.
- A recovery hint could blur authorization. Mitigation: only unknown names receive `unknown_tool`; known tools continue through existing scope/grant checks.

Rollback is a normal revert of the server-contract PR. The lean core, existing `McpToolSession` rows, and authorization gates remain valid throughout.

## Backlog coverage

- Parent BI: `BI-88681BE0`
- Decision: atomic
- Rationale: matcher, initialize contract, error recovery, conformance probe, and docs are one externally observable bootstrap correction; shipping any phase alone leaves an acceptance path incomplete or documents behavior that is not yet true.
- Receipt: `cmskuvjf303q501ql6x8qd39c`
