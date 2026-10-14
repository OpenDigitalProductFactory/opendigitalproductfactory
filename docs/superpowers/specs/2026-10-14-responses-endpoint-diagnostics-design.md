---
status: active
---

# Selected Responses endpoint diagnostics

Implementation owner: BI-0C5858D1, Workroom WC-E0A3D976. This is an atomic fix under EP-D38F463C and the task-aware inference routing design. Provider account authentication remains BI-C4FCC089 and BI-385C0357; this fix changes no account credentials, authority, provider preference or unattended OAuth policy.

At source 2748294d2bbd2139a1c0876f67bde4d67b4bb9a6, `apps/web/lib/operate/endpoint-test-runner.ts` selects only active `llm` providers. Registered Responses providers are silently excluded. An explicit missing model can also become a `default` model, defeating the caller's selected identity. The source regression run has three failures and fifteen passes: selected Responses returns no results, unavailable provider returns no diagnostic, and missing model returns no diagnostic. The targeted live Codex diagnostic previously returned an empty successful result. Saved token readiness is a separate issue: the provider-account owner's live test returned structured upstream token_expired despite a future saved expiry.

**OBJ-1:** The existing diagnostic runner admits supported active conversational providers using the canonical structural provider predicate.

**OBJ-2:** An explicit diagnostic stays bound to its selected provider and model, reports unavailable targets, and cannot silently test another model.

**OBJ-3:** Synthetic diagnostics have bounded output and waiting time; incomplete execution or truncation produces no model-quality verdict. Existing shared admission, cancellation, privacy and parent authority remain in force.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | A selected active Responses model executes the existing capability probes against exactly its provider/model; embedding, image, transcription and service providers cannot execute chat probes. |
| AC-2 | OBJ-2 | Disabled, paused, unsupported or missing explicit targets give an unrun diagnostic; a missing explicit model never becomes the provider default. |
| AC-3 | OBJ-3 | Each probe uses an explicit bounded output plan and caller cancellation; timeout, capacity deferral and truncation leave capability evidence unverified. |
| AC-4 | OBJ-1, OBJ-2, OBJ-3 | A qualified served release executes a bounded public synthetic ChatGPT test with actual dispatch evidence, or reports its real admission/authentication blocker without counting an unrun test as a pass. |

Implementation order: (1) reproduce selection and identity failures before editing production code; (2) reuse `isModelRoutingProvider`, preserve the selected identities and explain zero-dispatch explicit targets; (3) bound the existing probe/scenario calls using the shared inference context and execution plan; (4) run affected regressions, both package typechecks, guards and canonical merged-code gate, publish through protected queue; (5) verify served lineage and a targeted public synthetic cloud diagnostic after the authentication repair is served. The phases are one correction to the existing runner, not separate dispatch or scheduler substrates.

Request provenance remains a separate acceptance obligation of the task-aware routing design: fixture-text matching identifies the calibration corpus but does not identify a particular live originating job. Cloud preview is not evidence of a dispatched ChatGPT request or automatic recovery.
