---
title: Master Data Management — What It Does and Does Not Do
pageKind: entity
status: published
abstract: Master Data Management (MDM) resolves duplicate and conflicting records into a single trusted version after they exist. It is a reconciliation discipline, not a prevention one — it does not stop duplicates from being created, and it is not a new database. Knowing its boundary prevents both over-reaching ("route everything through MDM") and the false comfort of assuming a write-time dedup gate cannot fail.
sources:
  - dama-dmbok/master-data-management
---

## The one sentence to remember

**MDM resolves duplicates after the fact — it does not prevent their creation.**

Master Data Management is match, merge, and survivorship over records that already exist. It is a cleanup and reconciliation discipline. Preventing a duplicate from being written in the first place is a *separate* mechanism (a write-time dedup gate, a `UNIQUE` constraint), and — critically — that prevention can fail independently of MDM. Treating MDM as if it prevents duplicates is how an install accumulates dozens of them while everyone assumes "MDM has it covered."

## What MDM is

- **Match** — decide, by scoring candidate records against configured rules, whether two rows describe the same real-world entity.
- **Merge** — collapse matched records, choosing a survivor and repointing references.
- **Survivorship** — the policy for which field values win when records are merged.
- **Crosswalk** — the durable record that "these source keys all map to this canonical entity", so a merge can be explained and undone.

## What MDM is NOT

- **Not a new table.** The canonical record stays in its existing Prisma model (`CustomerAccount`, `CustomerContact`, `CustomerSite`). MDM does not introduce a parallel "golden record" store; it governs the models you already have.
- **Not a duplicate *preventer*.** It reconciles duplicates that already exist. Prevention is the write-time dedup gate and the database `UNIQUE` constraint — different code, different failure modes.
- **Not a generic relation-walker.** DPF's merge engine is deliberately **domain-bound** to `customer-account` / `customer-site` / `customer-contact` by a ratified kernel decision. A generic DMMF-driven merge (walk every foreign key automatically) was scored **3.17 vs 4.52 and rejected**, because soft references that carry no foreign-key relation would be silently orphaned by an automatic walker. Adding a new merge domain is a deliberate act with hand-enumerated inbound references, not a config toggle.

The full contract lives in code at `apps/web/lib/mdm/domain-registry.ts` — a comment block most developers never open. This page exists so the contract is retrievable as practice rather than buried in source.

## Merge policy: tombstone, never hard delete

A merge **quarantines** the losing record (renames its natural key into a reserved namespace and marks it retired / superseded); it never hard-deletes. The tombstone stays for audit and for unmerge. Deletion of a regulated record is a separate, deliberately-governed action, never a side effect of a merge or a retention sweep.

## The corollary that bites: prevention shares the constraint's failure mode

The write-time dedup gate is supposed to be the backstop that catches a duplicate the `UNIQUE` constraint missed. But its candidate lookup is **a database query**, and the constraint is enforced **by an index**. If that index is corrupt — for example after a collation-provider change (see [[professions/data-architect/index-and-collation-integrity]]) — then an equality probe descends the wrong subtree, returns zero candidates, and the gate reports "clear" for a record that already exists. The constraint fails to reject the insert for the *same* reason. Both backstops fail together on the same input.

Practical rule: a dedup gate is only as trustworthy as the index under it. Make the gate's candidate lookup read the true heap (force a heap scan) so a stale index cannot defeat it, and detect index/heap divergence on a schedule rather than by noticing duplicate rows in a UI.

## When to reach for MDM, and when not

- **Business master data** (customers, sites, contacts) with real-world duplicates → MDM match/merge/survivorship is the right home.
- **Platform runtime/config data** (agents, model profiles, skills, taxonomy) → NOT MDM. These are deduped by exact-key integrity repair and prevented by correct constraints, not by a match-scoring hub. The MDM alignment spec explicitly excludes "a generic MDM product implementation" and "replacing domain-specific business rules with a generic data hub".

## Related

- [[professions/data-architect/index-and-collation-integrity]] — why a `UNIQUE` constraint can silently stop rejecting duplicates.
- [[professions/data-architect/dedupe-migration-means-the-constraint-is-wrong]] — the rule to apply before writing a dedupe migration.
- [[professions/data-architect/schema-migration-practices]] — general migration discipline.
