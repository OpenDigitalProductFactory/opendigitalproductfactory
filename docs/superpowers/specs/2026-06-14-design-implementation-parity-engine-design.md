# Design–Implementation Parity Engine — Design

| Field | Value |
| ----- | ----- |
| Status | Draft — Slice 0 (parity gate) implemented; engine roadmap proposed |
| Date | 2026-06-14 |
| Owner | Enterprise Architect, Data Architect, Build Studio platform team |
| Builds on | [SysML Architecture Substrate](2026-06-14-sysml-architecture-substrate-design.md) (notation), [Self-Maintaining Data Architecture](2026-06-06-data-architecture-self-maintenance-design.md) (the auto-extraction pattern) |
| WWMD anchor | **Proposed** kernel principle `remove-avoidable-failure-opportunities` (§8) + existing cluster (`single-source-of-truth`, `fix-the-seed-not-the-runtime`, `make-silent-failures-observable`, `structural-verification-is-not-functional`) |
| Slice 0 evidence | `apps/web/lib/ea/architecture-parity.ts` + `apps/web/scripts/audit-architecture-parity.ts` + `.github/workflows/audit-architecture-parity.yml` (40 sourceKeys, 0 drift; caught 1 real defect on first run) |

## 1. Problem — drift is the tax on complexity

Design and implementation drift apart as a system grows. The model says one thing,
the code says another, and the gap widens silently until the architecture is fiction.
This is the dominant failure mode of large systems — and **keeping design and
implementation in provable parity is one of DPF's core differentiating benefits.**

DPF has begun representing its architecture formally in SysML over the EA graph
(routing/cockpit, agent authority, data authority — see the substrate spec). But two
gaps make that representation a *liability* rather than an asset today:

1. **The models are hand-authored snapshots.** The current-state SysML view seeds
   carry `provenance:"deterministic"` `sourceKey`s that *claim* to point at real code,
   but **nothing re-checks them.** They rot the instant code moves. (Proof: the very
   first run of the parity gate built in Slice 0 caught a real broken `sourceKey` in
   the Data Authority seed — `data-model-mirror-apply.ts` missing its directory
   prefix. A human reviewer would not have caught it.)
2. **Hand-authoring trades one cognitive load for another.** Manually keeping SysML
   views in sync with the code is exactly the vigilance burden we want to *eliminate*,
   not relocate.

The strategic instruction (operator, 2026-06-14): *represent our processes and
architecture formally so we can drive construction systematically; make drift
mitigation **systemic and automated** — remove the human and AI cognitive load to
maintain parity; close the current-design parity gap.* This spec answers it.

## 2. Does the parity gap need a catch-up effort? — Yes, but by extraction, not hand-modeling

**Yes — there is a real parity gap, and we should close it.** The current-state EA
graph represents only the **logical data model** through true auto-extraction (the
Prisma→EA data-model mirror). Everything else in SysML is hand-seeded snapshots of a
few subsystems; the rest of the implemented architecture — 242 MCP tools and their
grants, 63 coworkers/personas, route families, value-stream allocations, Build Studio
lifecycle — is **absent from the SysML graph**, even though most of it already exists
as machine-readable registries.

But the catch-up must **not** be done by hand. Hand-modeling the platform would (a)
take enormous effort, (b) be stale on arrival, and (c) re-create the maintenance
burden we are trying to remove. The catch-up is achieved by **generalizing the
data-model mirror's auto-extraction pattern** to the rest of the architecture: derive
SysML elements deterministically from the registries that are already the source of
truth, so the model *is* a projection of the implementation and cannot drift from it
by construction.

## 3. Decision

Build a **Design–Implementation Parity Engine**: a systemic, automated capability that
(a) **auto-derives** current-state architecture (SysML structure) and process (BPMN
behavior) from the machine-readable substrate, (b) **detects drift** between design and
implementation as governed evidence, and (c) **enforces parity** at the points where
work enters the system — CI, Build Studio gates, and the Claude/Codex agent skills —
so parity is maintained by *system*, never by anyone remembering.

This is the same shape that already works for the data model, generalized:

```
source of truth (registry / schema / code graph)
  → deterministic extractor (pure, versioned, stable source keys)
  → idempotent EA/SysML mirror (create/update/revive/soft-remove + snapshot)
  → drift detection (conformance issues, never silent overwrite)
  → enforcement (CI gate ∥ Build Studio gate ∥ agent skill) — fail on new drift
```

