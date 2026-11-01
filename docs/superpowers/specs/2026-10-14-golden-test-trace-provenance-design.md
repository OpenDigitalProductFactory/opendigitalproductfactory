---
status: active
---

# Golden-test trace provenance

Owner: BI-7C93EEE7, WC-176B4C48. This atomic correction implements the calibration portion of section 9, slice 1 in the task-aware inference routing design. It is separate from BI-0C5858D1 selected Responses diagnostics and the local contention verification owned by BI-B550D9E5.

Named source 26e9d0f1da420a0ea0daeffc408a81624477a34c creates EndpointTestRun before dimension evaluation, but runGoldenTest omits callProvider's existing traceId attribution and the persisted TestResult has no trace. The executed regression failed on undefined dispatch attribution; fifty existing evaluation tests passed. The model call is mocked, so this is source reproduction, not a live provider failure or historical run attribution.

Reuse routing-trace's W3C-compatible traceId and the existing per-test result JSON. A calibration run owns its contained results; no synthetic coworker thread or second provenance store is needed. Authority, account choice, admission, output limits, retry count, scoring and cooldown remain unchanged. Legacy rows keep their missing trace. No schema, migration, credential, policy or runtime configuration change.

**OBJ-1:** Each new golden-test dispatch is correlated with its persisted result and actual calibration run.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | Each golden-test call under a persisted dimension evaluation carries a nonzero trace through callProvider to adapter telemetry; its persisted test result binds that same trace to the exact original DE run. Adapter threadId remains null for this non-coworker work. |
| AC-2 | OBJ-1 | Each persisted golden-test result retains the same trace, including bounded retry attempts; no unissued or guessed run identity. |
| AC-3 | OBJ-1 | Existing callers lacking a run binding expose missing parent honestly; no fabricated historical backfill or new auth authority. |
| AC-4 | OBJ-1 | Model-target selection, existing output cap and retry/single-flight semantics remain unchanged; affected regressions, protected publication and served synthetic calibration verification cover the correction. |

Implementation order: reproduce the omitted dispatch/result binding; generate one traceId per runGoldenTest request and carry it through callProvider and every success/error/retry result; verify persisted run identity and trace equality through runDimensionEval; run affected tests, both typechecks and the exact canonical gate; publish through the protected queue and verify a small target-bound calibration on qualified served bytes. All phases belong to BI-7C93EEE7. No half is independently shippable.

Documentation impact is the diagnostic provenance described here and in the existing task-aware design. PR #6345 separately updates the operator guide for trace-to-test-run lookup. This correction adds golden-test coverage to that same lookup; it does not introduce another operator flow or claim historical coverage.
