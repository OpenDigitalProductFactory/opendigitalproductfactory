---
title: SQL Injection
pageKind: entity
status: published
abstract: SQL injection is an attack where untrusted input is interpreted as SQL structure, allowing attackers to manipulate queries, extract data, bypass authentication, or execute arbitrary commands.
sources:
  - owasp/top10-a03-injection
  - owasp/sql-injection-prevention
---

## Definition

SQL injection (SQLi) is an injection attack where user-supplied data is inserted into a SQL query string in a way that changes the query's structure or intent. The database engine cannot distinguish between the injected code and the intended query because both arrive as part of the same string.

**OWASP A03:2021 — Injection** ranks SQL injection among the highest-impact web application vulnerabilities globally.

## Mechanism

A vulnerable application builds queries like this:
```
SELECT * FROM accounts WHERE custID = '<user_input>'
```

An attacker supplies: `' OR '1'='1`

The resulting query becomes:
```sql
SELECT * FROM accounts WHERE custID = '' OR '1'='1'
```

Since `'1'='1'` is always true, this returns every row in the accounts table. More advanced payloads use `UNION SELECT`, subqueries, batched statements (`'; DROP TABLE users; --`), and time-based techniques (`SLEEP(10)`) to exfiltrate data or map the schema.

## Attack Categories

| Attack | Technique | Impact |
|--------|-----------|--------|
| Authentication bypass | `' OR '1'='1` | Login without credentials |
| Data exfiltration | `UNION SELECT ...` | Dump any accessible table |
| Blind SQLi | Boolean or time-based probing | Infer data without direct output |
| Out-of-band | DNS/HTTP channels | Exfiltrate when direct output is blocked |
| Stacked queries | `; DELETE FROM ...;` | Destroy or modify data |
| Second-order | Injected payload stored and re-executed later | Bypass input-layer validation |

## Detection

- Source code review: any query constructed by string concatenation with user input
- Automated DAST scanners: Burp Suite, OWASP ZAP, sqlmap
- SAST tools: pattern-match on unsafe query construction
- WAF logs: unusual characters (`'`, `--`, `UNION`, `OR 1=1`) in query parameters

## What SQL Injection Is Not

- **A filtering problem.** Blacklisting `'` or `--` is fragile. Attackers route around filters via encoding, alternate quoting, comment syntax, and time-based payloads. The root cause is structural intermixing of code and data.
- **Unique to web applications.** Any component that constructs SQL from external input (mobile apps, CLIs, message queue consumers, import pipelines) can be vulnerable.
- **Only applicable to relational databases.** NoSQL injection, ORM injection, and LDAP injection follow the same principle with different query languages.

## Remediation

The definitive fix is parameterized queries — see [[professions/data-architect/parameterized-queries-commandment]].

As a defense-in-depth complement: [[professions/data-architect/least-privilege-db-access]] limits blast radius if another vector is exploited.