The canonical model stays the platform substrate (Postgres, EA graph, code graph,
evidence). SysML/BPMN are viewpoints; the registries are the authority. Nothing here
adds a parallel source of truth — it removes the *manual copies* that drift.

## 4. Architecture

### 4.1 Parity gate (Slice 0 — implemented)

A read-only audit that verifies every deterministic-provenance `sourceKey` in the
SysML view seeds still resolves to real code (file + named symbol), failing CI on new
drift. It makes today's hand-seeded models **self-policing** while the auto-extraction
engine is built — closing gap (1) from §1 immediately, at zero ongoing human cost.

- Pure core: `apps/web/lib/ea/architecture-parity.ts` (`extractDeterministicSourceKeys`, `parseSourceKey`, `auditSourceKeys`) — unit-tested with an injected resolver.
- IO shell: `apps/web/scripts/audit-architecture-parity.ts` — baseline-diff, same shape as the routing/coworker-tool-grant audits; `pnpm check:architecture-parity`.
- CI: `.github/workflows/audit-architecture-parity.yml` (static, no DB; fails on new error-level drift vs `docs/superpowers/audits/2026-06-14-architecture-parity-baseline.json`).
- **Same gate, three consumers:** CI runs it on PRs; Build Studio runs it at the Review gate; the `dpf-sysml-architecture-substrate` skill instructs Claude/Codex to run it when touching architecture. One script, no duplicated logic.

### 4.2 Auto-extraction (Slices 1–n — generalize the mirror)

Reuse the proven mirror contract (`parse → buildDesired(stableKey, descriptor) →
planDiff → applyIdempotent + conformanceOnConflict + softRemove + snapshot +
scheduledReconcile`, from `apps/web/lib/ea/data-model-mirror*.ts`). Each extractor maps
a machine-readable source to SysML elements with a stable `sourceKey`, so the view
becomes a live projection. Ranked by leverage (all sources already exist):

| # | Domain | Source of truth | SysML mapping |
| --- | --- | --- | --- |
| 1 | **MCP tool authority** | `TOOL_TO_GRANTS` (242 entries, `apps/web/lib/tak/agent-grants.ts`) + `mcp-tools` AST extractor | `action`/`part_usage` per tool; `requirement` per grant; `satisfies`/`allocates`; default-deny as `constraint` |
| 2 | **Coworkers / personas / delegation** | `packages/db/data/agent_registry.json` (63 agents) | `part_definition` per coworker; `contains` by tier; delegation/escalation edges; `allocates` → value stream |
| 3 | **Code structure → EA bridge** | existing code-graph facts (routes/tools/Prisma/symbols, `apps/web/lib/integrate/code-graph/`) | bridge the disjoint Neo4j `source-code` graph into EA `part`/`connects` |
| 4 | **Route families** | `apps/web/app/**` (next-routes extractor) | `part_usage`/`action` per route family; `contains` by segment |
| 5 | **Value streams (IT4IT)** | `EaReferenceModelElement` (already xlsx-extracted) | SysML overlay; `allocates` persona→value-stream |
| 6 | **Processes (BPMN)** | lifecycle state machines (e.g. `envelope-state-machine.ts`), value-stream activities | BPMN `process`/`task`/`gateway`; SysML `state`/`action` + verification per gate |

As each extractor lands, the corresponding hand-seeded view is **replaced** by its
live projection and deleted — removing the maintenance surface entirely.

### 4.3 Drift detection + enforcement (systemic, low cognitive load)

- **Detection:** the parity gate (§4.1) for hand-models; for auto-extracted models,
  the mirror's own `descriptor` diff + a generalized steward (extending
  `data-architecture-steward.ts`) files `EaConformanceIssue`s on drift — never a
  silent overwrite (`make-silent-failures-observable`).
