---
status: active
backlog: BI-06AE6833
workroom: WC-F6C4A1AB
---

# Hold denied research attestations

Observed live evidence links repeated identical research writes to the boot resumer: 416 authority-denied calls across 27 items, with 16 identical requests in sampled rooms. The Build Lead's research grant has a real revocation tombstone. The resumer re-attests, discards the refusal, and retries the transition even though no receipt was written.

Reuse the existing authoritative grant reader, governed executor, BuildActivity and pre-build outcome. Do not restore a grant, choose another identity, fabricate a passing research receipt, or add a ledger. Check current persisted writer grants before dispatch; unavailable authority holds the attempt and is rechecked on the next wake. Return the recorded/held outcome from the attester. A failed or held attestation never earns another transition attempt. Deduplicate unchanged held activity against the last attestation outcome, preserving a new event after a real state change.

Carry actual caller thread/task attribution through existing review/save callers. Use the build's recorded thread when no caller thread exists; absent task identity stays absent. Do not invent a TaskRun to conceal missing attribution. Source-neutral/no-research outcomes remain honest skips.

Verification: observed first failing regressions for revoked writer grants, held transition, build-thread attribution and current author roles; restored-authority and unchanged-hold cases also pass. The current-human resolver holds inactive or expired authors rather than borrowing historical authority. Affected review/resumer/save suites: 71 tests passed across four files. Both web TypeScript programs passed. The frozen source passed all 84 host guards in 549.4 seconds. Current main was merged without conflicts; integration checks and independent assessments remain in progress. Protected PR and release remain governed. Source-check evidence cannot establish live receipt or recovery acceptance.

Documentation impact: the design research runbook explains held receipt recovery and provenance. No rendered UI, data schema or install contract changes.
