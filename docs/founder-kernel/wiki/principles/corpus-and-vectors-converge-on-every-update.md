---
title: Corpus and Vectors Converge on Every Platform Update
slug: corpus-and-vectors-converge-on-every-update
pageKind: principle
status: published
abstract: Kernel and profession pages are the doctrine coworkers steer by, and coworkers find them through their vectors. Every platform update must leave each published page with a vector built from the text that page carries now. A page whose wording changed is re-embedded; an unchanged page is not. Convergence is automatic, resumable and reported, never a manual step.
principleTier: core
principleDirection: Key every corpus vector to a digest of the text it was built from, and on every platform update re-embed each published page whose digest changed, automatically, resumably and with a visible report of what was refreshed and what is still stale.
principleDimensionVector: {"long_term_maintainability": 0.8, "evidence_density": 0.9, "governance_compliance": 0.7, "mission_fit": 0.8, "operator_effort": -0.8, "speed_to_value": -0.1}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters rely on DPF's AI coworkers deciding from the current version of the organization's recorded doctrine. They need to know an update cannot leave coworkers retrieving an older wording.
authoredAt: 2026-11-12
authoredBy: mark-bodman
---

# Corpus and Vectors Converge on Every Platform Update

## Rule

1. **A vector stands for specific text.** Every vector for a wiki page records a digest of the exact text it was built from.
2. **Changed text gets a fresh vector.** After every platform update, each published kernel (WWMD) and profession (WSID) page whose current text no longer matches its vector's digest is re-embedded. Pages with no vector are embedded too.
3. **Unchanged pages are left alone.** Matching digests mean the vector is current, so it is not rebuilt.
4. **No step depends on a person.** Convergence runs at upgrade boot and on a schedule. If it is cut short by a restart, a time budget or a busy model, the next run resumes from the digests, with no saved progress to lose.
5. **Convergence is visible.** Each run reports what it refreshed, what failed and what is deferred. A freshness check lists every stale page by name. A non-fatal failure is reported and retried, never silent.
6. **A precomputed vector never replaces a current one.** A shipped vector sidecar may fill a page that has no vector. It may not overwrite a vector already built from the page's current text.

## Why

The owner said on 2026-11-04: "With the corpus and vectors we need to make sure that platform updates carry this through. Part of the kernel for platform operations."

Expert coworkers find the doctrine they steer by through its vectors ([[principles/expertise-compounds-in-profession-coworkers]]). If a release edits a page but keeps its old vector, the coworker still finds the page by its superseded wording. It can then miss the page or match it to the wrong question, while everything appears healthy. Before this rule, the upgrade self-heal only checked whether each page had a vector. On 2026-11-12 the production install had 432 published pages and 440 vectors. None recorded which text it came from, and the stored previews of five vectors no longer matched their pages.

## How to apply

1. **Writers stamp the digest.** Any code that writes a `wiki-pages` vector uses the shared digest (`packages/db/src/wiki-embedding-digest.ts`) and the same embedding text.
2. **Do not add a parallel indexer.** Extend the existing reconcile (`apps/web/lib/wiki/embedding-reconciliation.ts`). It runs at upgrade boot through `scripts/portal-migrate-boot.sh` and on the embedding-coverage schedule, and reports into the corpus-health Workroom.
3. **Check freshness before claiming it.** Run `reembed-wiki-store.ts --check`. It names each stale or missing page and exits non-zero while any remain.
4. **Changing what is embedded means bumping the digest version**, so every page re-embeds once instead of keeping vectors built from the old text shape.

## Related principles

- [[principles/seed-is-bootstrap-runtime-is-truth]] covers seeded calibration. This principle covers the corpus and its vectors, which must follow every shipped edit.
- [[principles/expertise-compounds-in-profession-coworkers]] makes profession corpora the knowledge experts decide from. Their vectors must stay current for that to work.
- [[principles/learnings-belong-in-the-shared-commons]] routes learnings into these corpora. Once a learning lands there, coworkers can retrieve it in its current form.