- **Enforcement points** (the operator's "Build Studio + skills should ensure"):
  - **CI** — the parity audit blocks merges that introduce drift.
  - **Build Studio** — Ideate asks whether architecture/process is affected; Plan
    requires a SysML architecture note; Review runs `check:architecture-parity` and
    the extractors, and blocks ship on new drift (extends the substrate spec §9 hooks).
  - **Agent skills** — `dpf-sysml-architecture-substrate` (Claude/Codex/Build Studio)
    instructs agents to run the gate and update/extract models as part of any
    architecture-affecting change; the external-evidence handoff records SysML impact.
- **Cognitive-load removal:** humans and AI never manually reconcile models. The
  system extracts and checks; a person/agent only **adjudicates a flagged drift**
  (fix the code, fix the model, or re-tag as intentionally aspirational). That is the
  load reduction the goal demands.

## 5. Processes, not just structure

"Represent our processes" means BPMN behavior alongside SysML structure over the one EA
graph (the notation substrate already seeds BPMN 2.0 + cross-notation links). Process
sources that are already machine-readable: value-stream activities (IT4IT xlsx),
coworker lifecycle/state machines, Build Studio phase gates. These extract to BPMN
`process`/`task`/`gateway` and SysML `state`/`action`, with a `verification_case` per
gate — giving design specificity that drives construction (the goal's first clause).

## 6. Phased delivery

| Slice | Outcome | Status |
| --- | --- | --- |
| **0** | Parity gate: self-policing for hand-seeded models (audit + CI + skill/BS-runnable) | **implemented** |
| 1 | MCP tool-authority extractor → live SysML projection (242 tools/grants) | next |
| 2 | Coworker/persona/delegation extractor (63 agents) → replaces the hand AI-Agent-Authority view | proposed |
| 3 | Code-graph → EA bridge (routes/tools/symbols) | proposed |
| 4 | Build Studio Review gate runs the extractors + parity; Plan requires the SysML note | proposed |
| 5 | BPMN process extraction (value streams, lifecycle gates) | proposed |
| 6 | Generalized steward + nightly reconcile for all auto-extracted domains | proposed |

## 7. Verification

- **Slice 0 (done):** pure-module unit tests (`architecture-parity.test.ts`, 9 cases);
  audit run against the real repo (40 deterministic sourceKeys, **0 drift after fixing
  the 1 real defect it caught**); clean baseline; CI workflow. `packages/db` +
  touched-file typecheck clean.
- **Each extractor slice:** pure parse/diff unit tests (mirror pattern), idempotency,
  conformance-on-conflict, soft-remove; CI parity stays green; runtime EA validation
  in the shared nonprod environment (deferred from the worktree per the substrate
  spec's stance).

## 8. WWMD anchor — proposed kernel promotion (for operator calibration)

The operator referenced a WWMD principle "avoid opportunities to fail." Substrate
check: that doctrine exists in spec form (provider-reconciliation design: *"remove
avoidable failure opportunities, self-heal automatically, make unavoidable failures
visible"*) but is **not yet a promoted kernel principle.** This engine is its clearest
embodiment, so we should promote it. **Proposed** (tier/vector for operator review —
mis-calibrating a kernel vector mis-governs `principle_decide`, so this is surfaced,
not unilaterally shipped):

- **slug:** `remove-avoidable-failure-opportunities`
- **tier:** `core` (design doctrine; pairs with, and sits above, the residual-failure
  leg `make-silent-failures-observable`)
- **direction:** *"Remove avoidable failure modes structurally and maintain
  correctness through automated, self-checking process — not human or AI vigilance;
  make the residual, unavoidable failures loudly observable."*
- **dimensionVector (proposed):** `{ "long_term_maintainability": 1.0, "human_cognitive_load": -0.6, "evidence_density": 0.6, "governance_compliance": 0.4 }`
- Anchors to existing kernel principles: `single-source-of-truth` (drift's root cause),
  `fix-the-seed-not-the-runtime` (+ invariant guard), `live-state-over-seed-data`,
  `structural-verification-is-not-functional`, `make-silent-failures-observable`.

On operator approval, author `docs/founder-kernel/wiki/principles/remove-avoidable-failure-opportunities.md`
(PR-gated, seeded by `seed-wiki-kernel.ts`) and re-anchor this spec's WWMD field to it.

## 9. Risks

- **Extractor instability:** registries change shape. Mitigation: versioned pure
  adapters + fixture tests, exactly as the Prisma adapter does.
- **Over-modeling:** model only what affects construction, verification, authority, or
  drift-control — not ceremony (substrate spec §13).
- **Parity-gate false positives:** heuristic symbol matching can mis-flag. Mitigation:
  errors are path-existence only (high confidence); symbol mismatches are `warn`, and
  line-refs are path-only. Baseline-diff grandfathers known gaps.
- **Kernel mis-calibration:** the proposed principle vector is surfaced for operator
  calibration rather than shipped blind (§8).

## 10. Recommended next decision

Approve Slice 1 (MCP tool-authority extractor → live SysML projection of the 242
tool/grant authority surface), and the §8 kernel-principle promotion. Slice 1 converts
the highest-leverage, security-critical authority surface from absent/hand-approximated
into a live, drift-checked projection — the first proof that the parity gap closes by
extraction, not by hand.
