# Wire the trust-envelope evidence re-verifier — plan

**Status:** in progress · 2026-08-15
**Backlog item:** BI-8192557E
**Epic:** EP-DECISION-TIER-REBALANCE
**Spec context:** [`trust-is-prospective-not-retrospective`](../../founder-kernel/wiki/principles/trust-is-prospective-not-retrospective.md) (PR #4322)

## Backlog coverage

- Decision: decomposed
- Parent: BI-8192557E
- Receipt: cmsulvbc01hht01ppkpul5748
- Dependencies: deliberation→evidence-grade, criteria-accrual and real-diversity all depend on reverifier-wire landing first
- Rationale: the safety wire ships independently of the grade-raising wires and must precede them.
- Mappings:
  - reverifier-wire (this plan, phase 1) -> BI-8192557E
  - cold-start-weights -> BI-8AC099F4

## 1. Problem

`apps/web/lib/decision/evidence-reverifier.ts` (BI-70FF9114, marked done) implements an independent re-verification pass: it re-resolves each recorded `StructuredLocator` against the live source, compares the live excerpt to the recorded one, and degrades the affected dimension to unevidenced when the citation no longer holds. **It has zero consumers**, because it requires an injected `LocatorResolver` and no resolver implementation exists anywhere in the codebase.

The consequence is a fabricated-evidence hole. `lib/deliberation/evidence.ts` already rejects citation theater — a citation must normalize to a `StructuredLocator` and pass `checkAdmissibility`, and an outcome with no cited sourceType gets a `needs-more-evidence` badge rather than "fabricated consensus". But **admissibility is not truth**: a plausible `filePath` + `line` that never existed, or a real file that never contained the claimed excerpt, passes admissibility today and nothing re-checks it.

This matters more, not less, as plurality is wired into calibration. Measured on the live install: 1,244 deliberation runs, of which **988 use `multi-model-same-provider`** — co-trained branches share priors and therefore co-hallucinate, so their agreement reads as corroboration. Convergence over unverified citations would industrialize confident fabrication rather than catch it.

**Ordering constraint:** this must land before any wire that lets convergence raise `evidenceGrade` (BI-8192557E phases 2–4).

## 2. Where it attaches

Traced chain (all existing):

```
principle_decide (lib/mcp/packs/principle-decide-pack.ts)
  → groundOptionsFromParams (lib/decision/evidence-grounding.ts)   // Axis 1, BI-EA97E5CD
  → recordKernelConsultInteraction (lib/decision/kernel-consult-ledger.ts)
  → DecisionInteraction.sources (jsonb)   // admissible citations, sealed into the hash chain
```

So citations are persisted per (optionId, dimensionKey), and the re-verifier reads that record rather than needing new storage. ⟦corrected in phase 2a: the *locator* was NOT among the persisted fields — see §3 Phase 2. Only the widening below made this true.⟧

**Independence is the contract.** The verifier must not run inside the scoring call: `evidence-reverifier.ts` specifies a pass with no access to the original scorer's reasoning, mirroring `lib/build/verified-finding-review.ts` (which is exposed via `lib/mcp-tools.ts`). Wiring it into `principle_decide` itself would destroy the separation-of-duties property that makes it meaningful.

## 3. Phases

### Phase 1 — repo-backed resolver (this PR)
`lib/decision/locator-resolver.ts` — `createRepoLocatorResolver({ repoRoot, lineWindow })`.

- Reads `code` / `spec` / `doc` locators from a repo checkout. These are the fabricable, verifiable ones.
- **Fail-closed everywhere.** Missing file, unreadable file, path traversal, absolute path, or a source type the resolver cannot reach (`db-query`, `runtime-state`, `tool-output`, `web`, `paper`) all return `resolved: false` → `unresolved` → degrade. Out-of-reach is never evidence of truth.
- Path confinement uses a `root + sep` suffix guard so `/repo-evil` cannot pass for `/repo`.
- A line-anchored `code` citation is scoped to a window around the cited line, so a coincidental match elsewhere in a large file does not confirm an anchor that is wrong.
- Excerpt comparison is whitespace-insensitive (via `excerptSupported`) so reformatting does not false-degrade.

Regression suite `locator-resolver.test.ts` plants fabricated-but-well-formed citations and asserts degradation — written before the module existed.

### Phase 2 — PREREQUISITE: persist the locator (discovered while building phase 1)

**Re-verification cannot run on any decision recorded today, because the locator is discarded at write time.** `kernel-consult-ledger.ts` maps each admissible citation to:

```ts
{ materialId: `${optionId}:${dimensionKey}`,
  sourceType: c.locator.sourceType,   // ← only the STRING survives
  summary:    c.excerpt ?? …,
  effectiveWeight: GRADE_WEIGHT[c.grade] }
```

The `locator` object itself — `filePath`, `line`, `commit`, `path`, `heading` — is dropped. `evidenceDigests` seals a hash into the append-only chain, which proves the recorded evidence was not *tampered with*, but a digest cannot be re-resolved against source, so it cannot prove the citation was ever *true*. Tamper-evidence and truth-verification are different properties; only the former exists today.

Measured on the live install: of 603 `DecisionInteraction` rows, **537 have no sources at all**, and all **66** that do carry `sourceType: "principle"` (internal doctrine references such as `mark-dpf-platform:never-fabricate`) rather than the external `code`/`spec`/`doc` citations Axis 4 exists to re-check.

Phase 2 therefore splits:
- **2a — persist the structured locator** alongside the existing summary (additive; migration-safe), so a recorded decision carries what re-resolution needs. Without this, phases 2b/3 have nothing to verify.
- **2b — independent verification surface.** Load the decision's citations, run `reverifyCitations` with the repo resolver, return the report, and record degraded (option, dimension) pairs. Follows the `verified-finding-review` exposure pattern; an MCP tool carries the known grant/gate cascade (`TOOL_TO_GRANTS` entry required, or the tool is denied).

#### Phase 2a — SHIPPED (this PR)

**No migration.** `DecisionInteraction.sources` is already `Json @default("[]")`, so the locator is carried as additional keys on each source entry. Nothing is tightened, nothing is backfilled, and the change applies against any existing data state because existing rows simply lack the new keys.

**Write.** `citationsToSources` (`lib/decision/evidence-grounding.ts`) becomes the single home for the ledger source shape and now emits `locator`, `grade`, `optionId`, `dimensionKey` and `excerpt` alongside the original `materialId` / `sourceType` / `summary` / `effectiveWeight`. It had been an unused export duplicating a shape the ledger re-derived inline; `kernel-consult-ledger.ts` now delegates to it (and `GRADE_WEIGHT` moved with it) rather than mapping citations itself.

**What is sealed is unchanged.** `SealablePayload` covers `{question, optionIds, criteria, evidenceDigests, recommendedOptionId, composite}`. `sources` was never inside it, so widening the source row does not touch the append-only chain — asserted directly in `recorded-citations.test.ts`.

**Read.** `normalizeSources` (`lib/decision-perspective/persistence.ts`) carries the new keys through, re-running `normalizeLocator` rather than trusting the stored shape: `sources` is jsonb, so the persisted value is whatever some writer put there. A locator that no longer normalizes is dropped to "no locator", never passed through as a checkable citation.

**Decode.** `lib/decision/recorded-citations.ts` — `recordedCitationsFromSources(sources)` returns `{ citations, unverifiable, whollyUnverifiable }`. A pure decoder: it resolves nothing, so it carries no separation-of-duties concern and is **not** wired into `principle_decide`; phase 2b supplies its own resolver.

**Fail-closed, concretely.** A source without a re-resolvable locator is split into `unverifiable` with a reason (`no-locator` for every row on the install today, `malformed-locator`, `no-dimension-binding`) rather than dropped silently — dropping would let "0 citations, 0 failures" read as clean. `reverifyCitations` already refuses to report `allConfirmed` on an empty result set, so an all-legacy decision cannot present as re-verified.

**Not yet closed:** nothing *calls* `recordedCitationsFromSources` in production — that is phase 2b, by design. And a locator only reaches the record when a caller supplies `evidence` to `principle_decide`; phase 2a makes an evidenced call re-verifiable, it does not make callers cite. That second gap is now tracked as **BI-D045A069**.

#### Phase 2b — SHIPPED

`reverify_decision_evidence` (MCP, grant `registry_read`) — `lib/mcp/packs/decision-reverify-pack.ts` over `lib/decision/evidence-reverification.ts`. Loads a recorded decision by `interactionId`, decodes its citations with `recordedCitationsFromSources`, re-resolves each against live source with the phase-1 repo resolver, and reports what still holds.

**A separate tool, not a step in `principle_decide`.** Re-verification only means something without access to the original scorer's reasoning. Grant matches the decision-governance siblings: auditing the evidence behind a decision must not require a higher grant than making the decision did, or the check is less reachable than the thing it checks.

**Three outcomes, deliberately not two — the load-bearing design point.** `reverifyCitations` folds `unresolved` into `degrade`. That is right when the resolver could read the cited artifact and it was not there (fabrication), and catastrophic when the resolver cannot reach source at all: a production install has no checkout (`isDevInstance()` is false), so an unguarded pass would report **every decision ever made** as fabricated evidence. Source reachability is therefore decided *before* anything resolves, and the surface returns:

| outcome | meaning |
|---|---|
| `verified` | every citation that could be checked still resolves and still matches |
| `degraded` | at least one no longer holds — a real finding about the evidence |
| `unverifiable` | nothing could be checked; `unverifiableCause` is `no-source-access` (a deployment fact, **not** a finding) or `no-recorded-locators` (a pre-2a record) |

`coverage` rides alongside, so `verified` is never read as a clean bill of health for the whole decision: a decision with one confirmed citation and four unverifiable ones is `verified` at coverage 1/5, and the tool's own message says so.

**Path guard (security).** A cited `filePath` is attacker-influenced data — it comes from whatever agent made the decision and is echoed back as `liveExcerpt`. Phase 1's resolver confines reads to the repo root, but the repo root legitimately *contains* `.env`, keys and credential files, so an unguarded citation naming one would round-trip its contents to any caller holding `registry_read`. `guardResolverPaths` wraps the resolver with `isPathAllowedSync` — the same blocklist `read_project_file` enforces — and a blocked path fails closed to `unresolved`. Regression-tested against a fixture repo containing a planted secret.

**Deliberately NOT in 2b: recording the verdict.** The plan bullet above says "record degraded pairs"; that is held back to phase 3, for a reason found while building. The decision row is sealed into the append-only hash chain and a write guard forbids mutating sealed fields, so a verdict cannot be written back onto it — it needs its own record, whose shape is determined by how phase 3 consumes a degrade during re-scoring. Inventing that record now would fix the shape before the consumer exists. 2b is read-only and advisory, which is also the cleaner separation-of-duties story.

### Phase 3 — degrade feeds Axis 1
A degraded pair drops the affected dimension to unevidenced on re-scoring, and the decision is flagged. This is what closes the loop with `evidence-grounding.ts`.

## 4. Out of scope

- Raising `evidenceGrade` from deliberation convergence (BI-8192557E phase 2) — blocked on this.
- Criteria accrual and `DeliberationRoleProfile` population (phases 3–4).
- Resolvers for `db-query` / `runtime-state` / `web`; those need surface-specific resolvers and stay fail-closed until then.

## 5. Verification

- Unit: `pnpm --filter web exec vitest run lib/decision/locator-resolver.test.ts` (phase 1), `lib/decision/recorded-citations.test.ts` (phase 2a), and `lib/decision/evidence-reverification.test.ts` + `lib/mcp/packs/decision-reverify-pack.test.ts` (phase 2b).
- Production build: `pnpm --filter web build`.
- No UI surface in phase 1 or 2a, so no UX verification path; no migration in either.

Phase 2a's round-trip test is deliberately end-to-end rather than a decoder unit test: it drives a real `recordKernelConsultInteraction` write, pushes the row through `JSON.parse(JSON.stringify(...))` (the jsonb boundary — anything that does not survive serialization is not actually persisted), reads it back through `decisionInteractionRowToEvaluation`, and re-verifies with the real repo resolver against a temp checkout. It asserts a genuine citation confirms, a fabricated-but-well-formed one degrades, a real file lacking the recorded excerpt degrades, and a legacy four-field row reports `unverifiable` rather than confirmed.
