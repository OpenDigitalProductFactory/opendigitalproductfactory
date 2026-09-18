---
status: draft
---

# Governed `retract_stance` — an auditable, agent-executable path to retire a WWWD overlay stance (BI-BD9DEC45)

Design author: Claude Opus 4.8, on a software-platform operate-organization install, 2026-09-18.
Epic: EP-DECISION-TIER-REBALANCE. Backlog item: BI-BD9DEC45.

## 1. Problem

When six field-service privacy stances were ruled into a **software-platform** install's WWWD overlay
(a category error — the install does not run field service), there was no governed way to retire them.
Verified three ways this program: (a) no agent MCP tool exists — a tool search for retire/archive/supersede
returns only read surfaces (`list_wiki_overlay_drafts`, `wiki_lint`, `wiki_query`); (b) the only retirement
path is the browser stance editor (`/coworker-decisions/edit/stances/<slug>` → status dropdown
draft/published/review-needed/**archived** → save), which the client shared-resource guard correctly
refuses to an agent because it is an ungoverned direct write to governance material; (c) so retirement is a
manual, per-page owner action with **no reason capture, no scope re-homing, no audit trail** tying the
retirement to the decision that motivated it.

This reproduces on **every deployment**: thin/immature WWWD corpora are expected early (see BI-7728C3B7),
so every install accrues mis-scoped or obsolete stances, and an agent that mis-homes a stance **cannot undo
its own mistake** — the correction requires the owner, so the error hardens into `ruled`-tier doctrine.
It is the write-side counterpart to BI-13C38318 (retract obsolete *decisions*): decisions and the stances
they crystallise into should retire the same governed way.

## 2. Goal

A governed MCP tool, `retract_stance`, that archives an overlay stance page **with a required reason** and
an optional re-home/supersede pointer, enforced by the tool's own authority check (not only the client
guard), and written as a first-class `ToolExecution` + governance activity — so a retirement is auditable,
reason-bearing, and reversible, and an agent can clean up its own mis-attributions under proper authority.

## 3. Design

### 3.1 The tool

```
retract_stance({
  slug: string,                 // overlay stance page slug, e.g. "stances/ruling-di-2adf8cfee82a"
  reason: string,               // REQUIRED — mis-scoped-archetype | obsolete-routing-basis | superseded | <free text>
  supersededBy?: string,        // optional slug of the stance that replaces it
  reHomeToArchetype?: string,   // optional archetype category/slug the intent should be re-seeded into
})  // batch form: retract_stances({ items: [...], reason }) for a named set in one authorised action
```

Effect: sets the org-overlay `WikiPage.status` for `(organizationId, slug)` from `published` (or
`review-needed`) to `archived`, via the existing `@dpf/db/wiki-store` `upsertWikiPage` + `appendRevision`
path (idempotent, revision-appending — bytes preserved, never destroyed), and de-indexes it from the WWWD
retrieval set (the same `storeWikiPage`/embedding path used at seed time, inverse operation) so an archived
stance stops influencing `recallWikiContext`. Records a `ToolExecution` and a governance activity row
carrying `slug`, `reason`, `supersededBy`, `reHomeToArchetype`, actor, and the prior status.

### 3.2 Authority — the tool enforces it, not the client guard

- An **owner-authored `ruled`-tier** stance requires **owner authority** (or an explicit owner-delegated
  grant). The tool checks the caller's grant intersection against the page's tier and refuses a non-owner
  retract with `insufficient_authority` — a §1 refusal, reported as skipped, never routed around. This is
  the key improvement over today: the *only* current backstop is the client shared-resource guard, which is
  surface-specific; the governed tool makes the authority check **server-side and universal**, so every
  surface (CLI, portal, Build Studio) inherits it.
- A **platform-default / unconfirmed** overlay page (seeded, never owner-ruled) may be retracted by an
  admin/development caller — these are editable starters, not doctrine.
- Retraction is **reversible**: `archived` is a status, not a delete; a later `publish`/edit restores it.
  The tool never hard-deletes governance content.

### 3.3 Re-home, not lose

When `reHomeToArchetype` is set, the tool records the intent pointer on the archived page and (once
BI-7728C3B7 lands) hands the content to the archetype baseline seeder so the doctrine is preserved in its
correct home rather than lost. Until then it records the pointer for the owner/steward to action — the
retirement is never a silent disappearance.

## 4. Research & Benchmarking

- **Git / content-addressable version control** — the "never delete, append a tombstone revision" model.
  Adopt: archive is a new revision with a status transition, prior bytes preserved (`appendRevision`),
  reversible. Reject a hard delete.
- **RFC "Obsoletes"/"Supersedes" headers & W3C document status (WD → NOTE)** — the standards-world pattern
  of retiring a document by *status transition with a pointer to its successor*, not removal. Adopt:
  `status: archived` + `supersededBy`, so the audit trail shows *why* and *what replaced it*.
- **Kubernetes finalizers / soft-delete with reason** — controlled deletion gated on a recorded reason and
  an owner. Adopt: `reason` is required; owner authority gates `ruled` tier. Reject the async finalizer
  machinery as overkill for a single governance page.
- **DPF-internal precedent (reuse):** BI-13C38318's decision-retraction primitive and the existing
  `upsertWikiPage`/`appendRevision`/`storeWikiPage` overlay-write path. `retract_stance` is the stance-side
  peer of the same retraction concept, reusing the same store — no parallel write path (AGENTS.md §1, §8).

## 5. Verification

- An admin/owner (or owner-delegated agent) retracts a named stance via MCP; the page goes `archived`, the
  reason is visible in the stance list, a governance activity row is written, and it stops influencing WWWD
  retrieval.
- A non-owner agent's retract of a `ruled` stance is refused by the tool's own authority check (asserted in
  a test), not only the client guard.
- Reversibility: a retracted stance can be re-published; its prior revision bytes are intact.
- Backfill: the six field-service rulings (ruling-di-2adf8cfee82a, -2212a7571020, -f1666b2e39ba,
  -0bba6d485e4f, -6019399f3422, -a572f57b3764) retract in one authorised batch with reason
  "mis-scoped: field-service doctrine in a software-platform WWWD," content preserved (already archived
  in-portal this program; this tool makes that repeatable and auditable for the next install).

## 6. Phased delivery (backlog coverage)

- **Phase A** — `retract_stance` single-slug tool: status transition + de-index + authority check + audit
  row + tests. (This BI-BD9DEC45.)
- **Phase B** — batch form `retract_stances` + `supersededBy`/`reHomeToArchetype` pointers.
- **Phase C** — wire the re-home hand-off to the BI-7728C3B7 archetype baseline seeder (dependency).

## 7. Hand-off (honest)

Same structural ceiling as every net-new capability: this needs an **independent spec-approval reviewer**
(not the design author), then plan + independent plan-review, then TDD implementation, local-CI, PR, merge,
and deploy via self-upgrade. A single build session authors and commits this design and hands to that
review — it cannot self-approve or self-deploy.
