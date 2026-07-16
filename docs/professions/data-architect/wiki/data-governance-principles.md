---
title: Data Governance Principles
pageKind: entity
status: published
abstract: Data governance is the exercise of authority and control over the management of data assets — deciding who can take what action, on which data, under which circumstances, and by which method. Its principles turn ownership, stewardship, quality, and accountability into enforceable policy rather than good intentions.
sources:
  - postgresql/data-definition
  - gdpr/chap-3
---

## Definition

**Data governance** is the exercise of authority, control, and shared decision-making over the management of data assets. Where data modelling decides *what* the data is and how it is structured, governance decides *who may do what with it, and who answers for the outcome*. The DAMA-DMBOK (Data Management Body of Knowledge) frames governance as the function that sits at the centre of every other data-management discipline — quality, security, architecture, metadata — because each of those needs an owner, a policy, and an accountability path to be real.

Governance is not a tool or a one-time project; it is a standing operating model. Its output is a small number of durable principles applied consistently, not a large binder of rules nobody reads.

## Core Principles

- **Accountability** — every significant data asset has a named **owner** (accountable for its fitness for purpose and the policies that apply to it) and one or more **stewards** (responsible for day-to-day quality and definitions). "Everyone owns it" means no one does.
- **Single authoritative definition** — a business term (customer, active account, revenue) has one agreed definition and one system of record. Governance resolves the conflicts *before* two teams build on contradictory meanings.
- **Fitness for purpose (data quality)** — data is governed against explicit quality dimensions: **accuracy, completeness, consistency, timeliness, validity, and uniqueness**. Quality is measured, not assumed, and the acceptable threshold is a policy decision tied to how the data is used.
- **Least authority** — access follows need. Read, write, and administrative rights are granted to the narrowest role that requires them, and privileged access is auditable. This is the governance principle that the [[professions/data-architect/least-privilege-db-access]] page operationalises at the database layer.
- **Privacy and lawful use** — personal data carries obligations that travel with it: a lawful basis for processing, purpose limitation, retention limits, and the data-subject rights (access, rectification, erasure, portability) codified in regulations such as the GDPR. Governance is where those obligations become schema, retention jobs, and access rules rather than legal footnotes.
- **Transparency and lineage** — where a data element came from, how it was transformed, and who changed it are recorded. Lineage makes both quality incidents and compliance requests answerable.

## Roles

| Role | Accountable / responsible for |
|------|-------------------------------|
| **Data owner** | The policies, classification, and acceptable use of a data domain; sign-off on access. |
| **Data steward** | Definitions, quality rules, and issue resolution for specific data within a domain. |
| **Data custodian** | The technical environment — storage, backups, access enforcement (often the DBA / platform team). |
| **Data governance council** | Cross-domain arbitration: resolving conflicting definitions and approving enterprise-wide policy. |

Separating **owner** (business authority) from **custodian** (technical control) is deliberate: the person who decides *who should* have access is not the same as the person who *implements* it, which preserves an audit boundary.

## Enforcement Lives in the Engine, Not the Wiki

A governance principle that exists only in a policy document drifts. The data architect's job is to push each principle down to where the database enforces it automatically:

- **Ownership and access** → PostgreSQL **roles and `GRANT`/`REVOKE`**, so the least-authority principle is enforced on every connection, not trusted to application code.
- **Valid values and integrity** → **`CHECK`, `NOT NULL`, `UNIQUE`, and foreign-key constraints**, so "completeness" and "validity" quality dimensions are guaranteed at write time.
- **Classification and retention** → columns, row-level security policies, and scheduled deletion jobs that turn a retention policy into a mechanism.

A governed data element is one where the rule and the enforcement point are the same object.

## Why It Matters

Ungoverned data fails quietly: two dashboards report different revenue, a deleted customer reappears from a copy, a regulator asks who accessed a record and no one can answer. Governance is the discipline that makes data trustworthy enough to make decisions on — and, for the Data Architect coworker, the frame that decides whether a proposed schema or access change is *allowed*, not merely *possible*.

## See Also

- [[professions/data-architect/data-modelling-concepts]]
- [[professions/data-architect/least-privilege-db-access]]
- [[professions/data-architect/schema-migration-practices]]
