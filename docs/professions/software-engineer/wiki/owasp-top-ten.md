---
title: OWASP Top 10 (2025)
pageKind: entity
status: published
abstract: The OWASP Top 10 is a consensus awareness document of the ten most critical web application security risks. The 2025 edition is the eighth installment.
professionCompetencyLevel: foundational
sources:
  - owasp/top-ten
---

## Definition

The **OWASP Top 10** is a consensus awareness document, published by the OWASP Foundation, of the ten most critical web application security risks. The 2025 edition is the eighth installment and is published under CC BY-SA 4.0.

## The 2025 Categories

- **A01 — Broken Access Control**
- **A02 — Security Misconfiguration**
- **A03 — Software Supply Chain Failures**
- **A04 — Cryptographic Failures**
- **A05 — Injection**
- **A06 — Insecure Design**
- **A07 — Authentication Failures**
- **A08 — Software or Data Integrity Failures**
- **A09 — Security Logging and Alerting Failures**
- **A10 — Mishandling of Exceptional Conditions**

## What Changed in 2025

**A10 (Mishandling of Exceptional Conditions)** is new for 2025, and **Server-Side Request Forgery** was consolidated into **A01 (Broken Access Control)**. **A03 (Software Supply Chain Failures)** broadens the prior "vulnerable and outdated components" category to cover dependencies and build systems.

## How DPF Coworkers Use It

The Top 10 is an awareness frame, not a checklist of all risk. Pair it with the testable controls of the ASVS:

- Injection and access-control risks are addressed by [[professions/software-engineer/secure-coding-no-injection-validate-input]].
- Supply-chain and integrity risks are addressed by [[professions/software-engineer/dependency-supply-chain-integrity]].
- The verification baseline is [[professions/software-engineer/owasp-asvs-summary]].
