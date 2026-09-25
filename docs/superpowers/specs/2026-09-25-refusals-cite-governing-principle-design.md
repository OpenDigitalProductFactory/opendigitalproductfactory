---
status: active
---

# A refusing gate names the principle that governs it

Backlog item: BI-DEDAC950 (epic EP-AUTONOMOUS-DECIDE).

## 1. Problem

When a gate refuses, the agent that hit it gets prose: which tool to call
next, never which rule required it. From 2026-09-22 to 09-24 one session
spent two days inferring escalation doctrine from `directional-outcome.ts`,
and proposed rebuilding a rule PR #5291 had already shipped. The rule was
published as `principles/escalation-is-a-gate-not-a-trust-tier` and one
`wiki_query` away. Nothing at the point of refusal pointed to it. The fix
belongs in the process, not in memory or in a new page restating an existing
rule (founder, 2026-09-24).

## 2. What exists (substrate verification, origin/main 99ca786b)

- **Precedent.** `apps/web/lib/kernel/runtime-gate.ts:43-57`: `GateDecision`
  carries `principleSlug` (from `wikiPage.slug`) on both `refuse` and
  `require_confirm`. `mcp-tools.ts:614-645` returns it as
  `data.kernelGate.principleSlug`. The field name and the slug form (the DB
  `wikiPage.slug`, the same string `wiki_query` returns) are settled. This
  design copies both.
- **Readiness.** `READINESS_CODES` (`initiative-readiness/types.ts:36-64`,
  27 codes). `GENERIC_REMEDIES` (`readiness-guidance.ts:161-206`) is a
  `Record<ReadinessCode, string | null>` that is total by construction. Its
  comment says `null` is a decision, not a gap. A second total table keyed the
  same way is the natural home for citations.
- **A constraint that shapes the design.** Readiness decisions are compared by
  deep equality against replayed terminal decisions (`evaluate.ts:235-237`).
  A new key on every requirement record would invalidate every persisted
  decision, so the citation cannot live inside the decision.
- **Decision ladder.** `decision-perspective/directional-outcome.ts` has six
  escalate branches (`:50-131`). None of them has a slug.
- **Alignment gate.** `tak/alignment-tool-gate.ts:7-15` defines
  `AlignmentGateDecision`, which has no slug. The refusal is built in
  `tak/preexecution-control.ts:117-134`.
- **Pages.** Slugs come from `packages/db/src/seed-wiki-kernel.ts:454`:
  frontmatter `slug:` when present (42 of 111 kernel pages, bare form),
  otherwise `deriveSlug`, which gives `principles/<name>`. Profession pages
  use `professions/<p>/<name>`. A page is published when its frontmatter
  `status` is `published` or absent (`seed-wiki-kernel.ts:455`). No check
  anywhere verifies that a cited slug resolves.
  `canonical-primitives.ts:25/59` already cites a slug that does not resolve
  in the form it states. That is exactly the drift this design prevents.
- **Drift guard precedent.** `govern/authority/escalation-gate.conformance.test.ts`
  checks that each rule string the gate exports appears verbatim in its page.

**One correction to the brief.** `escalation-is-a-gate-not-a-trust-tier`
governs `resolveEscalation`, the approval envelope for coworker actions. It
does not govern the decision ladder in `directional-outcome.ts`. That
mismatch is BI-74B2A8CD. This design cites the page only where it truly
governs, and it records the rest as unwritten rules (§3.3) instead of papering
over them.

## 3. Design

### 3.1 One citation table per gate family

`apps/web/lib/kernel/governing-principles.ts` exports:

- `READINESS_GOVERNING_PRINCIPLE: Record<ReadinessCode, string | null>`, total
  like `GENERIC_REMEDIES`. `null` means no page states the rule the code
  enforces.
- `DIRECTIONAL_ESCALATION_PRINCIPLE`, keyed by the escalate branch's reason.
- `ALIGNMENT_REFUSAL_PRINCIPLE`, keyed by alignment refusal code.

Proposed readiness citations (every page exists on `origin/main`):

| Code(s) | Slug |
|---|---|
| `CLASSIFICATION_REQUIRED` | `principles/classify-ambiguous-requests-before-acting` |
| `RESEARCH_REQUIRED` | `principles/design-research-required` (feature), `principles/research-before-implementing` (fix): profile-aware, like `requirementNextAction` |
| `CANONICAL_DESIGN_REQUIRED`, `SPEC_APPROVAL_REQUIRED`, `REVIEW_REQUIRED`, `REVIEW_FAILED`, `PLAN_REVIEW_REQUIRED` | `principles/governance-approves-evidence-not-provenance` |
| `DELIVERY_EVIDENCE_REQUIRED` | `principles/build-gate-mandatory` |
| `ACCEPTANCE_EVIDENCE_REQUIRED` | `principles/submitting-work-is-not-accepting-it` |
| `CAPSULE_IDENTITY_MISMATCH` | `principles/claim-a-workroom-before-you-work` |
| `DECOMPOSITION_REQUIRED`, `POST_IMPLEMENTATION_REVIEW_REQUIRED` | `principles/gates-proportional-to-shape` (resolved to its frontmatter slug) |
| `ARTIFACT_AUTHOR_REQUIRED` | `principles/dco-sign-off-required` (resolved to its frontmatter slug) |
| `READINESS_PROJECTION_FAILED` | `principles/make-silent-failures-observable` |

