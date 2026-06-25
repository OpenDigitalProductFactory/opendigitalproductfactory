# Sovereign SOC — P6 compliance: evidence + framework reports + retention

- **Date:** 2026-06-25
- **Spec:** [2026-06-24-sovereign-soc-siem-design.md](../specs/2026-06-24-sovereign-soc-siem-design.md) §4.7
- **Epic:** EP-SOVEREIGN-SOC — **BI-CE28A324** · composes EP-ASSURANCE-LEDGER / EP-DATA-RETENTION

## This pass (DONE)
- **Retention:** `Detection` → `PURGE_POLICIES` under the existing `security-audit` category (365d, createdAt-indexed). `SecurityEvent` already enrolled (P0); `SecurityCase` stays in `RETAINED_DATASETS` (regulated incident record).
- **Reporting:** `apps/web/lib/security/compliance.ts` — `SECURITY_COMPLIANCE_FRAMEWORKS` maps the SOC's Detect/Respond activity to the control families of NIST CSF, PCI-DSS, HIPAA, SOC 2, CMMC, and DORA; `buildSecurityComplianceReport(framework, metrics)` evidences a Detect control when monitoring is active with detections, a Respond control when cases resolve.
- **Continuous evidence:** `securityCaseToEvidenceInput` (pure) + `recordSecurityCaseEvidence` (idempotent upsert, keyed on the case) turn a resolved `SecurityCase` into a `ComplianceEvidence` row — the "we detect and respond" proof, composing the existing GRC Control/Obligation/Evidence framework (`ComplianceEvidence.controlId` optional, so generic security-operations evidence lands without a pre-mapped control).
- Tests: `compliance.test.ts` (report evidencing logic across frameworks; case→evidence projection).

## Verified
web typecheck clean; compliance + retention guard tests green.
