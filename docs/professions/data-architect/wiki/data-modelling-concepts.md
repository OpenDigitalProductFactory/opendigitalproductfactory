---
title: Data Modelling Concepts
pageKind: entity
status: published
abstract: A data model describes the entities a system stores, their attributes, and the relationships between them, expressed at three levels — conceptual, logical, and physical. Keys and cardinality make the relationships precise and enforceable.
sources:
  - postgresql/data-definition
---

## Definition

A data model is a structured description of the data a system holds: the things it stores (**entities**), the facts recorded about each thing (**attributes**), and how those things relate to one another (**relationships**). A good model is the single agreed vocabulary that application code, reports, and integrations all build on, so it is designed before the schema is written, not reverse-engineered from it.

## The Three Levels

Data modelling proceeds through three progressively more concrete levels (the ANSI/SPARC three-schema idea):

| Level | Answers | Audience | Example artefact |
|-------|---------|----------|------------------|
| **Conceptual** | *What* things and relationships exist in the business? | Stakeholders | "A Customer places many Orders; each Order contains many Products." |
| **Logical** | *Which* attributes, keys, and cardinalities, independent of any engine? | Architects | Entity-relationship diagram with attributes and keys, normalised |
| **Physical** | *How* is it stored in a specific engine? | Engineers | PostgreSQL tables, columns, types, indexes, constraints |

The conceptual model is technology-neutral; the physical model is where it becomes concrete DDL. In PostgreSQL, the physical model is realised with `CREATE TABLE`, column data types, and constraints.

## Building Blocks

- **Entity** — a thing the system tracks (Customer, Order, Product). Becomes a table.
- **Attribute** — a fact about an entity (an Order's `placed_at`, `total_cents`). Becomes a column with a **data type** that constrains its allowed values. Choosing the narrowest correct type (`timestamptz` over `text` for a time, `numeric` over `float` for money) is the first line of data integrity.
- **Relationship** — an association between entities (an Order *belongs to* a Customer). Realised with a **foreign key**.

## Keys

- **Primary key (PK)** — the column(s) that uniquely identify each row. Every entity needs one. Prefer a stable surrogate key (an `id`) over a natural key that may change.
- **Foreign key (FK)** — a column that references another table's primary key, making a relationship enforceable: the database rejects an Order that points at a non-existent Customer. FKs are what turn a pile of tables into a connected model.
- **Unique constraint** — enforces that a business identifier (an email, an SKU) appears at most once.

## Cardinality

Cardinality states how many rows on each side of a relationship may participate:

- **One-to-many** (a Customer has many Orders) — the most common; the FK lives on the "many" side (`orders.customer_id`).
- **One-to-one** — model as a shared key or a unique FK.
- **Many-to-many** (Orders contain many Products; Products appear in many Orders) — resolved with a **junction table** (`order_line`) carrying a FK to each side.

## Why It Matters

A model that names entities and enforces relationships with keys and constraints pushes integrity into the database, where it holds regardless of which service writes the data. A model that lives only in application code drifts: two services disagree about what a "customer" is, orphaned rows accumulate, and reports silently double-count. The data architect's job is to make the model explicit and let the engine enforce it.

## See Also

- [[professions/data-architect/normalisation-and-denormalisation]]
- [[professions/data-architect/sql-injection]]
