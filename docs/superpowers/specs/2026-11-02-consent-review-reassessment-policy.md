---
status: draft
backlog: BI-9D3A6DB7
---

# Retained policy for two exact consent review assessments

This is an unapproved candidate authority artifact under BI-9D3A6DB7. It needs a
genuine independent spec-approval baseline and retained immutable bytes before
the existing issuer can use it. Framework delivery is BI-7906C73E; original
consent delivery remains BI-05E0EA33 / WC-D32E1140. Neither an operator decision,
this file, a merged source change nor a client review is independent approval.

**OBJ-POLICY:** Bind at most two present independent consent assessments to their
exact original requirements, preserving all original uncertainty and controls.

The user approved the bounded proposal on November 2, 2026: at most two new
independent assessments, existing budgets and controls preserved, a separate
recovery branch while consent remains frozen, independent policy review and
normal deployment gates still required. Actual subject evidence is
`cmvzqqbnb0m7c01tmwdafqmuv`; it records the reply, not a reviewer verdict.

The exact subject artifact is commit
`eaedda44088581930f3cf7696bd277eee99c5ec6`, repository
`OpenDigitalProductFactory/opendigitalproductfactory`, path
`docs/superpowers/specs/2026-09-21-oauth-external-build-authority-design.md`, Git
blob `06f633253aa1e4a72332ac0b9cbaba4c67f919a5` in WC-D32E1140. The issuer must
independently establish this identity from each original accepted request.

The original tasks share prefix
`TR-MCP-b2F1dGgtZmFtaWx5OjE2YzM1ZDQxLWJiNDMtNDg4OC05OTlhLTVjNTYyMWRhZTFiNQ-`:
design-spec ends `0858B6F51F8A`; spec-approval ends `2CCF3C283153`. Both retain
unknown execution/effects and `replayAllowed: false`. Do not infer their effects
ended from outer exit 1, absent audit rows, health checks or runtime retirement.

```review-reassessment-policy-v1
{
  "schemaVersion": 1,
  "subjectItemId": "BI-05E0EA33",
  "maxAssessments": 2,
  "historicalConsumption": "retain-unknown",
  "currentLimits": "normal-recorded",
  "originalReplay": false,
  "operatorEvidenceActivityIds": ["cmvzqqbnb0m7c01tmwdafqmuv"],
  "requirements": [
    { "gate": "design-spec", "originalRequestDigest": "8bf738e0306265d7531e7cb2c655710ad8a4d82bf10415163ab5eb6b93450589", "maxAssessments": 1 },
    { "gate": "spec-approval", "originalRequestDigest": "258dbce24c77928167b0714098f13bb660be5ea9c44f9463cbbc987cc8ecff01", "maxAssessments": 1 }
  ]
}
```

| Criterion | Objective | Acceptance |
|---|---|---|
| AC-CP-1 | OBJ-POLICY | Independent approval retains this exact policy and genuine subject operator evidence in a current immutable baseline; missing or changed proof refuses. |
| AC-CP-2 | OBJ-POLICY | Exactly one accepted assessment per named requirement and two total across all authorization families. Pending, failed, cancelled and uncertain allocations consume their allowance. |
| AC-CP-3 | OBJ-POLICY | Original subject/task/digest/artifact/owner and all predecessor allocations are authenticated; matching genuine receipts take precedence. No source change, rekey or credential family creates another allowance. |
| AC-CP-4 | OBJ-POLICY | Historical unknown effects and spend remain unknown. Original replay, original attempt/budget/deadline reset and blanket cross-subject authorization remain forbidden. BI-285EF102 policy is untouched. |
| AC-CP-5 | OBJ-POLICY | Existing current human/assistant/Workroom action access, independent reviewer eligibility, allowed LLMs, data clearance, normal budgets, prospective capture and backend writer/effect/approval fences apply before every assessment/effect. Public source access grants no private-data access. |
| AC-CP-6 | OBJ-POLICY | A genuinely issued and admitted exact-source assessment may produce only its current bound verdict. Policy approval cannot substitute for the original consent design/spec receipts, implementation admission or runtime acceptance. |

The shared mechanism and its verification/rollback contract remain in
[the original recovery design](2026-10-16-original-initiative-review-settlement-design.md#consent-specific-amendment--november-2).
No new database schema, grant, provider, scheduler, credential or effect store is
needed. Mixed older owners must refuse unsupported consent policy. Disabling new
policy admission retains original history, spent allowances and existing fences;
it does not restore another allocation. Actual protected delivery and canonical
compatibility are prerequisites, not evidence asserted by this candidate.
