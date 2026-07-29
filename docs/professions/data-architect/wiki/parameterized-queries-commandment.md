---
title: Parameterized Queries — Commandment
pageKind: principle
status: published
abstract: Parameterized queries (prepared statements) are the mandatory control for all database interactions; they physically separate code from data and eliminate the SQL injection attack surface at the protocol level.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Always parameterize; never concatenate user-supplied input into SQL strings.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "public_safety": 1.0, "blast_radius": -0.9}
sources:
  - owasp/sql-injection-prevention
  - owasp/query-parameterization
---

## Rule

Always use parameterized queries or prepared statements for every database interaction. Never build SQL strings by concatenating user-supplied input.

The database engine physically separates the query structure (code) from the parameter values (data). No matter what a user provides as input — `' OR '1'='1`, `'; DROP TABLE users;--`, anything — it cannot be interpreted as SQL. The attack surface is eliminated at the protocol level, not by filtering.

## Why

String concatenation produces a single string where code and data are intermixed. The database parser cannot distinguish between the two. A user who controls input controls the query.

Parameterized queries send code and data in separate protocol channels. The database parses the structure once (or caches it), then binds the parameter values as typed data. The user's input is always data — never structure.

OWASP SQL Injection Prevention Cheat Sheet establishes the hierarchy:
1. **Parameterized queries** with prepared statements — eliminates injection at protocol level
2. Stored procedures (safe implementations only)
3. Allow-list input validation (for cases where 1 is unavailable, e.g. table/column names)
4. Character escaping — last resort; dialect-specific and error-prone

The top-level choice is not a preference; it is a commandment. SQL injection is OWASP A03:2021 — the third most critical web application security risk globally.

## Applies To

Data architects, software engineers, and any AI coworker generating or reviewing code that touches a relational database. Does NOT vary by language — every major language has parameterized query support. Does NOT vary by "this is an internal tool" or "we trust the input" — the commandment applies universally.

## How To Apply

Before reviewing or generating any code path that constructs a database query:

1. **Verify parameterization.** Does the query use `?`, `$1`, `:param`, or the ORM's equivalent? If it uses string concatenation or interpolation, it is wrong.
2. **Check all parameters.** Every user-controlled value (request params, headers, cookies, uploaded content, form fields) must be bound as a parameter.
3. **Table/column names cannot be parameterized.** If a query selects a table or column by name dynamically (e.g., user chooses report column), use an allow-list. Never interpolate table/column names from user input.
4. **ORMs use safe APIs.** Prisma `.findMany({ where: { ... } })` is safe. Raw query strings via `$queryRaw` with user input are not, unless the user input is bound as a parameter.

## Examples

```typescript
// Correct — parameterized
const user = await db.user.findUnique({ where: { id: userId } });

// Correct — Prisma raw with binding
const result = await db.$queryRaw`SELECT * FROM users WHERE id = ${userId}`;

// Wrong — string interpolation in raw query
const result = await db.$queryRaw(Prisma.sql([`SELECT * FROM users WHERE id = ${userId}`]));
// ↑ This passes userId as a string literal into the SQL template — injection risk.
```

## See Also

- [[professions/data-architect/least-privilege-db-access]]
- [[professions/data-architect/sql-injection]]
