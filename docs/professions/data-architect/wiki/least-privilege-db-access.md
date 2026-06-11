---
title: Least Privilege Database Access
pageKind: principle
status: published
abstract: Each application component must connect to the database with only the permissions it requires — no more. Never use DBA or admin credentials for application queries.
principleTier: core
principleDirection: Grant only the permissions each service actually needs; never use superuser credentials in application code.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.9, "blast_radius": 1.0, "operational_independence": 0.7}
sources:
  - owasp/sql-injection-prevention
---

## Rule

Every database connection used by application code must be scoped to the minimum permissions the component actually requires. Admin/DBA credentials belong in migration scripts and infrastructure tooling — never in application query paths.

The OWASP SQL Injection Prevention Cheat Sheet states this as a required additional defense: "Minimize the privileges assigned to every database account in your environment. Don't assign DBA or admin type access rights to your application accounts."

## Why

Parameterized queries prevent SQL injection from modifying query structure. Least-privilege limits what an exploited service can do even if an attacker finds another vector (SSRF, RCE, compromised dependency). Defense in depth.

If a read-only reporting service connects with DBA credentials and gets compromised, the attacker can:
- Drop tables
- Exfiltrate all data across all schemas
- Create backdoor accounts
- Execute OS commands via database extensions (xp_cmdshell, COPY TO)

If the same service connects with a read-only role scoped to the reporting schema, the blast radius is bounded to the data that service is supposed to see.

## Applies To

Data architects designing connection pooling and service topology, software engineers provisioning DB users, AI coworkers generating infrastructure-as-code or database configuration.

## How To Apply

1. **Separate DB users by service.** The API service has a user. The background worker has a user. The reporting service has a user. They do not share credentials.
2. **Separate read and write users where feasible.** Read replicas + read-only users protect against accidental mutations and reduce write-path blast radius.
3. **Grant schema-specific permissions.** `GRANT SELECT ON TABLE users TO api_user` rather than `GRANT ALL ON ALL TABLES TO api_user`.
4. **Never put DBA credentials in `.env` files that application code reads.** Migration tooling (Flyway, Prisma Migrate, Alembic) uses the admin credential at deploy time; the running application never needs it.
5. **Rotate credentials on the minimal schedule.** Secrets managers (Vault, AWS Secrets Manager) can rotate database credentials without redeployment.

## See Also

- [[professions/data-architect/parameterized-queries-commandment]]
- [[professions/data-architect/sql-injection]]
