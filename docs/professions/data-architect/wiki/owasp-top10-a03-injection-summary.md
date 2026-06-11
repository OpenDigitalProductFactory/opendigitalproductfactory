---
title: OWASP Top 10 A03:2021 — Injection (Summary)
pageKind: summary
status: published
abstract: Distilled summary of OWASP A03:2021 Injection. SQL injection remains in the top three global web security risks. Prevention centers on structural separation of code and data via parameterized queries.
sources:
  - owasp/top10-a03-injection
  - owasp/sql-injection-prevention
  - owasp/query-parameterization
---

## What This Source Says

OWASP A03:2021 — Injection covers SQL injection, NoSQL injection, OS command injection, ORM injection, LDAP injection, and Expression Language injection. It is the third most critical web application security risk in the 2021 edition (merged with "Cross-Site Scripting" from 2017's A01 and A07).

**Vulnerability indicators** (OWASP direct):
- User-supplied data is not validated, filtered, or sanitized
- Dynamic queries are constructed without parameterization
- Hostile data is used in ORM search parameters to extract additional records
- Malicious input is directly used or concatenated in SQL, OS commands, or other interpreters

**Prevention** (OWASP priority order):
1. Parameterized queries / prepared statements — the preferred control
2. Stored procedures (safe implementations only)
3. Positive server-side allow-list input validation — not sufficient alone
4. Escape special characters for the specific interpreter — last resort

**Key constraint**: "SQL structures such as table names, column names, and sort order cannot be escaped." Dynamic structure requires allow-list validation.

**Detection tooling**: source code review + automated testing of all parameters (headers, cookies, JSON, XML, form fields). SAST, DAST, and IAST tools should be integrated in the CI pipeline.

## Standing Judgment

This is a commandment-tier finding for the data-architect profession. A03:2021 has appeared in every OWASP Top 10 edition. Parameterized queries are the non-negotiable first control.

For DPF coworkers:
- Any code generation or review involving SQL must apply [[professions/data-architect/parameterized-queries-commandment]]
- Defense in depth requires [[professions/data-architect/least-privilege-db-access]]
- Any raw query using string concatenation is a blocking finding, not a warning
