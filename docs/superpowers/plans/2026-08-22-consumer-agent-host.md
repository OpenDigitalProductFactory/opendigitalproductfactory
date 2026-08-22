# Plan — consumer install as a first-class agent host

| Field | Value |
|---|---|
| Status | approved for implementation |
| Backlog items | `BI-11D611B3`, `BI-DD7DC141` |
| Workroom | `WC-E08BD92F` |
| Design | `docs/superpowers/specs/2026-08-22-consumer-agent-host-design.md` |
| Decisions | `DI-06201F1778E9`, `DI-88D1C6E4B937` |
| Branch | `fix/consumer-agent-host` |

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. The operator explicitly requires the two dependent deliverables to land in one PR; keep their tests and evidence separately traceable inside that PR.

## Design grounding

- Specs/plans reviewed: MCP progressive-disclosure bootstrap conformance,
  install/self-upgrade refactor parity, release batching, owner-readable release
  status, and the governed platform upgrade lifecycle.
- Code substrate reviewed: MCP route/auth/org-context composition, token grants,
  release-asset extraction/checksums, self-upgrade target resolution, request and
  runner gates, batch projection, MCP pack, promotions status, owner summary,
  trigger control, and Upgrade Center page.
- Source of truth: one install-host profile; MCP instructions are authoritative
  behavior; the release `AGENTS.md` is a pointer; one self-upgrade support
  projection feeds every surface.
- Decisions: `mcp-plus-pointer` and `honest-unsupported-now` as recorded above.

## Change-impact contract

The Workroom contract is resolved. Before Red, graph advice identified:

- promotions: page, trigger swap-resilience, promotions self-upgrade, and
  promotions action tests;
- MCP pack: tool-registry and pack tests;
- runner: queue self-upgrade tests.

Required completion work also includes `node scripts/check-style-drift.mjs`,
doc-index regeneration, the Design-Grounding commit trailer, `pregate:preflight`,
exact-tree `pregate`, and `pr:health`. `promotions.ts` and the queue test are
baselined modules and may not grow past their guards; extract shared behavior
instead of appending branches there.

## Phase 1 — Profile and release-pointer contract (BI-11D611B3)

**Deliverable:** one pure/install-aware host profile and a verified minimal
consumer-root pointer.

Files:

- `apps/web/lib/install/host-profile.ts` and colocated tests;
- `config/consumer-install/agent-pointer.md` (renamed to `AGENTS.md` only in the
  release bundle);
- `Dockerfile`;
- `scripts/check-release-asset-contract.test.mjs`.

Red first:

- consumer/source/unknown evidence matrix;
- contradictory or absent evidence fails closed;
- release bundle must contain `AGENTS.md` and checksum it;
- pointer must identify runtime, prohibit source edits, and point to MCP.

Green/refactor: implement the dependency-light classifier and I/O adapter, then
wire the pointer into the existing release-assets directory. Rebase after PR
#4436 if it merges because that PR also edits `Dockerfile` and the release-asset
test.

Verification: targeted Vitest and Node release-asset test; build the init target
and inspect its checksum manifest during the final gate.

## Phase 2 — Dynamic MCP host contract (BI-11D611B3)

**Deliverable:** install-mode- and effective-authority-aware server instructions.

Files:

- `apps/web/lib/mcp/agent-host-instructions.ts` and tests;
- `apps/web/app/api/mcp/v1/route.ts` and route tests.

Red first:

- progressive-disclosure prefix remains first;
- consumer/source/unknown copy is distinct;
- observer/employee/development/admin guidance derives from effective grants;
- consumer development guidance routes code work to a separate checkout;
- no token, secret, or host path leaks into instructions;
- organization context remains after the host contract.

Green/refactor: pass resolved auth into initialize, compose one bounded instruction
builder, and retain existing authorization dispatch unchanged.

Verification: targeted route/instruction suites plus MCP protocol probe. Confirm
the served consumer runtime returns the contract on initialize after deployment;
do not claim modern clients that skip discovery are covered by protocol alone.

## Phase 3 — Honest self-upgrade support (BI-DD7DC141)

**Deliverable:** a source-capability guard and one support projection across all
machine and operator surfaces.

Files:

- `apps/web/lib/self-upgrade/support.ts` and tests;
- existing request, release-batch-status, owner-summary, and their tests;
- queue self-upgrade runner and tests;
- self-upgrade MCP pack, tool-registry, and pack tests;
- promotions status/action tests;
- Upgrade Center page, owner card/trigger control, and UI tests.

Red first:

- consumer request never dispatches;
- runner returns unsupported before target resolution or drain;
- batch is non-applicable/ineligible;
- MCP says configured but unsupported and effectively disabled;
- missing Git target cannot become “up to date”;
- owner card leads with explicit unavailable copy and disabled action;
- source-backed behavior remains unchanged.

Green/refactor: centralize support projection, thread it through the current read
models, and keep large baselined files flat by delegating to the new module.

Verification: all graph-linked and colocated tests, jargon/copy guard, component
render tests, and a runtime viewport check in the governed shared environment.

## Phase 4 — Architecture, UX, and blast-radius review

- Run the architecture advisory against the design: one home per fact, no schema,
  O(1) probes, explicit future scale ceiling.
- Run UX-fit review and capture the first viewport at desktop and narrow width;
  verify copy, disabled affordance, theme tokens, and advanced disclosure.
- Run blast-radius analysis for MCP initialize, release assets, and every
  self-upgrade consumer; check source-backed regression behavior.
- Generate the doc index and run docs/prose/link checks.

## Phase 5 — Governed completion

- Run targeted suites, production typecheck/build, style drift, release-asset
  contract, `pregate:preflight`, and exact-tree `pregate`.
- Commit with DCO and required Design-Grounding, Docs-Impact, and Process-Spine
  trailers; author identity must equal `Signed-off-by`.
- Obtain independent semantic review of the stable commit and record evidence.
- Run local merged-code CI against current `main`; treat any GitHub check state
  other than `SUCCESS` as not green.
- Push one ready PR, run `pnpm pr:health`, read bot review findings, and enable
  squash auto-merge with `gh pr merge <number> --squash --auto`.

## Risks and rollback

- **Instruction growth:** retain the existing 512-character bootstrap prefix and
  keep host copy bounded. Rollback removes the appended host segment only.
- **Install misclassification:** marker plus Git evidence is explicit; unknown
  fails closed. Rollback restores source-only behavior without data changes.
- **Status divergence:** all consumers use one support projection and regression
  tests assert parity. Rollback is a normal PR revert.
- **PR #4436 overlap:** refresh main before publication and reconcile only the
  two shared release files; rerun release-asset and exact-merge gates.

No migration or destructive data operation is involved.

## Backlog coverage

- Parent BI: `BI-11D611B3`
- Decision: decomposed
- Deliverable `agent-host-contract` → `BI-11D611B3`
- Deliverable `honest-consumer-upgrade-status` → `BI-DD7DC141`
- Dependency: the upgrade support projection consumes the host profile delivered
  by `agent-host-contract`.
- Receipt: pending immutable plan-blob registration.
