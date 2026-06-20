---
title: Normalisation and Denormalisation
pageKind: entity
status: published
abstract: Normalisation organises columns into tables so each fact is stored once, eliminating update anomalies; the standard target is third normal form (3NF). Denormalisation deliberately reintroduces redundancy for read performance, accepting the cost of keeping copies consistent.
sources:
  - postgresql/data-definition
---

## Definition

Normalisation is the process of structuring a relational schema so that each fact is recorded in exactly one place. It is driven by **functional dependencies** — statements that one column's value determines another's — and proceeds through a series of **normal forms**, each removing a class of redundancy and the **anomalies** redundancy causes.

## Why Redundancy Is a Defect

If a customer's address is copied onto every one of their orders, the database has three problems:

- **Update anomaly** — changing the address means updating every order row; miss one and the data contradicts itself.
- **Insertion anomaly** — you cannot record a customer until they have placed an order to hang the address on.
- **Deletion anomaly** — deleting the last order erases the only copy of the address.

Normalisation removes these by giving each fact one home, referenced by a foreign key.

## The Normal Forms

| Form | Rule | Removes |
|------|------|---------|
| **1NF** | Each column holds a single atomic value; no repeating groups or arrays-as-columns. | Multi-valued cells |
| **2NF** | 1NF *and* every non-key column depends on the **whole** primary key (matters only for composite keys). | Partial-key dependencies |
| **3NF** | 2NF *and* no non-key column depends on **another non-key column** (no transitive dependencies). | Transitive dependencies |
| **BCNF** | A stricter 3NF: every determinant is a candidate key. | Remaining key anomalies |

**3NF is the default target.** The informal summary — every non-key column depends on "the key, the whole key, and nothing but the key" — captures 1NF→3NF. In PostgreSQL each resulting table is a `CREATE TABLE` with a primary key, and the dependencies between them are enforced with foreign-key constraints.

## Denormalisation

Denormalisation is the **deliberate** reintroduction of redundancy to make reads cheaper — pre-joining data, caching a computed total, or duplicating a label onto a child row to avoid a join on a hot read path. It is a trade, not a shortcut:

- **Gain:** fewer joins, faster reads, simpler queries for reporting/analytics.
- **Cost:** every duplicated value must be kept in sync on write — via application logic, triggers, or a scheduled rebuild. Stale copies are the exact anomaly normalisation removed.

Denormalise only when a measured read pattern justifies it, and make the synchronisation mechanism explicit. A common discipline: keep the **normalised model as the source of truth** and derive denormalised read structures (materialised views, summary tables) from it, so the copies are regenerated rather than hand-maintained.

## Rule of Thumb

Normalise until it hurts (read performance on a proven hot path), then denormalise until it works — and write down why, so the redundancy is a recorded decision rather than accidental drift.

## See Also

- [[professions/data-architect/data-modelling-concepts]]
- [[professions/data-architect/parameterized-queries-commandment]]