Codes with no page stay `null`: `CANONICAL_DESIGN_AMBIGUOUS`,
`BLOCKING_FINDINGS_OPEN`, `PLAN_REQUIRED`, `PLAN_COVERAGE_REQUIRED`,
`TRACEABILITY_INCOMPLETE`, `DEPENDENCY_UNRESOLVED`, `AUTHORIZATION_DENIED`,
`OBJECTIVE_BASELINE_*`, `OBJECTIVE_RECONCILIATION_REQUIRED`, `STALE_EVIDENCE`,
`ARCHETYPE_*`. The implementation re-checks every row against the page text
before committing it. The table in this section is the proposal, and the test
in §3.4 is the arbiter.

### 3.2 Where the citation travels

The citation rides **beside** the decision, never inside it (the replay
constraint in §2). A pure `governingPrinciplesFor(decision)` returns
`{ [code]: slug }` for every unmet or blocking code that has a page. It is
attached as `governingPrinciples` wherever a readiness decision leaves the
server as a refusal or a read:

- the claim refusal (`work-capsules/governed-work-claim.ts:521-527`,
  `data.readiness`);
- the terminal-status refusal (`backlog/mcp-terminal-status.ts:59-64`);
- the backlog read projection (`backlog-pack-read-tools.ts`,
  `readiness.decisions.*`).

Each tool's refusal message gains one line: `Governing rules:
<code> → <slug>, … (wiki_query slug)`. An agent that reads only the message
still reaches the rule in one lookup, with no separate research step.
Output schemas are `additionalProperties: true` (`backlog-pack-definitions.ts:158-167`),
so no tool contract changes.

`DirectionalOutcomeResult` and `AlignmentGateDecision` gain an optional
`principleSlug`, the runtime-gate field name, set from their tables. These
results are not replayed by deep equality, so the field goes on the result
itself, the same as the runtime gate. The alignment refusal copies it into
`data.principleSlug`.

### 3.3 Unwritten rules are the finding

A `null` citation means a gate enforces a rule no page states. The test in
§3.4 prints that inventory and ratchets it: the count of `null` entries may
fall, never rise. A new gate code must either cite a page or be added
knowingly to the inventory. The directional-outcome branches for lexical
fallback, mixed stance and low confidence start in the inventory. Resolving
them is BI-74B2A8CD's work, and the ratchet makes that visible rather than
prose.

### 3.4 The citation is load-bearing

`governing-principles.test.ts`:

1. Every non-null slug resolves to exactly one page file under
   `docs/founder-kernel/wiki/principles/` or `docs/professions/*/wiki/`,
   using the seeder's own slug rule. `deriveSlug` and the frontmatter
   `slug:` rule are exported from `packages/db` for reuse, never re-implemented.
2. That page is published (`status` is `published` or absent), is a
   `principle`, and has a non-empty `## Rule` section.
3. The `null` count ratchet (§3.3).
4. The readiness table is total over `READINESS_CODES`, enforced by the type
   and asserted at runtime.

The existing escalation conformance test keeps checking rule text for the page
it owns. Extending that verbatim-rule check to every cited page would require
each gate to export rule strings it does not have. Instead, §3.4.1-2 make every
cited page exist, be published and state a rule, and §3.3 makes the absence of
a page visible. That is the drift guard at the altitude the citation needs.

Also fixed while here: `canonical-primitives.ts:59` cites
`compose-report-kit-for-reporting-ux` in a form that resolves to nothing. It
moves to `professions/frontend-engineer/compose-report-kit-for-reporting-ux`
and joins test 1.

## 4. Research and benchmarking

| System | Mechanism | DPF adopts | DPF rejects |
|---|---|---|---|
| Open Policy Agent / Gatekeeper | Deny messages carry the constraint name, and policies carry metadata (`title`, `description`, `url`) | A refusal names its governing policy by a stable id | Free-form URL metadata. The slug is resolved and tested |
| ESLint / Ruff | Every diagnostic carries a rule id, and the id resolves to a docs page (`meta.docs.url`) | The id with every refusal, and a resolvable page | Nothing |
| RFC 9457 (Problem Details for HTTP APIs) | `type` is a URI that identifies the problem kind and dereferences to documentation | The standard shape: a machine-readable identifier alongside the human `detail` | Full RFC 9457 envelopes. DPF's MCP refusals keep their shape and add one field |

Standard followed: a stable, dereferenceable rule identifier on every
refusal. This is the pattern the linters and RFC 9457 share.

## 5. Acceptance criteria

- **AC-GP-01** Every readiness refusal (claim, terminal status, read
  projection) carries `governingPrinciples` for each unmet or blocking code
  that has a page, and the message names them.
- **AC-GP-02** Directional-outcome escalations and alignment refusals carry
  `principleSlug` where a page governs them.
- **AC-GP-03** A test proves that every cited slug resolves to a published
  principle page with a `## Rule`, using the seeder's slug rule.
- **AC-GP-04** The unwritten-rule inventory is printed and ratcheted.
- **AC-GP-05** Live: a claim refused on the dev install returns
  `governingPrinciples`, and `wiki_query` on each returned slug yields that
  page as the top hit.

## 6. Delivery

One PR. There is one table module, and the touch points are the three
refusal/read surfaces plus two result types. Each edit is additive and reverts
cleanly.
